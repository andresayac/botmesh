/**
 * End-to-end scenarios of the AI plugin through the public API (Bot + MockProvider +
 * MockAIProvider): many chats at once, bursts on one chat, groups, hung providers,
 * stop/start cycles, unicode, and resource hygiene after `bot.stop()`.
 */
import { describe, it, expect } from 'vitest'
import { createTestBot } from '@botmesh/core/testing'
import { MockAIProvider } from '../src/MockAIProvider.js'
import { aiPlugin, type AIPluginConfig } from '../src/plugin.js'
import type { AIProvider, GenerateInput, GenerateResult } from '../src/types.js'
import type { AIToolSet } from '../src/tools/types.js'

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms))

/** Seeded PRNG (mulberry32): reproducible "random" delays. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Echoes the last user message after a random delay, reporting how many turns it saw. */
class EchoProvider implements AIProvider {
  readonly name = 'echo'
  constructor(private readonly delay: () => number = () => 0) {}
  async generate(input: GenerateInput): Promise<GenerateResult> {
    const ms = this.delay()
    if (ms) await new Promise((r) => setTimeout(r, ms))
    const last = input.messages.at(-1)
    return { text: `echo(${input.messages.length}): ${last?.content ?? ''}`, model: 'echo' }
  }
  async *stream(input: GenerateInput): AsyncIterable<string> {
    yield (await this.generate(input)).text
  }
}

/** A provider that never answers unless aborted (then rejects with the abort reason). */
class HangingProvider implements AIProvider {
  readonly name = 'hang'
  started = 0
  aborted = 0
  generate(input: GenerateInput): Promise<GenerateResult> {
    this.started++
    return new Promise((_, reject) => {
      input.signal?.addEventListener('abort', () => { this.aborted++; reject(input.signal!.reason ?? new Error('aborted')) }, { once: true })
    })
  }
  async *stream(input: GenerateInput): AsyncIterable<string> {
    yield await this.generate(input).then((r) => r.text)
  }
}

async function setup(cfg: AIPluginConfig = {}) {
  const t = await createTestBot()
  t.bot.plug(aiPlugin({ ...cfg }))
  return t
}

describe('e2e: concurrency', () => {
  it('50 chats at once each get their own answer and history', async () => {
    const random = rng(42)
    const { bot, dm } = await setup({ instance: new EchoProvider(() => Math.floor(random() * 15)) })
    const chats = Array.from({ length: 50 }, (_, i) => dm(`u${i}@s.whatsapp.net`))
    await Promise.all(chats.map((c, i) => c.send(`hola ${i} 👋`)))
    await Promise.all(chats.map((c, i) => c.expectReply(`echo(1): hola ${i} 👋`, 3000)))
    await Promise.all(chats.map((c, i) => c.send(`otra ${i}`)))
    await Promise.all(chats.map((c, i) => c.expectReply(`echo(3): otra ${i}`, 3000)))
    for (const c of chats) expect(c.replies()).toHaveLength(2)
    await bot.stop()
  })

  it('a burst on one chat is answered in order, each turn seeing the previous ones', async () => {
    const random = rng(7)
    const { bot, chat } = await setup({ instance: new EchoProvider(() => Math.floor(random() * 10)) })
    for (let i = 0; i < 8; i++) await chat.send(`m${i}`)
    await chat.expectReply('echo(15): m7', 3000)
    expect(chat.replies()).toEqual(Array.from({ length: 8 }, (_, i) => `echo(${2 * i + 1}): m${i}`))
    await bot.stop()
  })

  it('group participants keep separate histories', async () => {
    const { bot, group } = await setup({ instance: new EchoProvider() })
    const ana = group('g1@g.us', { as: 'ana@s.whatsapp.net' })
    const bob = ana.as('bob@s.whatsapp.net')
    await ana.send('soy ana'); await ana.expectReply('echo(1): soy ana')
    await bob.send('soy bob'); await bob.expectReply('echo(1): soy bob')
    await ana.send('y yo?'); await ana.expectReply('echo(3): y yo?')
    await bot.stop()
  })
})

