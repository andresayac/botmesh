import { describe, it, expect, vi } from 'vitest'
import { Bot } from '../src/core/Bot.js'
import { MockProvider, type MockProviderOptions } from '../src/testing/MockProvider.js'
import type { ChatId, OutboundContent, SendOptions, SendResult } from '../src/core/provider.js'

/** Records acks and sends in one ordered log. */
class LoggingProvider extends MockProvider {
  log: string[] = []
  failAck = false
  constructor(opts: MockProviderOptions = {}) { super(opts) }
  override async acknowledgeInteraction(interactionId: string, opts?: { text?: string; defer?: boolean }): Promise<void> {
    if (this.failAck) throw new Error('ack rejected')
    this.log.push(`ack:${opts?.defer ? 'defer' : opts?.text ?? ''}`)
    await super.acknowledgeInteraction(interactionId, opts)
  }
  override async send(chatId: ChatId, content: OutboundContent, options?: SendOptions): Promise<SendResult> {
    this.log.push(`send:${content.kind === 'text' ? content.text : content.kind}`)
    return super.send(chatId, content, options)
  }
}

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))

async function setup(opts: MockProviderOptions = { interactionsRequireAck: true }) {
  const provider = new LoggingProvider(opts)
  const bot = new Bot({ provider })
  return { bot, provider }
}

describe('interaction auto-acknowledgement (capabilities.interactionsRequireAck)', () => {
  it('MockProvider simulates interactionsRequireAck', () => {
    expect(new MockProvider({ interactionsRequireAck: true }).capabilities.interactionsRequireAck).toBe(true)
    expect(new MockProvider().capabilities.interactionsRequireAck).toBe(false)
  })

  it('defers the ack before the first reply of a handler that only replies', async () => {
    const { bot, provider } = await setup()
    bot.when('cafe', async (ctx) => { await ctx.reply('elegiste cafe') })
    await bot.start()
    provider.interaction('cafe')
    await vi.waitFor(() => expect(provider.log).toEqual(['ack:defer', 'send:elegiste cafe']))
    await tick()
    expect(provider.acks).toEqual([{ interactionId: expect.any(String), opts: { defer: true } }])
  })

  it('an explicit ctx.acknowledge(text) is the only ack', async () => {
    const { bot, provider } = await setup()
    bot.when('ok', async (ctx) => { await ctx.acknowledge?.('listo'); await ctx.reply('hecho') })
    await bot.start()
    provider.interaction('ok')
    await vi.waitFor(() => expect(provider.log).toEqual(['ack:listo', 'send:hecho']))
    await tick()
    expect(provider.acks).toHaveLength(1)
  })

  it('acks (deferred) after a handler that sends nothing', async () => {
    const { bot, provider } = await setup()
    const seen = vi.fn()
    bot.when('silencio', seen)
    await bot.start()
    provider.interaction('silencio')
    await vi.waitFor(() => expect(provider.log).toEqual(['ack:defer']))
    expect(seen).toHaveBeenCalledOnce()
  })

  it('acks before respondBy while a slow handler is still running', async () => {
    const { bot, provider } = await setup()
    let finished = false
    bot.when('lento', async () => { await tick(600); finished = true })
    await bot.start()
    provider.interaction('lento', { respondBy: Date.now() + 700 })
    await tick(350)
    expect(provider.log).toEqual(['ack:defer'])
    expect(finished).toBe(false)
    await vi.waitFor(() => expect(finished).toBe(true))
    expect(provider.acks).toHaveLength(1)
  })

  it('a ctx.acknowledge(text) after the auto-ack sends the text as a reply instead', async () => {
    const { bot, provider } = await setup()
    bot.when('tarde', async (ctx) => { await ctx.reply('uno'); await ctx.acknowledge?.('dos'); await ctx.acknowledge?.() })
    await bot.start()
    provider.interaction('tarde')
    await vi.waitFor(() => expect(provider.log).toEqual(['ack:defer', 'send:uno', 'send:dos']))
    await tick()
    expect(provider.acks).toHaveLength(1)
  })

  it('does not ack an interaction whose deadline already passed (e.g. a replay)', async () => {
    const { bot, provider } = await setup()
    bot.when('viejo', async (ctx) => { await ctx.reply('hola') })
    await bot.start()
    provider.interaction('viejo', { respondBy: Date.now() - 1000 })
    await vi.waitFor(() => expect(provider.log).toEqual(['send:hola']))
    await tick()
    expect(provider.acks).toEqual([])
  })

  it('a failing auto-ack does not block the reply', async () => {
    const { bot, provider } = await setup()
    provider.failAck = true
    bot.when('falla', async (ctx) => { await ctx.reply('igual') })
    await bot.start()
    provider.interaction('falla')
    await vi.waitFor(() => expect(provider.log).toEqual(['send:igual']))
  })

  it('never acks plain messages', async () => {
    const { bot, provider } = await setup()
    bot.when('hola', async (ctx) => { await ctx.reply('hola') })
    await bot.start()
    provider.incoming('hola')
    await vi.waitFor(() => expect(provider.log).toEqual(['send:hola']))
    await tick()
    expect(provider.acks).toEqual([])
  })

  it('leaves transports without interactionsRequireAck untouched (no implicit ack)', async () => {
    const { bot, provider } = await setup({})
    bot.when('cafe', async (ctx) => { await ctx.reply('elegiste cafe') })
    await bot.start()
    provider.interaction('cafe')
    await vi.waitFor(() => expect(provider.log).toEqual(['send:elegiste cafe']))
    await tick()
    expect(provider.acks).toEqual([])
  })
})
