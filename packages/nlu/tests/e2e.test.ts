/**
 * End-to-end and hostile-input coverage of `@botmesh/nlu` through the public API: a real Bot
 * on the MockProvider (many chats, bursts, groups, non-text messages, stop/start, unplug) and
 * a seeded fuzz of `define()` / `match()`.
 */
import { describe, expect, it } from 'vitest'
import { createTestBot } from '@botmesh/core/testing'
import { createSeededRandom } from '@botmesh/core/testing'
import { IntentEngine, nluPlugin, whenIntent } from '../src/index.js'

function wire(bot: Parameters<typeof whenIntent>[0] & { onMessage: (h: (ctx: { reply: (t: string) => unknown }) => unknown) => unknown }, nlu: IntentEngine) {
  whenIntent(bot, nlu, 'greeting', (ctx) => ctx.reply('greeting'))
  whenIntent(bot, nlu, 'order.status', (ctx, m) => ctx.reply(`order:${m.entities?.id ?? '-'}`))
  bot.onMessage((ctx) => ctx.reply('fallback'))
}

describe('nlu end to end', () => {
  it('routes a burst over many chats, each in order, with the right intent', async () => {
    const { bot, dm } = await createTestBot()
    bot.plug(nluPlugin, { intents: { greeting: ['hola', 'buenas'], 'order.status': ['mi pedido {id}'] } })
    wire(bot, bot.injectTools.nlu!)
    const chats = Array.from({ length: 40 }, (_, i) => dm(`u${i}@s.whatsapp.net`))
    await Promise.all(
      chats.map(async (c, i) => {
        await c.send('¡HOLA!')
        await c.send(`mi pedido ${i}`)
        await c.send('nada que ver 🤷')
      }),
    )
    for (const [i, c] of chats.entries()) {
      await c.expectReply('fallback')
      expect(c.replies()).toEqual(['greeting', `order:${i}`, 'fallback'])
    }
    await bot.stop()
  })

  it('works per participant in groups and ignores messages without text', async () => {
    const { bot, group, chat } = await createTestBot()
    bot.plug(nluPlugin, { intents: { greeting: ['hola'], 'order.status': ['mi pedido {id}'] } })
    wire(bot, bot.injectTools.nlu!)
    const g = group('g1@g.us')
    await g.send('hola')
    await g.expectReply('greeting')
    await g.as('other@s.whatsapp.net').send('mi pedido A1')
    await g.expectReply('order:a1')
    await chat.sendLocation(4.6, -74.08)
    await chat.expectReply('fallback')
    await bot.stop()
  })

  it('keeps routing after stop() and start(), and unplugging removes the engine', async () => {
    const { bot, chat } = await createTestBot()
    const unplug = bot.plug(nluPlugin, { intents: { greeting: ['hola'], 'order.status': ['mi pedido {id}'] } })
    wire(bot, bot.injectTools.nlu!)
    await chat.send('hola')
    await chat.expectReply('greeting')
    await bot.stop()
    await bot.start()
    await chat.send('mi pedido 9')
    await chat.expectReply('order:9')
    unplug()
    expect(bot.injectTools.nlu).toBeUndefined()
    await bot.stop()
  })
})

describe('nlu seeded fuzz', () => {
  const pieces = ['hola', 'pedido', 'mi', '{id}', '{x}', ' ', '¡', '!', 'Ñ', 'é', '́', '👍', '​', 'नमस्ते', 'مَرْ', 'ＡＢ', '{', '}', '{a', 'b}', '$', '(', '[', '\\', '.*', '\n', '1x']
  const pick = (rnd: () => number, n: number) =>
    Array.from({ length: n }, () => pieces[Math.floor(rnd() * pieces.length)]).join('')

  it('define() either compiles or throws a clear Error; match() never throws and stays in [0, 1]', () => {
    const rnd = createSeededRandom(20261026)
    const nlu = new IntentEngine({ threshold: 0 })
    let defined = 0
    for (let i = 0; i < 400; i++) {
      const utterance = pick(rnd, 1 + Math.floor(rnd() * 6))
      try {
        nlu.define(`i${i % 25}`, [utterance])
        defined++
      } catch (err) {
        expect(err).toBeInstanceOf(Error)
        expect((err as Error).message).toMatch(/^IntentEngine\.define/)
      }
    }
    expect(defined).toBeGreaterThan(100)
    const started = performance.now()
    for (let i = 0; i < 2000; i++) {
      const text = pick(rnd, Math.floor(rnd() * 12))
      for (const m of nlu.rank(text)) {
        expect(m.confidence).toBeGreaterThan(0)
        expect(m.confidence).toBeLessThanOrEqual(1)
        if (m.entities) for (const v of Object.values(m.entities)) expect(v).toMatch(/^\S+$/u)
      }
    }
    // Long hostile tokens against every compiled pattern stay fast.
    for (const body of ['1x'.repeat(20_000), 'a'.repeat(50_000), `${'mi '.repeat(10_000)}pedido`]) nlu.rank(body)
    expect(performance.now() - started).toBeLessThan(5_000)
  })
})