describe('e2e: unhappy paths', () => {
  it('a hung provider times out, answers errorMessage, and the chat keeps working', async () => {
    let hang = true
    const mock = new MockAIProvider({ reply: 'ok now' })
    const real = mock.generate.bind(mock)
    mock.generate = (input) => (hang ? new Promise(() => {}) : real(input))
    const { bot, chat } = await setup({ instance: mock, timeoutMs: 40, errorMessage: 'caído' })
    await chat.send('hola')
    await chat.expectReply('caído', 2000)
    hang = false
    await chat.send('otra')
    await chat.expectReply('ok now')
    await bot.stop()
  })

  it('whitespace-only text is not sent to the model', async () => {
    const mock = new MockAIProvider({ reply: 'x' })
    const { bot, chat } = await setup({ instance: mock })
    await chat.send('   \n\t ')
    await chat.expectNoReply({ timeout: 50 })
    expect(mock.calls).toHaveLength(0)
    await bot.stop()
  })

  it('unicode, emoji and RTL survive the round trip and the formatter', async () => {
    const text = '¡Hola! 👨‍👩‍👧 שלום مرحبا 𝔘𝔫𝔦𝔠𝔬𝔡𝔢 **negrita** ñandú'
    const mock = new MockAIProvider({ reply: (i) => String(i.messages.at(-1)?.content) })
    const t = await createTestBot({}, { provider: { textFormat: 'whatsapp' } })
    t.bot.plug(aiPlugin({ instance: mock }))
    await t.chat.send(text)
    await t.chat.expectReply('¡Hola! 👨‍👩‍👧 שלום مرحبا 𝔘𝔫𝔦𝔠𝔬𝔡𝔢 *negrita* ñandú')
    await t.bot.stop()
  })

  it('stop() aborts in-flight model calls: no timer keeps the process alive', async () => {
    const hang = new HangingProvider()
    const { bot, chat } = await setup({ instance: hang })
    const before = new Set(process.getActiveResourcesInfo())
    await chat.send('hola')
    await tick()
    expect(hang.started).toBe(1)
    await bot.stop()
    await tick()
    expect(hang.aborted).toBe(1)
    const timers = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length
    const timersBefore = [...before].filter((r) => r === 'Timeout').length
    expect(timers).toBeLessThanOrEqual(timersBefore)
  })

  it('stop() also aborts a streamed answer that is still waiting for the model', async () => {
    const hang = new HangingProvider()
    const t = await createTestBot({}, { provider: { streaming: 'edit' } })
    t.bot.plug(aiPlugin({ instance: hang, stream: true }))
    await t.chat.send('hola')
    await tick()
    expect(hang.started).toBe(1)
    await t.bot.stop()
    await tick()
    expect(hang.aborted).toBe(1)
  })

  it('stop/start cycles: the plugin keeps answering after a restart', async () => {
    const { bot, chat } = await setup({ instance: new EchoProvider() })
    for (let i = 0; i < 3; i++) {
      await chat.send(`ciclo ${i}`)
      await chat.expectReply(new RegExp(`ciclo ${i}$`))
      await bot.stop()
      await bot.start()
    }
    await bot.stop()
  })

  it('a pending tool confirmation does not keep timers alive after stop()', async () => {
    const tools: AIToolSet = { borrar: { description: 'Borra', confirm: true, handler: () => 'ok' } }
    const mock = new MockAIProvider({
      reply: (i) => i.messages.at(-1)?.role === 'tool' ? 'hecho' : { toolCalls: [{ name: 'borrar', args: {} }] },
    })
    const t = await createTestBot({}, { provider: { buttons: false } })
    t.bot.plug(aiPlugin({ instance: mock, tools }))
    const timersBefore = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length
    await t.chat.send('borra todo')
    await t.chat.expectReply(/¿Confirmas\?/)
    await t.bot.stop()
    await tick()
    const timers = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length
    expect(timers).toBeLessThanOrEqual(timersBefore)
  })
})

