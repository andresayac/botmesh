/**
 * End-to-end through the public API: Bot + DiscordProvider over a fake gateway
 * socket and a stubbed REST `fetch` (no network): a message answered in its
 * channel, a button press acknowledged, and stop/start hygiene (no leaked
 * heartbeat timers).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import pino from 'pino'
import { Bot } from '@botmesh/core'
import { DiscordProvider } from '../src/DiscordProvider.js'
import { fakeSocketFactory, wait } from './_fakeSocket.js'

async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition')
    await wait(5)
  }
}

interface Call { url: string; method: string; body: unknown }
function stubRest(): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body })
    return new Response(JSON.stringify({ id: `OUT${calls.length}` }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
  return calls
}
afterEach(() => { vi.unstubAllGlobals() })

const hello = { op: 10, d: { heartbeat_interval: 45_000 } }
const ready = { op: 0, s: 1, t: 'READY', d: { session_id: 'S1', resume_gateway_url: 'wss://resume.discord.gg', user: { id: 'BOT' } } }
let seq = 1
const message = (content: string, extra: Record<string, unknown> = {}) => ({
  op: 0, s: ++seq, t: 'MESSAGE_CREATE',
  d: { id: String(1234567890123456789n + BigInt(seq)), channel_id: 'C1', guild_id: 'G1', author: { id: 'U1', username: 'ana' }, content, mentions: [], attachments: [], type: 0, ...extra },
})

describe('Discord + Bot end to end', () => {
  it('answers a guild message in its channel; ignores its own echo and system messages', async () => {
    const calls = stubRest()
    const { sockets, factory } = fakeSocketFactory()
    const provider = new DiscordProvider({ token: 'TOKEN', socketFactory: factory, logger: pino({ level: 'silent' }) })
    const bot = new Bot({ provider })
    bot.when('hola', (ctx) => ctx.reply(`¡Hola <@${ctx.sender}>! 🎉`))
    await bot.start()
    try {
      sockets[0].serverSend(hello)
      sockets[0].serverSend(ready)
      sockets[0].serverSend(message('hola'))
      sockets[0].serverSend(message('hola', { author: { id: 'BOT', bot: true } }))
      sockets[0].serverSend(message('', { type: 7 }))
      await until(() => calls.length >= 1)
      await wait(30)
      expect(calls).toHaveLength(1)
      expect(calls[0]!.url).toBe('https://discord.com/api/v10/channels/C1/messages')
      expect(calls[0]!.body).toEqual({ content: '¡Hola <@U1>! 🎉' })
    } finally {
      await bot.stop()
    }
  })

  it('a button press reaches the handler and ctx.acknowledge() answers the interaction callback', async () => {
    const calls = stubRest()
    const { sockets, factory } = fakeSocketFactory()
    const provider = new DiscordProvider({ token: 'TOKEN', socketFactory: factory, logger: pino({ level: 'silent' }) })
    const bot = new Bot({ provider })
    const seen: string[] = []
    bot.when('confirm', async (ctx) => { seen.push(ctx.body); await ctx.acknowledge?.() })
    await bot.start()
    try {
      sockets[0].serverSend(hello)
      sockets[0].serverSend(ready)
      sockets[0].serverSend({
        op: 0, s: 50, t: 'INTERACTION_CREATE',
        d: { id: '1234567890123456789', token: 'itok', type: 3, channel_id: 'C1', guild_id: 'G1', member: { user: { id: 'U1' } }, data: { component_type: 2, custom_id: 'confirm' }, message: { id: 'M1' } },
      })
      await until(() => calls.length >= 1)
      expect(seen).toEqual(['confirm'])
      expect(calls[0]!.url).toBe('https://discord.com/api/v10/interactions/1234567890123456789/itok/callback')
      expect(calls[0]!.body).toEqual({ type: 6 })
    } finally {
      await bot.stop()
    }
  })

  it('stop/start cycles close the socket and leave no heartbeat or reconnect timers', async () => {
    stubRest()
    const { sockets, factory } = fakeSocketFactory()
    const provider = new DiscordProvider({ token: 'TOKEN', socketFactory: factory, logger: pino({ level: 'silent' }) })
    const bot = new Bot({ provider })
    const timers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length
    const baseline = timers()
    for (let i = 0; i < 4; i++) {
      await bot.start()
      const s = sockets[sockets.length - 1]!
      s.serverSend(hello)
      s.serverSend(ready)
      s.emit('close', 1006) // a drop schedules a reconnect timer…
      await bot.stop() // …that stop() must cancel
    }
    await wait(20)
    expect(timers()).toBeLessThanOrEqual(baseline)
    expect(sockets).toHaveLength(4) // no reconnect fired after stop()
  })
})
