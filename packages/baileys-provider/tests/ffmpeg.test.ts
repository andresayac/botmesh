/**
 * Voice notes are transcoded to Ogg/Opus by spawning an ffmpeg binary directly (no
 * fluent-ffmpeg, no bundled @ffmpeg-installer binary). The binary is found in this order:
 * `FFMPEG_PATH`, the optional `ffmpeg-static` package (when its binary exists), then
 * `ffmpeg` on the PATH. A missing binary fails with an actionable UnsupportedContentError.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UnsupportedContentError } from '@botmesh/core'
import { resolveFfmpegPath } from '../src/ffmpeg.js'
import { transcodeToOpus, toOutbound } from '../src/index.js'

const saved = process.env.FFMPEG_PATH
afterEach(() => {
  if (saved === undefined) delete process.env.FFMPEG_PATH
  else process.env.FFMPEG_PATH = saved
})

function hasSystemFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** One second of 8 kHz mono silence as a PCM WAV file. */
function silentWav(): Buffer {
  const samples = 8000
  const data = Buffer.alloc(samples * 2)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0, 'ascii'); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8, 'ascii')
  h.write('fmt ', 12, 'ascii'); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(8000, 24); h.writeUInt32LE(16000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36, 'ascii'); h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

describe('resolveFfmpegPath', () => {
  it('prefers FFMPEG_PATH', async () => {
    await expect(resolveFfmpegPath({ FFMPEG_PATH: '  /opt/ffmpeg/bin/ffmpeg ' }, async () => '/static/ffmpeg')).resolves.toBe('/opt/ffmpeg/bin/ffmpeg')
  })

  it('uses ffmpeg-static when installed and its binary exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'botmesh-ffmpeg-'))
    const bin = join(dir, 'ffmpeg')
    writeFileSync(bin, '')
    try {
      await expect(resolveFfmpegPath({}, async () => bin)).resolves.toBe(bin)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falls back to ffmpeg on the PATH when ffmpeg-static is missing or its download was skipped', async () => {
    await expect(resolveFfmpegPath({}, async () => { throw Object.assign(new Error('not found'), { code: 'ERR_MODULE_NOT_FOUND' }) })).resolves.toBe('ffmpeg')
    await expect(resolveFfmpegPath({}, async () => join(tmpdir(), 'no-such-dir', 'ffmpeg'))).resolves.toBe('ffmpeg')
    await expect(resolveFfmpegPath({}, async () => null)).resolves.toBe('ffmpeg')
  })
})

describe('transcodeToOpus', () => {
  it('rejects with an actionable UnsupportedContentError when the binary cannot be started', async () => {
    process.env.FFMPEG_PATH = join(tmpdir(), 'no-such-dir', 'ffmpeg-missing')
    const err = await transcodeToOpus(Buffer.from('not audio')).then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(UnsupportedContentError)
    expect((err as Error).message).toMatch(/ffmpeg could not be started/)
    expect((err as Error).message).toMatch(/FFMPEG_PATH/)
    expect((err as Error).message).toMatch(/ffmpeg-static/)
  })

  it('a voice send through toOutbound keeps the same typed error', async () => {
    process.env.FFMPEG_PATH = join(tmpdir(), 'no-such-dir', 'ffmpeg-missing')
    const err = await toOutbound({ kind: 'voice', media: Buffer.from('ogg') }).then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(UnsupportedContentError)
    expect((err as Error).message).toMatch(/ffmpeg could not be started/)
  })

  it('reports ffmpeg\'s own error (exit code and stderr tail) for input it cannot decode', { skip: !hasSystemFfmpeg() }, async () => {
    delete process.env.FFMPEG_PATH
    const err = await transcodeToOpus(Buffer.from('definitely not audio')).then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/ffmpeg exited with code \d+/)
  })

  it('transcodes a WAV into an Ogg/Opus voice note with the system ffmpeg', { skip: !hasSystemFfmpeg(), timeout: 30_000 }, async () => {
    delete process.env.FFMPEG_PATH
    const ogg = await transcodeToOpus(silentWav())
    expect(ogg.subarray(0, 4).toString('ascii')).toBe('OggS')
    expect(ogg.includes(Buffer.from('OpusHead'))).toBe(true)
  })

  it('passes the input through an Opus mono 48 kHz encode', async () => {
    vi.resetModules()
    const calls: Array<{ bin: string; args: string[] }> = []
    vi.doMock('node:child_process', async (orig) => {
      const real = await orig<typeof import('node:child_process')>()
      const { EventEmitter } = await import('node:events')
      const { writeFileSync: write } = await import('node:fs')
      return {
        ...real,
        spawn: (bin: string, args: string[]) => {
          calls.push({ bin, args })
          const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), kill: () => true })
          setImmediate(() => { write(args[args.length - 1]!, Buffer.from('OggS-fake')); child.emit('close', 0, null) })
          return child
        },
      }
    })
    try {
      process.env.FFMPEG_PATH = 'my-ffmpeg'
      const mod = await import('../src/MediaProcessor.js')
      const out = await mod.transcodeToOpus(Buffer.from('in'))
      expect(out.toString()).toBe('OggS-fake')
      expect(calls).toHaveLength(1)
      expect(calls[0]!.bin).toBe('my-ffmpeg')
      const a = calls[0]!.args
      expect(a).toEqual(expect.arrayContaining(['-c:a', 'libopus', '-ac', '1', '-ar', '48000', '-vn']))
      expect(a[a.indexOf('-i') + 1]).toMatch(/baileys-in-.*\.bin$/)
      expect(a[a.length - 1]).toMatch(/baileys-out-.*\.ogg$/)
    } finally {
      vi.doUnmock('node:child_process')
      vi.resetModules()
    }
  })
})
