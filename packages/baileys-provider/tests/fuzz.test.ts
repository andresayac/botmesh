/**
 * Property-style fuzzing with a seeded generator (reproducible, no extra deps):
 * whatever a malicious peer, a corrupted journal or a broken poll store hands
 * the provider, it must not throw out of the event pipeline, must emit only
 * string ids, and must reject stored data with typed errors or a miss.
 */
import { describe, expect, it, vi } from 'vitest'
import { ProviderError, type SerializedMediaRef } from '@botmesh/core'
import type { WAMessage } from '@whiskeysockets/baileys'

vi.mock('@whiskeysockets/baileys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@whiskeysockets/baileys')>()
  const { fakeMakeWASocket } = await import('./support/harness.js')
  return { ...actual, default: fakeMakeWASocket, makeCacheableSignalKeyStore: (keys: unknown) => keys }
})

const { BaileysProvider } = await import('../src/BaileysProvider.js')
const { connect } = await import('./support/harness.js')
const { parseBaileysMediaRef } = await import('../src/mediaRef.js')
const { fromStoredPoll } = await import('../src/polls.js')

/** mulberry32: tiny seeded PRNG. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const JIDS = ['573001112233@s.whatsapp.net', '573001112233:7@s.whatsapp.net', '1234@lid', '1234:3@lid', '120363@g.us', 'status@broadcast', '1@newsletter', '', '@', 'x@y@z', '💥@lid', 'a'.repeat(5000) + '@lid']
const PARTS = ['conversation', 'extendedTextMessage', 'imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage', 'locationMessage', 'liveLocationMessage', 'contactMessage', 'pollCreationMessage', 'pollUpdateMessage', 'reactionMessage', 'protocolMessage', 'ephemeralMessage', 'viewOnceMessageV2', 'documentWithCaptionMessage', 'editedMessage', 'buttonsResponseMessage', 'listResponseMessage', 'messageContextInfo', 'senderKeyDistributionMessage', 'contextInfo', 'mentionedJid', 'quotedMessage', 'participant', 'stanzaId', 'text', 'caption', 'degreesLatitude', 'degreesLongitude', 'message', 'key', 'ptt', 'mimetype', 'name', 'options']

function value(r: () => number, depth: number): unknown {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!
  switch (Math.floor(r() * (depth > 3 ? 7 : 9))) {
    case 0: return null
    case 1: return undefined
    case 2: return Math.floor(r() * 2 ** 31) * (r() < 0.5 ? -1 : 1)
    case 3: return pick([NaN, Infinity, -0, 1e308, 91, -181])
    case 4: return pick(['', 'hola', '👨‍👩‍👧‍👦', '\u0000‮', 'x'.repeat(1000), ...JIDS])
    case 5: return r() < 0.5
    case 6: return new Uint8Array(Math.floor(r() * 40))
    case 7: return Array.from({ length: Math.floor(r() * 4) }, () => value(r, depth + 1))
    default: {
      const o: Record<string, unknown> = {}
      for (let i = Math.floor(r() * 5); i > 0; i--) o[pick(PARTS)] = value(r, depth + 1)
      return o
    }
  }
}

function randomMessage(r: () => number): WAMessage {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!
  const key: Record<string, unknown> = { remoteJid: pick(JIDS), id: r() < 0.9 ? `F${Math.floor(r() * 1e9)}` : value(r, 3), fromMe: r() < 0.1 }
  if (r() < 0.5) key.remoteJidAlt = pick(JIDS)
  if (r() < 0.5) key.participant = pick(JIDS)
  if (r() < 0.3) key.participantAlt = pick(JIDS)
  const message: Record<string, unknown> = {}
  for (let i = 1 + Math.floor(r() * 3); i > 0; i--) message[pick(PARTS)] = value(r, 1)
  return { key, message: r() < 0.95 ? message : value(r, 2), messageTimestamp: value(r, 3), pushName: value(r, 3) } as unknown as WAMessage
}

describe('fuzz: inbound pipeline', () => {
  it('never throws on random events, and a malformed one never drops the rest of its batch', async () => {
    const h = await connect(BaileysProvider)
    const logged: unknown[][] = []
    const logger = (h.provider as unknown as { logger: { error: (...a: unknown[]) => void } }).logger
    const spy = vi.spyOn(logger, 'error').mockImplementation((...a: unknown[]) => { logged.push(a) })
    const SENTINEL = '573000000001@s.whatsapp.net'
    for (let seed = 1; seed <= 600; seed++) {
      const r = rng(seed)
      const jid = JIDS[seed % JIDS.length]
      const sentinel = { key: { remoteJid: SENTINEL, id: `SENTINEL-${seed}`, fromMe: false }, message: { conversation: 'ok' }, messageTimestamp: 1 }
      const batch: Record<string, unknown> = {
        'messages.upsert': { type: 'notify', messages: [randomMessage(r), randomMessage(r), sentinel] },
        'messages.reaction': [{ key: value(r, 2) ?? {}, reaction: { key: randomMessage(r).key, text: value(r, 3) } }],
        call: [{ id: `C${seed}`, from: r() < 0.8 ? jid : value(r, 3), status: value(r, 3), groupJid: r() < 0.3 ? jid : undefined }],
        'group-participants.update': { id: r() < 0.8 ? jid : value(r, 3), action: value(r, 3), participants: value(r, 1) ?? [], author: value(r, 3) },
        'presence.update': { id: jid, presences: { [JIDS[(seed + 1) % JIDS.length]!]: { lastKnownPresence: 'available' } } },
      }
      try {
        await h.emit(batch)
      } catch (error) {
        throw new Error(`seed ${seed} threw: ${error instanceof Error ? error.stack : String(error)}`)
      }
    }
    spy.mockRestore()
    const sentinels = h.ofKind('message').filter((e) => e.message.ref.id.startsWith('SENTINEL-'))
    expect(sentinels).toHaveLength(600)
    // Failures are logged with the error only: never a message body.
    expect(JSON.stringify(logged.map((a) => a[1]))).not.toMatch(/hola|ok"/)
    for (const e of h.events) {
      if (e.kind === 'message') {
        expect(typeof e.message.chatId).toBe('string')
        expect(typeof e.message.senderId).toBe('string')
        expect(typeof e.message.body).toBe('string')
        expect(typeof e.message.ref.id).toBe('string')
        expect(Number.isFinite(e.message.timestamp)).toBe(true)
      }
      if (e.kind === 'reaction') expect(typeof e.reaction.senderId).toBe('string')
    }
  })
})

describe('fuzz: untrusted stored data', () => {
  it('parseBaileysMediaRef rejects anything malformed with a ProviderError only', () => {
    for (let seed = 1; seed <= 2000; seed++) {
      const r = rng(seed)
      const stored = (r() < 0.5 ? { v: r() < 0.7 ? 1 : value(r, 3), data: value(r, 0) } : value(r, 0)) as SerializedMediaRef
      try {
        parseBaileysMediaRef(stored, (['image', 'video', 'audio', 'voice', 'document', 'sticker'] as const)[seed % 6])
      } catch (error) {
        if (!(error instanceof ProviderError)) throw new Error(`seed ${seed}: ${String(error)}`)
      }
    }
  })

  it('fromStoredPoll returns a poll or undefined, never throws', () => {
    for (let seed = 1; seed <= 2000; seed++) {
      const r = rng(seed)
      const stored = r() < 0.5
        ? { id: 'P', key: value(r, 2), secret: r() < 0.5 ? Buffer.alloc(32).toString('base64') : value(r, 3), options: value(r, 1), votes: value(r, 1), name: value(r, 3) }
        : value(r, 0)
      expect(() => fromStoredPoll('P', stored)).not.toThrow()
    }
  })
})
