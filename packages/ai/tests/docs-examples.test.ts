/**
 * The examples of the README and of the AI guides (docs/guide/ai*.md and their Spanish
 * mirrors), run as written against MockAIProvider: if a documented snippet stops
 * working (or stops type-checking: `pnpm typecheck` covers this file), this fails.
 */
import { describe, it, expect } from 'vitest'
import { MemoryStore } from '@botmesh/core'
import { createTestBot } from '@botmesh/core/testing'
import {
  AIClient, ContextManager, MemoryManager, MockAIProvider, aiPlugin, chatKeyOf, confirmWith, defineTool,
  runToolLoop, type AIMessage, type AIToolEvent, type AIToolSet, type ConvStore, type GenerateInput,
} from '../src/index.js'

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms))

describe('README / guide: Testing', () => {
  it('AIClient over a hand-written ConvStore answers with the mock', async () => {
    const memory = new Map<string, AIMessage[]>()
    const store: ConvStore = {
      async getConversation(k) { return memory.get(k) },
      async setConversation(k, m) { memory.set(k, m) },
      async clearConversation(k) { memory.delete(k) },
    }
    const client = new AIClient(new MockAIProvider({ reply: 'hello from the mock' }), new ContextManager(store))
    const answer = await client.ask('what time is it?')
    expect(answer).toBe('hello from the mock')
  })

  it('ai-tools guide: scripted tool call through AIClient + MemoryStore', async () => {
    const mock = new MockAIProvider({
      reply: (input) => input.messages.at(-1)?.role === 'tool'
        ? 'We have rye bread.'
        : { toolCalls: [{ name: 'search_product', args: { q: 'rye' } }] },
    })
    const searched: string[] = []
    const client = new AIClient(mock, new ContextManager(new MemoryStore()), {
      tools: {
        search_product: {
          description: 'Search the catalog',
          schema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
          handler: ({ q }: { q: string }) => { searched.push(q); return ['rye bread'] },
        },
      },
    })
    expect(await client.ask('do you have rye?')).toBe('We have rye bread.')
    expect(searched).toEqual(['rye'])
    expect(mock.calls[0]!.tools?.map((t) => t.name)).toEqual(['search_product'])
  })

  it('ai-memory-rag guide: memory + RAG with appendSources', async () => {
    const { bot } = await createTestBot({ lang: 'es' })
    const mock = new MockAIProvider({ reply: 'It takes 3 days [1].' })
    const ai = new AIClient(mock, new ContextManager(bot.getStore()), {
      memory: new MemoryManager((id) => bot.user(id)),
      rag: { retriever: { retrieve: async () => [{ text: 'Shipping takes 3 days.', citation: 'faq' }] }, appendSources: true },
    })
    await ai.remember('user-1', 'Prefers Spanish')
    const r = await ai.replyInChatDetailed('chat-1', 'shipping?', { userId: 'user-1' })
    expect(r.text).toBe('It takes 3 days [1].\n\nSources: [1] faq')
    expect(r.facts).toEqual(['Prefers Spanish'])
    expect(mock.calls[0]?.system).toContain('Prefers Spanish')
    expect(mock.calls[0]?.system).toContain('[1] (faq)\nShipping takes 3 days.')
    await bot.stop()
  })
})

