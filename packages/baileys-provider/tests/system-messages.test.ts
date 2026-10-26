/**
 * Baileys emits EVERY decrypted stanza as a `messages.upsert` before processing
 * it: reactions, deletes/edits (protocol messages), sender-key distributions and
 * placeholder stubs (failed decryption, group notices). None of those is a user
 * message: emitting them as `type: 'unknown'` made a catch-all handler answer
 * every reaction or deleted message. Reactions still reach the bot through
 * `messages.reaction` (the `reaction` event).
 */
import { describe, expect, it, vi } from 'vitest'
import type { WAMessage } from '@whiskeysockets/baileys'

vi.mock('@whiskeysockets/baileys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@whiskeysockets/baileys')>()
  const { fakeMakeWASocket } = await import('./support/harness.js')
  return { ...actual, default: fakeMakeWASocket, makeCacheableSignalKeyStore: (keys: unknown) => keys }
})

const { BaileysProvider } = await import('../src/BaileysProvider.js')
const { connect } = await import('./support/harness.js')

const PN = '573001112233@s.whatsapp.net'
const GROUP = '120363000000000000@g.us'

let n = 0
const upsert = (message: Record<string, unknown> | null | undefined, extra: Record<string, unknown> = {}): WAMessage =>
  ({ key: { remoteJid: PN, fromMe: false, id: `S-${++n}` }, message, messageTimestamp: 1_700_000_000, ...extra } as unknown as WAMessage)

describe('system stanzas are not user messages', () => {
  const cases: Array<[string, WAMessage]> = [
    ['a reaction', upsert({ reactionMessage: { key: { remoteJid: PN, id: 'T', fromMe: true }, text: '👍' } })],
    ['an encrypted reaction', upsert({ encReactionMessage: { targetMessageKey: { id: 'T' } } })],
    ['a delete for everyone', upsert({ protocolMessage: { type: 0, key: { remoteJid: PN, id: 'T' } } })],
    ['an edit (editedMessage wrapper)', upsert({ editedMessage: { message: { protocolMessage: { type: 14, editedMessage: { conversation: 'fixed' } } } } })],
    ['a disappearing-mode setting', upsert({ protocolMessage: { type: 3, ephemeralExpiration: 86400 } })],
    ['a bare sender-key distribution', upsert({ senderKeyDistributionMessage: { groupId: GROUP }, messageContextInfo: {} }, { key: { remoteJid: GROUP, participant: PN, id: 'SK', fromMe: false } })],
    ['a failed-decryption placeholder (no content)', upsert(undefined, { messageStubType: 2, messageStubParameters: ['No session'] })],
    ['a group notice stub', upsert(null, { messageStubType: 27, key: { remoteJid: GROUP, participant: PN, id: 'ST', fromMe: false } })],
  ]

  for (const [label, message] of cases) {
    it(`does not emit ${label} as a message`, async () => {
      const h = await connect(BaileysProvider)
      await h.emit({ 'messages.upsert': { type: 'notify', messages: [message] } })
      expect(h.ofKind('message')).toEqual([])
    })
  }

  it('still emits a group text that carries a sender-key distribution next to it', async () => {
    const h = await connect(BaileysProvider)
    await h.emit({
      'messages.upsert': {
        type: 'notify',
        messages: [upsert(
          { conversation: 'hola', senderKeyDistributionMessage: { groupId: GROUP }, messageContextInfo: {} },
          { key: { remoteJid: GROUP, participant: PN, id: 'G1', fromMe: false } },
        )],
      },
    })
    const [event] = h.ofKind('message')
    expect(event?.message).toMatchObject({ type: 'text', body: 'hola', chatId: GROUP, senderId: PN })
  })

  it('still emits user content Baileys does not classify (type unknown)', async () => {
    const h = await connect(BaileysProvider)
    await h.emit({ 'messages.upsert': { type: 'notify', messages: [upsert({ eventMessage: { name: 'Party' } })] } })
    expect(h.ofKind('message').map((e) => e.message.type)).toEqual(['unknown'])
  })
})

describe('events from ignored chats', () => {
  it('drops reactions in status@broadcast and newsletters like their messages', async () => {
    const h = await connect(BaileysProvider)
    for (const remoteJid of ['status@broadcast', '120363999999999999@newsletter']) {
      await h.emit({
        'messages.reaction': [{
          key: { remoteJid, fromMe: true, id: 'STATUS-1' },
          reaction: { key: { remoteJid, participant: PN, fromMe: false, id: `R-${remoteJid}` }, text: '🔥' },
        }],
      })
    }
    expect(h.ofKind('reaction')).toEqual([])
  })

  it('keeps reactions in a DM', async () => {
    const h = await connect(BaileysProvider)
    await h.emit({
      'messages.reaction': [{
        key: { remoteJid: PN, fromMe: true, id: 'OUT-1' },
        reaction: { key: { remoteJid: PN, fromMe: false, id: 'R1' }, text: '🔥' },
      }],
    })
    expect(h.ofKind('reaction')).toHaveLength(1)
  })
})
