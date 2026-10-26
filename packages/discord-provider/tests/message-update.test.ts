import { describe, it, expect, vi, afterEach } from 'vitest'
import pino from 'pino'
import { Bot } from '@botmesh/core'
import type { InboundEvent, InboundMessage } from '@botmesh/core'
import { DiscordProvider, isEditedMessage, parseDispatch } from '../src/index.js'
import { fakeSocketFactory, wait } from './_fakeSocket.js'

const original = {
  id: '1234567890123456789', channel_id: 'C1', guild_id: 'G1', type: 0,
  author: { id: 'U1', username: 'ana' }, content: 'helo', timestamp: '2024-01-01T00:00:00.000Z',
  edited_timestamp: null, mentions: [], attachments: [],
}
const edit = { ...original, content: 'hello', edited_timestamp: '2024-01-01T00:01:00.000Z' }

const messageOf = (e: InboundEvent | undefined): InboundMessage => {
  if (e?.kind !== 'message') throw new Error('expected a message')
  return e.message
}

afterEach(() => { vi.unstubAllGlobals() })

describe('Discord MESSAGE_UPDATE', () => {
  it('an edit becomes a message that keeps the original id and is marked as an edit', () => {
    const m = messageOf(parseDispatch('MESSAGE_UPDATE', edit, null))
    expect(m.ref.id).toBe('1234567890123456789')
    expect(m.chatId).toBe('C1')
    expect(m.body).toBe('hello')
    expect(m.timestamp).toBe(Date.parse('2024-01-01T00:00:00.000Z')) // original send time
    expect(isEditedMessage(m)).toBe(true)
    expect(isEditedMessage(messageOf(parseDispatch('MESSAGE_CREATE', original, null)))).toBe(false)
  })

  it('ignores updates that are not edits (embed unfurls, pins, partial payloads) and bot edits', () => {
    expect(parseDispatch('MESSAGE_UPDATE', { ...original, edited_timestamp: null }, null)).toBeUndefined()
    expect(parseDispatch('MESSAGE_UPDATE', { id: original.id, channel_id: 'C1', embeds: [] }, null)).toBeUndefined()
    expect(parseDispatch('MESSAGE_UPDATE', { ...edit, author: { id: 'B', bot: true } }, null)).toBeUndefined()
    expect(parseDispatch('MESSAGE_UPDATE', { ...edit, edited_timestamp: 42 }, null)).toBeUndefined()
  })

  it('reaches the bot through the gateway; editedMessages: "ignore" drops it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })))
    for (const mode of ['deliver', 'ignore'] as const) {
      const { sockets, factory } = fakeSocketFactory()
      const provider = new DiscordProvider({ token: 'TOKEN', socketFactory: factory, logger: pino({ level: 'silent' }), editedMessages: mode })
      const bodies: string[] = []
      provider.onEvent((e) => { if (e.kind === 'message') bodies.push(e.message.body) })
      await provider.start()
      sockets[0]!.serverSend({ op: 10, d: { heartbeat_interval: 45_000 } })
      sockets[0]!.serverSend({ op: 0, s: 1, t: 'READY', d: { session_id: 'S', resume_gateway_url: 'wss://r', user: { id: 'BOT' } } })
      sockets[0]!.serverSend({ op: 0, s: 2, t: 'MESSAGE_CREATE', d: original })
      sockets[0]!.serverSend({ op: 0, s: 3, t: 'MESSAGE_UPDATE', d: edit })
      await wait(20)
      await provider.stop()
      expect(bodies).toEqual(mode === 'deliver' ? ['helo', 'hello'] : ['helo'])
    }
  })

  it('the core deduper lets the edit reach a handler but not a redelivery of the same edit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"id":"O"}', { status: 200, headers: { 'content-type': 'application/json' } })))
    const { sockets, factory } = fakeSocketFactory()
    const provider = new DiscordProvider({ token: 'TOKEN', socketFactory: factory, logger: pino({ level: 'silent' }) })
    const bot = new Bot({ provider })
    const seen: Array<[string, string, boolean]> = []
    bot.onMessage((ctx) => { seen.push([ctx.ref.id, ctx.body, isEditedMessage(ctx)]) })
    await bot.start()
    try {
      sockets[0]!.serverSend({ op: 10, d: { heartbeat_interval: 45_000 } })
      sockets[0]!.serverSend({ op: 0, s: 1, t: 'READY', d: { session_id: 'S', resume_gateway_url: 'wss://r', user: { id: 'BOT' } } })
      sockets[0]!.serverSend({ op: 0, s: 2, t: 'MESSAGE_CREATE', d: original })
      sockets[0]!.serverSend({ op: 0, s: 3, t: 'MESSAGE_UPDATE', d: edit })
      sockets[0]!.serverSend({ op: 0, s: 4, t: 'MESSAGE_UPDATE', d: edit })
      await wait(50)
      expect(seen).toEqual([[original.id, 'helo', false], [original.id, 'hello', true]])
    } finally {
      await bot.stop()
    }
  })

  it('rejects an invalid editedMessages value', () => {
    expect(() => new DiscordProvider({ token: 'TOKEN', editedMessages: 'drop' as never })).toThrow(/editedMessages/)
  })
})
