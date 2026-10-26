/**
 * sharp and ffmpeg are native toolchains that do not load everywhere (musl,
 * unusual CPUs, pruned installs). They are only needed for stickers and voice
 * notes, so a platform without them must still import the package and send
 * text; the media sends that need them fail with a typed, actionable error.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UnsupportedContentError } from '@botmesh/core'

vi.mock('sharp', () => { throw new Error('Could not load the "sharp" module using the linuxmusl-x64 runtime') })

// No ffmpeg binary on this platform: FFMPEG_PATH points nowhere.
const savedFfmpeg = process.env.FFMPEG_PATH
beforeAll(() => { process.env.FFMPEG_PATH = join(tmpdir(), 'no-such-dir', 'ffmpeg') })
afterAll(() => { if (savedFfmpeg === undefined) delete process.env.FFMPEG_PATH; else process.env.FFMPEG_PATH = savedFfmpeg })

describe('native media tools load lazily', () => {
  it('imports the package and sends text without sharp or ffmpeg', async () => {
    const { BaileysProvider } = await import('../src/index.js')
    const p = new BaileysProvider({ session: 'native-tools', rateLimit: { enabled: false } })
    const sendMessage = vi.fn(async (jid: string) => ({ key: { id: 'OUT', remoteJid: jid } }))
    ;(p as unknown as { sock: unknown }).sock = { sendMessage }
    await expect(p.send('573001112233@s.whatsapp.net', { kind: 'text', text: 'hi' })).resolves.toMatchObject({ ref: { id: 'OUT' } })
  })

  it('rejects a sticker or a voice note with an actionable UnsupportedContentError', async () => {
    const { toOutbound } = await import('../src/index.js')
    const sticker = await toOutbound({ kind: 'sticker', media: Buffer.from('png') }).then(() => null, (e: unknown) => e)
    expect(sticker).toBeInstanceOf(UnsupportedContentError)
    expect((sticker as Error).message).toMatch(/sharp could not be loaded/)
    const voice = await toOutbound({ kind: 'voice', media: Buffer.from('ogg') }).then(() => null, (e: unknown) => e)
    expect(voice).toBeInstanceOf(UnsupportedContentError)
    expect((voice as Error).message).toMatch(/ffmpeg could not be started.*FFMPEG_PATH/)
  })
})