describe('README / guide: plugin usage', () => {
  it('ctx.tools.ai.ask inside a conversation (complaint example)', async () => {
    const { bot, chat } = await createTestBot({ lang: 'es' })
    bot.plug(aiPlugin({ instance: new MockAIProvider({ reply: 'Line 1\nLine 2\nLine 3' }), autoReply: false }))
    bot.conversation('complaint', async (c, ctx) => {
      await ctx.reply('📝 Tell us what went wrong with your order:')
      const text = await c.waitText()
      const summary = await ctx.tools.ai.ask(`Summarize this customer complaint in 3 lines for the support team: ${text}`)
      await ctx.reply(`✅ We logged your complaint:\n${summary}`)
    })
    await chat.send('complaint')
    await chat.expectReply('📝 Tell us what went wrong with your order:')
    await chat.send('the bread was cold')
    await chat.expectReply('✅ We logged your complaint:\nLine 1\nLine 2\nLine 3')
    await bot.stop()
  })

  it('confirmWith(c) inside your own conversation (typed yes)', async () => {
    const { bot, chat } = await createTestBot({ lang: 'es' }, { provider: { buttons: false } })
    const ran: string[] = []
    bot.plug(aiPlugin({
      autoReply: false,
      instance: new MockAIProvider({
        reply: (input: GenerateInput) => input.messages.at(-1)?.role === 'tool' ? 'Booked.' : { toolCalls: [{ name: 'book', args: { day: 'monday' } }] },
      }),
      tools: { book: { description: 'Book a table', confirm: true, schema: { type: 'object', properties: { day: { type: 'string' } } }, handler: ({ day }: { day: string }) => { ran.push(day); return 'ok' } } },
    }))
    bot.conversation('support', async (c, ctx) => {
      const text = await c.ask('How can I help you?')
      const answer = await ctx.tools.ai.replyInChat(chatKeyOf(ctx), text, { ctx, confirm: confirmWith(c, { timeout: '1m' }) })
      await ctx.reply(answer)
    })
    await chat.send('support')
    await chat.expectReply('How can I help you?')
    await chat.send('book monday')
    await chat.expectReply(/Voy a: Book\n• Day: monday\n¿Confirmas\? \(sí\/no\)/)
    await chat.send('sí')
    await chat.expectReply('Booked.')
    expect(ran).toEqual(['monday'])
    await bot.stop()
  })

  it('streamReplyInChat feeds ctx.stream() in your own handler', async () => {
    const t = await createTestBot({ lang: 'es' }, { provider: { streaming: 'edit' } })
    t.bot.plug(aiPlugin({ instance: new MockAIProvider({ reply: 'streamed answer' }), autoReply: false }))
    t.bot.when('stream', async (ctx) => {
      await ctx.stream(ctx.tools.ai.streamReplyInChat(chatKeyOf(ctx), ctx.body, { userId: ctx.sender, isGroup: ctx.isGroup }))
    })
    await t.chat.send('stream')
    await tick(200)
    const shown = [...t.chat.replies(), ...t.provider.edits.map((e) => (e.content as { text?: string }).text ?? '')]
    expect(shown.some((s) => s.includes('streamed answer'))).toBe(true)
    await t.bot.stop()
  })

  it('runTools() and runToolLoop() return the documented fields', async () => {
    const mock = new MockAIProvider({
      reply: (i) => i.messages.at(-1)?.role === 'tool' ? 'There is.' : { toolCalls: [{ name: 'stock', args: {} }] },
    })
    const tools: AIToolSet = { stock: { description: 'Stock', handler: () => 3 } }
    const { bot, chat } = await createTestBot({ lang: 'es' })
    bot.plug(aiPlugin({ instance: mock, tools, autoReply: false }))
    bot.when('stock?', async (ctx) => {
      const r = await ctx.tools.ai.runTools({ messages: [{ role: 'user', content: ctx.body }] }, { ctx })
      await ctx.reply(`${r.text}|${r.steps}|${r.toolResults.length}|${r.maxStepsReached}|${r.truncatedToolCalls}`)
    })
    await chat.send('stock?')
    await chat.expectReply('There is.|2|1|false|0')
    const events: string[] = []
    const r = await runToolLoop({
      tools,
      generate: (input) => mock.generate(input),
      base: { system: 'You are a stock assistant.' },
      messages: [{ role: 'user', content: 'Is there rye bread left?' }],
      maxSteps: 3,
      onEvent: (e) => events.push(e.type),
    })
    expect(r.text).toBe('There is.')
    expect(events).toEqual(['tool.call', 'tool.result'])
    await bot.stop()
  })

  it("bot.on('ai.tool') audit events and the memory API (remember / forget / deleteSubject)", async () => {
    const { bot, chat } = await createTestBot({ lang: 'es' })
    const seen: AIToolEvent[] = []
    bot.on('ai.tool', (e: AIToolEvent) => { seen.push(e) })
    bot.plug(aiPlugin({
      instance: new MockAIProvider({ reply: (i) => i.messages.at(-1)?.role === 'tool' ? 'ok' : { toolCalls: [{ name: 'ping', args: {} }] } }),
      tools: { ping: { description: 'Ping', handler: () => 'pong' } },
      memory: { maxFacts: 50, ttl: '90d' },
    }))
    await chat.send('ping')
    await chat.expectReply('ok')
    expect(seen.map((e) => e.type)).toEqual(['tool.call', 'tool.result'])
    expect(seen[0]!.chatKey).toBe(chat.chatId)

    const userId = chat.senderId
    expect(await bot.injectTools.ai.remember(userId, 'VIP customer')).toEqual(['VIP customer'])
    await bot.injectTools.ai.remember(userId, ['Vegan', 'Allergic to nuts'], { ttl: '30d' })
    expect(await bot.injectTools.ai.forget(userId, 'VIP customer')).toBe(true)
    expect(await bot.injectTools.ai.memory(userId)).toEqual(['Vegan', 'Allergic to nuts'])
    await bot.deleteSubject(userId)
    expect(await bot.injectTools.ai.memory(userId)).toEqual([])
    await bot.stop()
  })
})

