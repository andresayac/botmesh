import { describe, it, expect } from 'vitest'
import pino from 'pino'
import type { InboundEvent } from '@botmesh/core'
import { EvolutionProvider } from '../src/EvolutionProvider.js'
import { expectWellFormedEvent, mutations } from '../../../test-utils/fuzz.js'
import { fixture } from './support/fake.js'

const make = () => {
  const provider = new EvolutionProvider({
    baseUrl: 'http://127.0.0.1:8080', apiKey: 'k', instance: 'my-instance', webhookSecret: 's', logger: pino({ level: 'silent' }),
  })
  const seen: InboundEvent[] = []
  provider.onEvent((e) => { seen.push(e) })
  return { provider, seen }
}
const headers = { 'x-webhook-secret': 's' }
const upsert = (message: Record<string, unknown>, key: Record<string, unknown> = {}) => ({
  event: 'messages.upsert', instance: 'my-instance',
  data: { key: { remoteJid: '573001112233@s.whatsapp.net', fromMe: false, id: 'ID1', ...key }, pushName: 'Ana', message, messageTimestamp: 1714000000 },
})

describe('Evolution ingest on malformed payloads', () => {
  it('a non-array mentionedJid is ignored instead of throwing', () => {
    const { provider, seen } = make()
    expect(provider.ingest(upsert({ extendedTextMessage: { text: 'hi', contextInfo: { mentionedJid: '5@s.whatsapp.net' } } }), headers)).toBe(200)
    expect(seen).toHaveLength(1)
    expectWellFormedEvent(seen[0])
  })

  it('non-string quote/reaction ids never leak into refs', () => {
    const { provider, seen } = make()
    provider.ingest(upsert({ extendedTextMessage: { text: 'hi', contextInfo: { stanzaId: 5, participant: 7, quotedMessage: 'x' } } }), headers)
    provider.ingest(upsert({ reactionMessage: { key: { id: 5 }, text: 7 } }, { id: 'ID2' }), headers)
    for (const e of seen) expectWellFormedEvent(e)
    expect(seen[0]?.kind === 'message' && seen[0].message.quoted).toBeUndefined()
    expect(seen.filter((e) => e.kind === 'reaction')).toHaveLength(0)
  })

  it('seeded random mutations of recorded webhooks: always a status, every event well formed', () => {
    const { provider, seen } = make()
    const samples = [
      'messages-upsert-text-dm', 'messages-upsert-group-image', 'messages-upsert-group-lid-only', 'messages-upsert-lid-only',
      'messages-upsert-lid-senderpn', 'messages-upsert-reaction', 'messages-update', 'call', 'connection-update-close',
      'connection-update-open', 'qrcode-updated',
    ].map((name) => fixture(name))
    for (const body of mutations(20260425, samples, 4000)) {
      expect([200, 400]).toContain(provider.ingest(body, headers))
      expect([200, 400]).toContain(provider.ingest(JSON.stringify(body) ?? 'null', headers))
    }
    expect(seen.length).toBeGreaterThan(500)
    for (const e of seen) expectWellFormedEvent(e)
  })
})

describe('Evolution config errors', () => {
  it('a baseUrl without scheme fails at construction with an actionable message', () => {
    expect(() => new EvolutionProvider({ baseUrl: 'localhost:8080', apiKey: 'k', instance: 'i', webhookSecret: 's' }))
      .toThrow(/EvolutionProvider: `baseUrl` must be an absolute http\(s\) URL/)
  })
})
