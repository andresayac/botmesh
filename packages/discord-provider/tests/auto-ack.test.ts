/**
 * Interaction auto-acknowledgement: Discord fails an interaction the bot does not answer
 * within ~3 s, so the provider defers it on its own when no handler acknowledged it in
 * time (`autoAcknowledgeMs`), and a late `ctx.acknowledge(text)` still shows its text.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import pino from 'pino'
import { Bot } from '@botmesh/core'
import { DiscordProvider } from '../src/DiscordProvider.js'
import { fakeSocketFactory, wait } from './_fakeSocket.js'

interface Call { url: string; body: unknown }
function stubRest(): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body })
    return new Response(JSON.stringify({ id: `OUT${calls.length}` }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
  return calls
}
afterEach(() => { vi.unstubAllGlobals() })

const hello = { op: 10, d: { heartbeat_interval: 45_000 } }
const ready = { op: 0, s: 1, t: 'READY', d: { session_id: 'S1', resume_gateway_url: 'wss://resume.discord.gg', user: { id: 'BOT' } } }
const click = (id: string, type = 3, data: Record<string, unknown> = { component_type: 2, custom_id: 'confirm' }) => ({
  op: 0, s: 50, t: 'INTERACTION_CREATE',
  d: { id, token: `tok-${id}`, type, channel_id: 'C1', guild_id: 'G1', member: { user: { id: 'U1' } }, data, message: { id: 'M1' } },
})
const callbacks = (calls: Call[]) => calls.filter((c) => c.url.includes('/callback'))

async function setup(extra: Record<string, unknown> = {}) {
  const calls = stubRest()
  const { sockets, factory } = fakeSocketFactory()
  const provider = new DiscordProvider({ token: 'TOKEN', appId: 'APP', socketFactory: factory, logger: pino({ level: 'silent' }), ...extra })
  const bot = new Bot({ provider })
  return { calls, sockets, provider, bot }
}

describe('Discord interaction auto-acknowledgement', () => {
  it('defers a component interaction no handler acknowledged (type 6)', async () => {
    const { calls, sockets, bot } = await setup({ autoAcknowledgeMs: 30 })
    bot.when('confirm', async () => { /* slow handler that never acknowledges */ })
    await bot.start()
    try {
      sockets[0].serverSend(hello); sockets[0].serverSend(ready)
      sockets[0].serverSend(click('1234567890123456789'))
      await wait(80)
      expect(callbacks(calls)).toEqual([{ url: 'https://discord.com/api/v10/interactions/1234567890123456789/tok-1234567890123456789/callback', body: { type: 6 } }])
    } finally { await bot.stop() }
  })

  it('defers a slash command with "thinking" (type 5)', async () => {
    const { calls, sockets, bot } = await setup({ autoAcknowledgeMs: 30 })
    await bot.start()
    try {
      sockets[0].serverSend(hello); sockets[0].serverSend(ready)
      sockets[0].serverSend(click('1234567890123456790', 2, { name: 'menu' }))
      await wait(80)
      expect(callbacks(calls).map((c) => c.body)).toEqual([{ type: 5 }])
    } finally { await bot.stop() }
  })

  it('does not ack twice when the handler acknowledged in time', async () => {
    const { calls, sockets, bot } = await setup({ autoAcknowledgeMs: 40 })
    bot.when('confirm', async (ctx) => { await ctx.acknowledge?.() })
    await bot.start()
    try {
      sockets[0].serverSend(hello); sockets[0].serverSend(ready)
      sockets[0].serverSend(click('1234567890123456791'))
      await wait(100)
      expect(callbacks(calls)).toHaveLength(1)
    } finally { await bot.stop() }
  })

  it('a late acknowledge(text) after the auto-defer posts the text as a followup', async () => {
    const { calls, sockets, bot } = await setup({ autoAcknowledgeMs: 20 })
    bot.when('confirm', async (ctx) => { await wait(60); await ctx.acknowledge?.('Listo') })
    await bot.start()
    try {
      sockets[0].serverSend(hello); sockets[0].serverSend(ready)
      sockets[0].serverSend(click('1234567890123456792'))
      await wait(150)
      expect(callbacks(calls)).toHaveLength(1)
      const followup = calls.find((c) => c.url === 'https://discord.com/api/v10/webhooks/APP/tok-1234567890123456792')
      expect(followup?.body).toEqual({ content: 'Listo' })
    } finally { await bot.stop() }
  })

  it('without appId, a late acknowledge(text) uses the application id from READY', async () => {
    const { calls, sockets, bot } = await setup({ autoAcknowledgeMs: 20, appId: undefined })
    bot.when('confirm', async (ctx) => { await wait(60); await ctx.acknowledge?.('Listo') })
    await bot.start()
    try {
      sockets[0].serverSend(hello)
      sockets[0].serverSend({ ...ready, d: { ...ready.d, application: { id: '987654321098765432' } } })
      sockets[0].serverSend(click('1234567890123456795'))
      await wait(150)
      const followup = calls.find((c) => c.url === 'https://discord.com/api/v10/webhooks/987654321098765432/tok-1234567890123456795')
      expect(followup?.body).toEqual({ content: 'Listo' })
    } finally { await bot.stop() }
  })

  it('without appId, the application id of the interaction itself is used', async () => {
    const { calls, sockets, bot } = await setup({ autoAcknowledgeMs: 20, appId: undefined })
    bot.when('confirm', async (ctx) => { await wait(60); await ctx.acknowledge?.('Listo') })
    await bot.start()
    try {
      sockets[0].serverSend(hello); sockets[0].serverSend(ready)
      const event = click('1234567890123456796')
      sockets[0].serverSend({ ...event, d: { ...event.d, application_id: '987654321098765433' } })
      await wait(150)
      expect(calls.some((c) => c.url === 'https://discord.com/api/v10/webhooks/987654321098765433/tok-1234567890123456796')).toBe(true)
    } finally { await bot.stop() }
  })

  it('a late acknowledge(text) that cannot be delivered rejects instead of dropping the text', async () => {
    const { sockets, provider } = await setup({ autoAcknowledgeMs: 20, appId: undefined })
    let seen: string | undefined
    provider.onEvent((e) => { if (e.kind === 'interaction') seen = e.interaction.interactionId })
    await provider.start()
    try {
      sockets[0].serverSend(hello); sockets[0].serverSend(ready)
      sockets[0].serverSend(click('1234567890123456797'))
      await wait(60)
      expect(seen).toBeDefined()
      await expect(provider.acknowledgeInteraction(seen!, { text: 'Listo' })).rejects.toThrow(/appId/)
      // A plain acknowledge (no text) after the auto-defer is still a no-op.
      await expect(provider.acknowledgeInteraction(seen!)).resolves.toBeUndefined()
    } finally { await provider.stop() }
  })

  it('autoAcknowledgeMs: false turns it off; invalid values are rejected', async () => {
    const { calls, sockets, bot } = await setup({ autoAcknowledgeMs: false })
    await bot.start()
    try {
      sockets[0].serverSend(hello); sockets[0].serverSend(ready)
      sockets[0].serverSend(click('1234567890123456793'))
      await wait(60)
      expect(callbacks(calls)).toHaveLength(0)
    } finally { await bot.stop() }
    expect(() => new DiscordProvider({ token: 'T', autoAcknowledgeMs: 3000 })).toThrow(/autoAcknowledgeMs/)
    expect(() => new DiscordProvider({ token: 'T', autoAcknowledgeMs: -1 })).toThrow(/autoAcknowledgeMs/)
  })

  it('stop() cancels pending auto-acks', async () => {
    const { calls, sockets, bot } = await setup({ autoAcknowledgeMs: 40 })
    await bot.start()
    sockets[0].serverSend(hello); sockets[0].serverSend(ready)
    sockets[0].serverSend(click('1234567890123456794'))
    await bot.stop()
    await wait(80)
    expect(callbacks(calls)).toHaveLength(0)
  })
})
