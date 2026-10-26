/**
 * Release-readiness hardening: per-call timeouts, limit validation, header sanitizing,
 * key redaction of other key shapes, typed-array input, throwing user filters, bursts
 * across many chats and stop/start cycles.
 */
import { describe, expect, it } from 'vitest'
import { createTestBot } from '@botmesh/core/testing'
import {
  deepgramStt,
  elevenlabsTts,
  voicePlugin,
  VoiceClient,
  VoiceConfigError,
  VoiceTimeoutError,
  type SttAdapter,
  type TtsAdapter,
} from '../src/index.js'
import { fakeFetch, json, makeOgg, publicResolver, recordingLogger, waitFor } from './helpers.js'

/** An adapter that answers after `ms` unless its signal aborts first; records the per-call timeout. */
function slowStt(ms: number, seen: Array<number | undefined> = []): SttAdapter {
  return {
    name: 'slow-stt',
    transcribe: (_a, o) => {
      seen.push(o?.timeoutMs)
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve({ text: 'late', provider: 'slow-stt' }), ms)
        o?.signal?.addEventListener('abort', () => { clearTimeout(t); reject(o.signal!.reason) }, { once: true })
      })
    },
  }
}

function slowTts(ms: number, seen: Array<number | undefined> = []): TtsAdapter {
  return {
    name: 'slow-tts',
    synthesize: (_t, o) => {
      seen.push(o?.timeoutMs)
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve({ buffer: Buffer.from('a'), mimetype: 'audio/ogg', format: 'opus', provider: 'slow-tts' }), ms)
        o?.signal?.addEventListener('abort', () => { clearTimeout(t); reject(o.signal!.reason) }, { once: true })
      })
    },
  }
}

const quickStt = (text = 'hola'): SttAdapter => ({ name: 'q', transcribe: async () => ({ text, provider: 'q' }) })
const quickTts = (): TtsAdapter => ({
  name: 'q',
  synthesize: async (text) => ({ buffer: Buffer.from(`audio:${text}`), mimetype: 'audio/ogg; codecs=opus', format: 'opus', provider: 'q' }),
})