describe('ai-tools guide: best practices (bakery)', () => {
  const MENU = {
    pan_de_bono: { name: 'Pan de bono', price: 2500 },
    croissant: { name: 'Croissant', price: 5000 },
    cafe: { name: 'Café', price: 4000 },
  } as const
  type Product = keyof typeof MENU
  type Item = { producto: Product; cantidad: number }
  const ITEMS = {
    type: 'array',
    minItems: 1,
    items: {
      type: 'object',
      properties: { producto: { type: 'string', enum: Object.keys(MENU) }, cantidad: { type: 'integer', minimum: 1, maximum: 50 } },
      required: ['producto', 'cantidad'],
      additionalProperties: false,
    },
  }
  const money = (n: number) => '$' + n.toLocaleString('es-CO')
  const quote = (items: Item[]) => {
    const lines = items.map((i) => ({ ...i, nombre: MENU[i.producto].name, subtotal: MENU[i.producto].price * i.cantidad }))
    return { items: lines, total: lines.reduce((sum, l) => sum + l.subtotal, 0) }
  }
  const quoteLines = (items: Item[]) => {
    const q = quote(items)
    return [...q.items.map((l) => `• ${l.cantidad} × ${l.nombre}: ${money(l.subtotal)}`), `Total: ${money(q.total)}`]
  }

  it('confirmLines shows the code-computed total; an invented product never reaches the user', async () => {
    let script: Array<{ name: string; args: unknown }> = []
    const mock = new MockAIProvider({
      reply: (input) => {
        const last = input.messages.at(-1)
        if (last?.role === 'tool') return `tool: ${last.content}`
        const call = script.shift()
        return call ? { toolCalls: [call] } : 'nada'
      },
    })
    const orders: unknown[] = []
    const { bot, chat } = await createTestBot({ lang: 'es' }, { provider: { buttons: false } })
    bot.plug(aiPlugin({
      instance: mock,
      tools: {
        crear_pedido: defineTool<{ items: Item[] }>({
          title: 'Crear pedido',
          description: 'Place a new order. items: menu keys and quantities.',
          schema: { type: 'object', properties: { items: ITEMS }, required: ['items'] },
          confirm: true,
          dedupe: 'args',
          confirmLines: ({ items }) => quoteLines(items),
          handler: ({ items }) => { const o = { id: 'P-1', ...quote(items) }; orders.push(o); return o },
        }),
      },
    }))
    // An invented product: rejected before asking the user.
    script = [{ name: 'crear_pedido', args: { items: [{ producto: 'torta', cantidad: 1 }] } }]
    await chat.send('quiero una torta')
    await chat.expectReply(/^tool: Error: invalid arguments/)
    expect(chat.replies().some((r) => r.includes('¿Confirmas?'))).toBe(false)
    // A valid order: the confirmation shows the total computed in code.
    script = [{ name: 'crear_pedido', args: { items: [{ producto: 'pan_de_bono', cantidad: 2 }, { producto: 'cafe', cantidad: 1 }] } }]
    await chat.send('2 pan de bono y un café')
    await chat.expectReply('Voy a: Crear pedido\n• 2 × Pan de bono: $5.000\n• 1 × Café: $4.000\nTotal: $9.000\n¿Confirmas? (sí/no)')
    await chat.send('sí')
    await chat.expectReply(/^tool: \{"id":"P-1"/)
    expect(orders).toHaveLength(1)
    // The same order again within the dedupe window is neither asked nor run.
    script = [{ name: 'crear_pedido', args: { items: [{ producto: 'pan_de_bono', cantidad: 2 }, { producto: 'cafe', cantidad: 1 }] } }]
    await chat.send('otra vez lo mismo')
    await chat.expectReply(/"reason":"duplicate"/)
    expect(orders).toHaveLength(1)
    await bot.stop()
  })
})