describe('e2e: background memory extraction and stop()', () => {
  it('stop() aborts a background extraction still waiting for the model', async () => {
    let extractStarted = 0
    let extractAborted = 0
    const provider: AIProvider = {
      name: 'split',
      async generate(input) {
        if (input.system?.includes('long-term memory')) {
          extractStarted++
          return new Promise((_, reject) => {
            input.signal?.addEventListener('abort', () => { extractAborted++; reject(new Error('aborted')) }, { once: true })
          })
        }
        return { text: 'respuesta', model: 'm' }
      },
      async *stream() { yield '' },
    }
    const t = await createTestBot()
    t.bot.plug(aiPlugin({ instance: provider, memory: { autoExtract: true } }))
    const timersBefore = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length
    await t.chat.send('me llamo Ana')
    await t.chat.expectReply('respuesta')
    await tick()
    expect(extractStarted).toBe(1)
    await t.bot.stop()
    await tick()
    expect(extractAborted).toBe(1)
    expect(process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length).toBeLessThanOrEqual(timersBefore)
    // After a restart, extraction works again (a fresh signal).
    await t.bot.start()
    await t.chat.send('vivo en Bogotá')
    await t.chat.expectReply('respuesta')
    await tick()
    expect(extractStarted).toBe(2)
    await t.bot.stop()
  })
})

describe('e2e: confirmations cannot be answered by someone else', () => {
  const tools = (ran: string[]): AIToolSet => ({
    pagar: { description: 'Paga', title: 'Pagar', confirm: true, handler: (_a, { ctx }) => { ran.push(ctx?.sender ?? '?'); return 'pagado' } },
  })
  const model = () => new MockAIProvider({
    reply: (i) => {
      const last = i.messages.at(-1)
      if (last?.role === 'tool') return `tool: ${last.content}`
      return last?.content.includes('paga') ? { toolCalls: [{ name: 'pagar', args: {} }] } : `eco: ${last?.content}`
    },
  })

  it('in a group, another participant typing "sí" does not approve the pending confirmation', async () => {
    const ran: string[] = []
    const t = await createTestBot({}, { provider: { buttons: false } })
    t.bot.plug(aiPlugin({ instance: model(), tools: tools(ran) }))
    const ana = t.group('g@g.us', { as: 'ana@s.whatsapp.net' })
    const eve = ana.as('eve@s.whatsapp.net')
    await ana.send('paga la cuenta')
    await ana.expectReply(/¿Confirmas\?/)
    await eve.send('sí')
    await eve.expectReply('eco: sí')
    expect(ran).toEqual([])
    await ana.send('sí')
    await ana.expectReply('tool: pagado')
    expect(ran).toEqual(['ana@s.whatsapp.net'])
    await t.bot.stop()
  })

  it("in a group, another participant pressing the live Yes button does not approve it", async () => {
    const ran: string[] = []
    const t = await createTestBot()
    t.bot.plug(aiPlugin({ instance: model(), tools: tools(ran) }))
    const ana = t.group('g@g.us', { as: 'ana@s.whatsapp.net' })
    await ana.send('paga la cuenta')
    await ana.expectReply(/¿Confirmas\?/)
    const buttons = t.provider.outbox.filter((m) => m.content.kind === 'buttons').at(-1)!.content as { buttons: Array<{ id: string }> }
    t.provider.interaction(buttons.buttons[0]!.id, { from: 'g@g.us', sender: 'eve@s.whatsapp.net', isGroup: true })
    await tick(50)
    expect(ran).toEqual([])
    t.provider.interaction(buttons.buttons[0]!.id, { from: 'g@g.us', sender: 'ana@s.whatsapp.net', isGroup: true })
    await ana.expectReply('tool: pagado')
    expect(ran).toEqual(['ana@s.whatsapp.net'])
    await t.bot.stop()
  })
})