describe('per-call timeoutMs', () => {
  it('a per-call timeoutMs tighter than limits.timeoutMs is honoured (STT and TTS)', async () => {
    const seen: Array<number | undefined> = []
    const client = new VoiceClient({ stt: slowStt(2_000, seen), tts: slowTts(2_000, seen), limits: { timeoutMs: 60_000 } })
    const started = Date.now()
    const a = await client.transcribe(makeOgg(1), { timeoutMs: 50 }).catch((e: unknown) => e)
    const b = await client.synthesize('hola', { timeoutMs: 50 }).catch((e: unknown) => e)
    expect(Date.now() - started).toBeLessThan(1_500)
    expect(a).toBeInstanceOf(VoiceTimeoutError)
    expect(b).toBeInstanceOf(VoiceTimeoutError)
    expect((a as VoiceTimeoutError).timeoutMs).toBe(50)
    expect(seen).toEqual([50, 50])
  })

  it('a per-call timeoutMs can only tighten limits.timeoutMs, never extend it', async () => {
    const seen: Array<number | undefined> = []
    const client = new VoiceClient({ stt: slowStt(2_000, seen), limits: { timeoutMs: 50 } })
    const err = await client.transcribe(makeOgg(1), { timeoutMs: 120_000 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(VoiceTimeoutError)
    expect(seen).toEqual([50])
  })
})

describe('limits validation', () => {
  it.each([
    [{ timeoutMs: Infinity }, /timeoutMs/],
    [{ timeoutMs: 0 }, /timeoutMs/],
    [{ timeoutMs: -5 }, /timeoutMs/],
    [{ timeoutMs: Number.NaN }, /timeoutMs/],
    [{ timeoutMs: 2 ** 31 }, /timeoutMs/],
    [{ maxInputBytes: 0 }, /maxInputBytes/],
    [{ maxInputBytes: 'big' as unknown as number }, /maxInputBytes/],
    [{ maxDurationSec: -1 }, /maxDurationSec/],
    [{ maxTextChars: 1.5 }, /maxTextChars/],
  ])('rejects %o with a VoiceConfigError naming the field', (limits, field) => {
    expect(() => new VoiceClient({ limits })).toThrow(VoiceConfigError)
    expect(() => new VoiceClient({ limits })).toThrow(field)
  })

  it('accepts a fractional maxDurationSec and Infinity for the size/duration/text caps', () => {
    const client = new VoiceClient({ limits: { maxDurationSec: 0.5, maxInputBytes: Infinity, maxTextChars: Infinity } })
    expect(client.limits.maxDurationSec).toBe(0.5)
  })

  it('the effective limits are frozen, so validation cannot be bypassed after construction', () => {
    const client = new VoiceClient()
    expect(Object.isFrozen(client.limits)).toBe(true)
  })

  it('voicePlugin rejects bad limits synchronously at plug() time', async () => {
    const { bot } = await createTestBot()
    expect(() => bot.plug(voicePlugin({ stt: quickStt(), limits: { timeoutMs: 0 } }))).toThrow(VoiceConfigError)
    await bot.stop()
  })
})

describe('inbound mimetype hygiene', () => {
  it('Deepgram never sends a header-injecting or malformed mimetype as Content-Type', async () => {
    const { fetch, calls } = fakeFetch(() => json({ results: { channels: [{ alternatives: [{ transcript: 'ok' }] }] } }))
    const dg = deepgramStt({ apiKey: 'k', fetch, resolver: publicResolver })
    await dg.transcribe({ buffer: makeOgg(1), mimetype: 'audio/ogg\r\nX-Evil: 1' })
    await dg.transcribe({ buffer: makeOgg(1), mimetype: 'not a mimetype' })
    await dg.transcribe({ buffer: makeOgg(1), mimetype: 'audio/ogg; codecs=opus' })
    expect(calls.map((c) => c.headers.get('content-type'))).toEqual(['audio/ogg', 'application/octet-stream', 'audio/ogg; codecs=opus'])
  })
})

describe('key redaction', () => {
  it('redacts underscore-style keys (ElevenLabs sk_…) quoted by the service, whole or masked', async () => {
    const { fetch } = fakeFetch(() => json({ detail: { message: 'Invalid API key: sk_4f3a9b2c1d0e****wxyz' } }, 401))
    const err = await elevenlabsTts({ apiKey: 'sk_mine_0123456789', voiceId: 'v', fetch, resolver: publicResolver })
      .synthesize('hola').then(() => new Error('expected a rejection'), (e: unknown) => e as Error)
    expect(err.message).toContain('HTTP 401')
    expect(err.message).not.toContain('4f3a9b2c1d0e')
    expect(err.message).not.toContain('wxyz')
  })
})

describe('typed-array input', () => {
  it('accepts a Uint8Array (raw or as AudioInput.buffer) and hands the adapter a Buffer', async () => {
    const got: unknown[] = []
    const client = new VoiceClient({ stt: { name: 'n', transcribe: async (a) => { got.push(a.buffer); return { text: 'ok', provider: 'n' } } } })
    const bytes = new Uint8Array(makeOgg(1))
    expect(await client.transcribe(bytes)).toBe('ok')
    expect(await client.transcribe({ buffer: bytes as unknown as Buffer, mimetype: 'audio/ogg' })).toBe('ok')
    expect(got.every((b) => Buffer.isBuffer(b))).toBe(true)
    expect((got[0] as Buffer).equals(Buffer.from(bytes))).toBe(true)
  })
})

describe('throwing user filters', () => {
  it('autoTranscribe.filter that throws: warns, skips the transcription and still routes the message', async () => {
    const { logger, logs } = recordingLogger()
    const { bot, chat, provider } = await createTestBot({ logger })
    provider.downloadMedia = async () => makeOgg(1)
    bot.plug(voicePlugin({ stt: quickStt(), autoTranscribe: { filter: () => { throw new Error('filter bug') } } }))
    const seen: Array<string | undefined> = []
    bot.onMessage((ctx) => { seen.push(ctx.transcript); return ctx.reply('routed') })
    await chat.send('', { type: 'voice' })
    await chat.expectReply('routed')
    expect(seen).toEqual([undefined])
    expect(logs.some((l) => l.level === 'warn' && JSON.stringify(l.args).includes('filter'))).toBe(true)
    await bot.stop()
  })

  it('autoReplyWithVoice.filter that throws: warns and sends the text instead of failing the send', async () => {
    const { logger, logs } = recordingLogger()
    const { bot, chat, provider } = await createTestBot({ logger })
    provider.downloadMedia = async () => makeOgg(1)
    bot.plug(voicePlugin({ stt: quickStt(), tts: quickTts(), autoReplyWithVoice: { filter: () => { throw new Error('filter bug') } } }))
    bot.onMessage((ctx) => ctx.reply('respuesta'))
    await chat.send('', { type: 'voice' })
    await chat.expectReply('respuesta')
    expect(provider.outbox.map((m) => m.content.kind)).toEqual(['text'])
    expect(logs.some((l) => l.level === 'warn' && JSON.stringify(l.args).includes('filter'))).toBe(true)
    await bot.stop()
  })
})

describe('end to end under load', () => {
  it('a burst of voice notes across 150 chats: every chat gets its own voice reply, nothing leaks', async () => {
    const { bot, provider, dm } = await createTestBot()
    provider.downloadMedia = async () => makeOgg(1)
    let n = 0
    const stt: SttAdapter = { name: 'n', transcribe: async () => { await new Promise((r) => setTimeout(r, 1 + (n++ % 5))); return { text: '¡Hola, señor! 👋', provider: 'n' } } }
    bot.plug(voicePlugin({ stt, tts: quickTts(), autoReplyWithVoice: true }))
    bot.when('hola, señor! 👋', (ctx) => ctx.reply(`hi ${ctx.from}`))
    const chats = Array.from({ length: 150 }, (_, i) => dm(`u${i}@s.whatsapp.net`))
    await Promise.all(chats.map((c) => c.send('', { type: 'voice' })))
    await waitFor(() => provider.outbox.length === 150, 5_000)
    expect(provider.outbox.every((m) => m.content.kind === 'voice')).toBe(true)
    expect(new Set(provider.outbox.map((m) => m.chatId)).size).toBe(150)
    for (const m of provider.outbox) {
      expect(((m.content as { media: Buffer }).media).toString()).toBe(`audio:hi ${m.chatId}`)
    }
    await bot.stop()
  })

  it('keeps working across stop()/start() cycles', async () => {
    const { bot, chat, provider } = await createTestBot()
    provider.downloadMedia = async () => makeOgg(1)
    bot.plug(voicePlugin({ stt: quickStt('hola'), tts: quickTts(), autoReplyWithVoice: true }))
    bot.when('hola', (ctx) => ctx.reply('hey'))
    for (let i = 0; i < 3; i++) {
      await chat.send('', { type: 'voice' })
      await waitFor(() => provider.outbox.length === i + 1)
      await bot.stop()
      await bot.start()
    }
    expect(provider.outbox.map((m) => m.content.kind)).toEqual(['voice', 'voice', 'voice'])
    await bot.stop()
  })
})
