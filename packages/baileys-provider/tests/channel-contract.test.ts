/**
 * The inbound shape contract (epoch-ms timestamps, message fields), checked with the
 * reusable helper from `@botmesh/core/testing` against this provider's normalization path.
 */
import { describe, it, expect } from 'vitest'
import { assertCapabilityContract, assertInboundContract, assertPresenceWhileDisconnected } from '@botmesh/core/testing'
import { BaileysProvider } from '../src/BaileysProvider.js'
import type { WAMessage } from '@whiskeysockets/baileys'
import { IdentityStore } from '../src/identity.js'
import { toInbound } from '../src/toInbound.js'

const PN = '573001112233@s.whatsapp.net'
const msg = (message: Record<string, unknown>, extra: Record<string, unknown> = {}): WAMessage =>
  ({ key: { remoteJid: PN, fromMe: false, id: 'M1' }, message, messageTimestamp: 1_760_000_000, ...extra } as unknown as WAMessage)

describe('Baileys toInbound — inbound contract', () => {
  it('emits epoch ms for text, media and location messages', () => {
    const identity = new IdentityStore()
    const events = [
      toInbound(msg({ conversation: 'hola' }), identity),
      toInbound(msg({ imageMessage: { caption: 'foto', mimetype: 'image/jpeg' } }), identity),
      toInbound(msg({ locationMessage: { degreesLatitude: 4.6, degreesLongitude: -74.1 } }), identity),
    ]
    assertInboundContract(events)
    expect(events[0]?.timestamp).toBe(1_760_000_000_000)
  })

  it('uses the receive time when the message carries no timestamp', () => {
    const before = Date.now()
    const m = toInbound(msg({ conversation: 'hola' }, { messageTimestamp: undefined }), new IdentityStore())
    assertInboundContract([m])
    expect(m.timestamp).toBeGreaterThanOrEqual(before)
  })
})

describe('capability contract', () => {
  it('capability flags agree with the optional methods (unsupported = absent)', () => {
    assertCapabilityContract(new BaileysProvider())
  })

  it('markRead / typing resolve without a socket call while not connected', async () => {
    await assertPresenceWhileDisconnected(new BaileysProvider(), { chatId: PN })
  })
})

describe('local media path that cannot be read', () => {
  it('rejects with UnsupportedContentError naming the file, not a raw ENOENT', async () => {
    const { UnsupportedContentError } = await import('@botmesh/core')
    const { toOutbound } = await import('../src/toOutbound.js')
    const missing = 'C:/definitely/missing/botmesh-photo.png'
    for (const media of [missing, { path: missing }]) {
      const err = await toOutbound({ kind: 'image', media }).then(() => undefined, (e: unknown) => e)
      expect(err).toBeInstanceOf(UnsupportedContentError)
      expect((err as Error).message).toContain('botmesh-photo.png')
    }
  })
})
