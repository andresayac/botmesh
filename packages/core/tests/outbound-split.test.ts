import { describe, expect, it, vi } from 'vitest'
import { Buffer } from 'node:buffer'
import { Bot, type SentMessage } from '../src/index.js'
import { createTestBot, MockProvider } from '../src/testing/index.js'

const LONG = 'Primera frase del mensaje. Segunda frase que sigue. Tercera frase final aquí. Cuarta y última.'
const texts = (provider: MockProvider): string[] =>
  provider.outbox.map((o) => (o.content.kind === 'text' ? o.content.text : `<${o.content.kind}>`))

describe('outbound: long text is split to capabilities.maxTextLength', () => {
  it('ctx.reply sends the parts in order, each within the limit', async () => {
    const { bot, provider, chat } = await createTestBot({}, { provider: { maxTextLength: 30 } })
    let result: SentMessage | undefined
    bot.when('hola', async (ctx) => { result = await ctx.reply(LONG) })
    await chat.send('hola')
    await vi.waitFor(() => expect(result).toBeDefined())
    const sent = texts(provider)
    expect(sent.length).toBeGreaterThan(2)
    for (const t of sent) expect(t.length).toBeLessThanOrEqual(30)
    expect(sent.join(' ')).toBe(LONG)
    // The result is the last part; `parts` lists every part in order.
    expect(result!.parts?.map((p) => p.id)).toEqual(provider.journal.filter((e) => e.dir === 'out').map((e) => e.ref.id))
    expect(result!.ref.id).toBe(result!.parts!.at(-1)!.id)
    await bot.stop()
  })

  it('bot.send splits too; text that fits is sent untouched (no parts)', async () => {
    const { bot, provider } = await createTestBot({}, { provider: { maxTextLength: 30 } })
    const short = await bot.send('user-1', '  corto  ')
    expect(short.parts).toBeUndefined()
    expect(texts(provider)).toEqual(['  corto  '])
    await bot.send('user-1', LONG)
    expect(texts(provider).length).toBeGreaterThan(3)
    await bot.stop()
  })

  it('quotes only the first part and gives explicit idempotency keys a per-part suffix', async () => {
    const { bot, provider } = await createTestBot({}, { provider: { maxTextLength: 30 } })
    const quoted = { id: 'q1', chatId: 'user-1' }
    await bot.send('user-1', { kind: 'text', text: LONG }, { quoted, idempotencyKey: 'k1', mentions: ['user-2'] })
    const opts = provider.outbox.map((o) => o.options)
    expect(opts[0]?.quoted).toEqual(quoted)
    for (const o of opts.slice(1)) expect(o?.quoted).toBeUndefined()
    expect(opts.map((o) => o?.idempotencyKey)).toEqual(opts.map((_, i) => (i === 0 ? 'k1' : `k1#${i + 1}`)))
    for (const o of opts) expect(o?.mentions).toEqual(['user-2'])
    await bot.stop()
  })

  it('honours capabilities.maxTextBytes (UTF-8)', async () => {
    const { bot, provider } = await createTestBot({}, { provider: { maxTextBytes: 40 } })
    const text = 'ñandú pequeño 🎉 corre por el campo abierto 日本 y vuelve a casa.'
    await bot.send('user-1', text)
    const sent = texts(provider)
    expect(sent.length).toBeGreaterThan(1)
    for (const t of sent) expect(Buffer.byteLength(t, 'utf8')).toBeLessThanOrEqual(40)
    await bot.stop()
  })

  it('keeps the chat text format markup whole', async () => {
    const { bot, provider } = await createTestBot({}, { provider: { maxTextLength: 40, textFormat: 'whatsapp' } })
    await bot.send('user-1', 'Hola amigo, esto es *un texto en negrita largo* y sigue.')
    expect(texts(provider)[1]).toBe('*un texto en negrita largo* y sigue.')
    await bot.stop()
  })

  it('runs before(send) once on the whole text, then after(send) once per part', async () => {
    const { bot, provider } = await createTestBot({}, { provider: { maxTextLength: 30 } })
    const before: string[] = []
    const after: string[] = []
    bot.before('send', async (p: { content: { kind: string; text?: string } }, next: () => Promise<void>) => { if (p.content.kind === 'text') before.push(p.content.text ?? ''); await next() })
    bot.after('send', (p: { content: { kind: string; text?: string } }) => { if (p.content.kind === 'text') after.push(p.content.text ?? '') })
    await bot.send('user-1', LONG)
    expect(before).toEqual([LONG])
    expect(after).toEqual(texts(provider))
    await bot.stop()
  })

  it('splits what the before(send) hooks return: a footer is added once and every part fits', async () => {
    const { bot, provider } = await createTestBot({}, { provider: { maxTextLength: 30 } })
    const FOOTER = ' -- sent by ACME bot'
    bot.before('send', async (p: { content: { kind: string; text?: string } }, next: () => Promise<void>) => {
      if (p.content.kind === 'text') p.content = { kind: 'text', text: `${p.content.text ?? ''}${FOOTER}` }
      await next()
    })
    await bot.send('user-1', LONG)
    const sent = texts(provider)
    for (const t of sent) expect(t.length).toBeLessThanOrEqual(30)
    expect(sent.join(' ')).toBe(`${LONG}${FOOTER}`)
    // A text that fits, but that a hook makes too long, is split as well.
    provider.outbox.length = 0
    await bot.send('user-1', 'Una frase corta aquí.')
    for (const t of texts(provider)) expect(t.length).toBeLessThanOrEqual(30)
    expect(texts(provider).join(' ')).toBe(`Una frase corta aquí.${FOOTER}`)
    await bot.stop()
  })

  it('a before(send) hook that aborts skips the whole text (no parts)', async () => {
    const { bot, provider } = await createTestBot({}, { provider: { maxTextLength: 30 } })
    bot.before('send', async (p: { abort(): void }) => { p.abort() })
    const res = await bot.send('user-1', LONG)
    expect(res.skipped).toBe(true)
    expect(res.parts).toBeUndefined()
    expect(provider.outbox).toHaveLength(0)
    await bot.stop()
  })

  it('splitLongText: false sends the text as one message', async () => {
    const { bot, provider } = await createTestBot({ splitLongText: false }, { provider: { maxTextLength: 30 } })
    await bot.send('user-1', LONG)
    expect(texts(provider)).toEqual([LONG])
    await bot.stop()
  })

  it('validates splitLongText', () => {
    expect(() => new Bot({ provider: new MockProvider(), splitLongText: 'yes' as unknown as boolean })).toThrow(/splitLongText/)
  })

  it('sends one trimmed message when only surrounding whitespace was over the limit', async () => {
    const { bot, provider } = await createTestBot({}, { provider: { maxTextLength: 30 } })
    const res = await bot.send('user-1', `hola${' '.repeat(40)}`)
    expect(texts(provider)).toEqual(['hola'])
    expect(res.parts).toBeUndefined()
    await bot.stop()
  })

  it('a non-string text still fails with the TypeError naming the field', async () => {
    const { bot } = await createTestBot({}, { provider: { maxTextLength: 30 } })
    await expect(bot.send('user-1', { kind: 'text', text: undefined } as never)).rejects.toThrow(/"text" must be a string/)
    await bot.stop()
  })

  it('leaves non-text content alone', async () => {
    const { bot, provider } = await createTestBot({}, { provider: { maxTextLength: 10 } })
    await bot.send('user-1', { kind: 'location', lat: 1, lng: 2, name: 'un lugar con nombre largo' })
    expect(provider.outbox).toHaveLength(1)
    await bot.stop()
  })

  it('a failing part rejects and stops the remaining parts', async () => {
    const { bot, provider } = await createTestBot({}, { provider: { maxTextLength: 30 } })
    const send = provider.send.bind(provider)
    let calls = 0
    provider.send = async (...args) => {
      if (++calls === 2) throw new Error('boom')
      return send(...args)
    }
    await expect(bot.send('user-1', LONG)).rejects.toThrow('boom')
    expect(provider.outbox).toHaveLength(1)
    await bot.stop()
  })

  it('a durable split whose part is deferred still delivers every part, in order', async () => {
    const provider = new MockProvider({ maxTextLength: 30 })
    const bot = new Bot({ provider, durability: { outbox: { inlineMaxMs: 50, retries: 50, backoff: () => 10 }, pollMs: 20 } })
    await bot.start()
    const send = provider.send.bind(provider)
    let down = true
    provider.send = async (...args) => {
      if (down) throw new Error('transport down')
      return send(...args)
    }
    const error = await bot.send('user-1', LONG, { idempotencyKey: 'def-1' }).catch((e: unknown) => e)
    expect((error as Error | undefined)?.name).toBe('SendDeferredError')
    down = false
    await vi.waitFor(() => expect(texts(provider).join(' ')).toBe(LONG), { timeout: 3_000 })
    for (const t of texts(provider)) expect(t.length).toBeLessThanOrEqual(30)
    // The journaled parts carry the keys an inline send would use: sending again re-sends nothing.
    const before = provider.outbox.length
    await bot.send('user-1', LONG, { idempotencyKey: 'def-1' })
    expect(provider.outbox).toHaveLength(before)
    await bot.stop()
  })

  it('bot.enqueue splits too: every part is journaled and delivered in order', async () => {
    const provider = new MockProvider({ maxTextLength: 30 })
    const bot = new Bot({ provider, durability: { pollMs: 20 } })
    await bot.start()
    let hooks = 0
    bot.before('send', async (_p: unknown, next: () => Promise<void>) => { hooks++; await next() })
    expect(await bot.enqueue('user-1', LONG, { idempotencyKey: 'rem-1' })).toEqual({ key: 'rem-1', status: 'queued' })
    await vi.waitFor(() => expect(texts(provider).join(' ')).toBe(LONG), { timeout: 3_000 })
    for (const t of texts(provider)) expect(t.length).toBeLessThanOrEqual(30)
    expect(hooks).toBe(1)
    const keys = (await bot.durability!.outbox.list()).map((r) => r.key)
    expect(keys).toEqual(texts(provider).map((_, i) => (i === 0 ? 'rem-1' : `rem-1#${i + 1}`)))
    // The same key again is a no-op.
    expect((await bot.enqueue('user-1', LONG, { idempotencyKey: 'rem-1' })).status).toBe('exists')
    await bot.stop()
  })

  it('a durable send gives every part its own outbox record', async () => {
    const provider = new MockProvider({ maxTextLength: 30 })
    const bot = new Bot({ provider, durability: {} })
    await bot.start()
    await bot.send('user-1', LONG, { idempotencyKey: 'dur-1' })
    const first = texts(provider)
    expect(first.length).toBeGreaterThan(2)
    // Same key again: every part is answered from the outbox, nothing is re-sent.
    await bot.send('user-1', LONG, { idempotencyKey: 'dur-1' })
    expect(texts(provider)).toEqual(first)
    await bot.stop()
  })
})
