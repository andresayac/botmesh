/**
 * The services' own error messages may echo the credential back (OpenAI's 401 quotes a
 * masked key; a proxy or self-hosted server may quote it whole). VoiceHttpError messages end
 * up in logs, so they must never carry it.
 */
import { describe, expect, it } from 'vitest'
import { deepgramStt, elevenlabsTts, openaiStt, openaiTts } from '../src/index.js'
import { fakeFetch, json, makeOgg, publicResolver } from './helpers.js'

const KEY = 'sk-proj-AbCdEf0123456789SECRETxyz'

async function messageOf(p: Promise<unknown>): Promise<string> {
  const err = await p.then(() => undefined, (e: unknown) => e)
  expect(err).toBeInstanceOf(Error)
  return (err as Error).message
}

describe('voice error messages never carry the api key', () => {
  it('OpenAI STT: a 401 that quotes the key (whole or masked)', async () => {
    const { fetch } = fakeFetch(() => json({ error: { message: `Incorrect API key provided: ${KEY}. Also sk-proj-****************************4567.` } }, 401))
    const msg = await messageOf(openaiStt({ apiKey: KEY, fetch, resolver: publicResolver }).transcribe({ buffer: makeOgg(1) }))
    expect(msg).toContain('HTTP 401')
    expect(msg).toContain('Incorrect API key provided')
    expect(msg).not.toContain(KEY)
    expect(msg, msg).not.toContain('4567')
  })

  it('OpenAI TTS, Deepgram and ElevenLabs: the configured key is scrubbed from the detail', async () => {
    const hexKey = '0123456789abcdef0123456789abcdef'
    const echo = (key: string) => fakeFetch(() => json({ error: { message: `bad key ${key}` }, err_msg: `bad key ${key}`, detail: { message: `bad key ${key}` } }, 403)).fetch
    for (const run of [
      () => openaiTts({ apiKey: hexKey, fetch: echo(hexKey), resolver: publicResolver }).synthesize('hola'),
      () => deepgramStt({ apiKey: hexKey, fetch: echo(hexKey), resolver: publicResolver }).transcribe({ buffer: makeOgg(1) }),
      () => elevenlabsTts({ apiKey: hexKey, voiceId: 'v', fetch: echo(hexKey), resolver: publicResolver }).synthesize('hola'),
    ]) {
      const msg = await messageOf(run())
      expect(msg).toContain('HTTP 403')
      expect(msg).not.toContain(hexKey)
    }
  })
})
