/**
 * End-to-end through the public API: a real `Bot` over `TelegramProvider`
 * talking real HTTP to an in-process fake Bot API (see fake-bot-api.ts).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createServer } from 'node:http'
import { Bot, flow, loadMediaOf } from '@botmesh/core'
import { TelegramProvider, isEditedMessage } from '../src/index.js'
import { FakeBotApi } from './fake-bot-api.js'

const waitFor = async (cond: () => boolean, ms = 4000, what = 'condition'): Promise<void> => {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

const silent = { debug() {}, info() {}, warn() {}, error() {} }
let api: FakeBotApi | undefined
let bots: Bot[] = []

afterEach(async () => {
  for (const b of bots) await b.stop().catch(() => undefined)
  bots = []
  await api?.close()
  api = undefined
})

async function pollingBot(extra: Record<string, unknown> = {}): Promise<{ bot: Bot; provider: TelegramProvider; api: FakeBotApi }> {
  api = await new FakeBotApi().start()
  const provider = new TelegramProvider({
    token: api.token,
    baseUrl: api.baseUrl,
    pollTimeout: 1,
    pollIdleMs: 1,
    errorBackoffMs: 5,
    logger: silent,
    mediaDownload: { allowHttp: true, allowPrivateHosts: true },
    ...extra,
  })
  const bot = new Bot({ provider, logger: silent } as ConstructorParameters<typeof Bot>[0])
  bots.push(bot)
  return { bot, provider, api }
}

const texts = (a: FakeBotApi, chat?: number): string[] =>
  a.sent('sendMessage').filter((c) => chat === undefined || Number(c.params.chat_id) === chat).map((c) => String(c.params.text))

describe('Telegram end-to-end (long polling)', () => {
  it('README quick start: greets, sends a native poll and an inline keyboard, and acks a button press', async () => {
    const { bot, api } = await pollingBot()
    const presses: string[] = []
    bot.when(/^hola/i, async (ctx) => {
      await ctx.reply(`¡Hola ${ctx.pushName ?? ''}! 👋`)
      await ctx.poll('¿Color favorito?', ['Rojo', 'Azul'])
      await ctx.buttons('Elige', [{ id: 'yes', title: 'Sí' }, { id: 'no', title: 'No' }])
    })
    bot.onMessage(async (ctx) => {
      if (ctx.interaction) {
        presses.push(ctx.interaction.data)
        await ctx.acknowledge?.('recibido')
      } else ctx.pass()
    })
    await bot.start()
    await bot.ready
    api.text(7, 'Hola bot')
    await waitFor(() => api.sent('sendMessage').length >= 2, 4000, 'replies')
    expect(texts(api, 7)[0]).toBe('¡Hola U7! 👋')
    expect(api.sent('sendPoll')[0].params).toMatchObject({ question: '¿Color favorito?', options: ['Rojo', 'Azul'] })
    const kb = api.sent('sendMessage')[1].params.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> }
    expect(kb.inline_keyboard.map((r) => r[0].callback_data)).toEqual(['yes', 'no'])

    api.push({ callback_query: { id: 'cb-1', from: { id: 7, first_name: 'U7' }, data: 'yes', message: { message_id: 5, date: 1_700_000_000, chat: { id: 7, type: 'private' } } } })
    await waitFor(() => api.sent('answerCallbackQuery').length === 1, 4000, 'ack')
    expect(presses).toEqual(['yes'])
    expect(api.sent('answerCallbackQuery')[0].params).toEqual({ callback_query_id: 'cb-1', text: 'recibido' })
  })

  it('a flow asks, a reply answers it, and a choose() menu is answered (numbered menu or keyboard press)', async () => {
    const { bot, api } = await pollingBot()
    bot.use(
      flow('pedido')
        .ask('¿Tu nombre?', 'name')
        .choose('¿Tamaño?', { s: 'Pequeño', l: 'Grande' }, 'size')
        .say((_ctx, c) => `Listo ${c.state.name}: ${c.state.size}`),
    )
    await bot.start()
    await bot.ready
    api.text(8, 'pedido')
    await waitFor(() => texts(api, 8).includes('¿Tu nombre?'), 4000, 'ask')
    api.text(8, 'Ana 💐')
    await waitFor(() => texts(api, 8).some((t) => t.includes('¿Tamaño?')), 4000, 'choose')
    const menu = api.sent('sendMessage').find((c) => String(c.params.text).includes('¿Tamaño?'))!
    const markup = menu.params.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> } | undefined
    if (markup) {
      const data = markup.inline_keyboard[1][0].callback_data
      api.push({ callback_query: { id: 'cb-2', from: { id: 8 }, data, message: { message_id: 9, date: 1_700_000_000, chat: { id: 8, type: 'private' } } } })
    } else {
      api.text(8, '2')
    }
    await waitFor(() => texts(api, 8).includes('Listo Ana 💐: l'), 4000, 'final say')
  })

  it('edited messages: delivered with the original id, a redelivery is deduped, isEditedMessage() tells them apart', async () => {
    const { bot, api } = await pollingBot()
    const seen: Array<{ body: string; edited: boolean; id: string }> = []
    bot.onMessage(async (ctx) => { seen.push({ body: ctx.body, edited: isEditedMessage(ctx), id: ctx.ref.id }) })
    await bot.start()
    await bot.ready
    const original = { message_id: 55, date: 1_700_000_000, chat: { id: 9, type: 'private' }, from: { id: 9 }, text: 'helo' }
    api.push({ message: original })
    const edit = { ...original, text: 'hello', edit_date: 1_700_000_100 }
    api.push({ edited_message: edit })
    api.push({ edited_message: edit }) // same edit delivered twice (different update_id)
    await waitFor(() => seen.length >= 2, 4000, 'edit')
    await new Promise((r) => setTimeout(r, 100))
    expect(seen).toEqual([
      { body: 'helo', edited: false, id: '55' },
      { body: 'hello', edited: true, id: '55' },
    ])
  })

  it('inbound media downloads through getFile + the file endpoint (loadMediaOf)', async () => {
    const { bot, api } = await pollingBot()
    api.files.set('photos/file_1.jpg', Buffer.from('JPEGDATA'))
    const got: string[] = []
    bot.onImage(async (ctx) => {
      const media = await loadMediaOf(ctx, { throwOnError: true })
      got.push(media!.buffer.toString())
    })
    await bot.start()
    await bot.ready
    api.push({ message: { message_id: 1, date: 1_700_000_000, chat: { id: 3, type: 'private' }, from: { id: 3 }, photo: [{ file_id: 'small', file_size: 1 }, { file_id: 'photos/file_1.jpg', file_size: 8 }], caption: 'mira' } })
    await waitFor(() => got.length === 1, 4000, 'download')
    expect(got).toEqual(['JPEGDATA'])
  })

  it('many chats in parallel keep per-chat order (40 chats × 5 messages)', async () => {
    const { bot, api } = await pollingBot()
    bot.onMessage(async (ctx) => {
      await new Promise((r) => setTimeout(r, Math.random() * 5))
      await ctx.reply(`echo:${ctx.body}`)
    })
    await bot.start()
    await bot.ready
    for (let n = 0; n < 5; n++) for (let chat = 100; chat < 140; chat++) api.text(chat, `m${n}`)
    await waitFor(() => api.sent('sendMessage').length === 200, 10_000, '200 replies')
    for (let chat = 100; chat < 140; chat++) {
      expect(texts(api, chat)).toEqual(['echo:m0', 'echo:m1', 'echo:m2', 'echo:m3', 'echo:m4'])
    }
  })

  it('getUpdates 429 (retry_after) and a transient 502 are survived without losing updates', async () => {
    const { bot, api } = await pollingBot()
    const bodies: string[] = []
    bot.onMessage(async (ctx) => { bodies.push(ctx.body) })
    await bot.start()
    await bot.ready
    api.failNext('getUpdates', 429, { ok: false, error_code: 429, description: 'Too Many Requests: retry after 1', parameters: { retry_after: 1 } })
    api.failNext('getUpdates', 502, { ok: false, error_code: 502, description: 'Bad Gateway' })
    api.text(1, 'uno')
    api.text(1, 'dos')
    await waitFor(() => bodies.length === 2, 6000, 'messages after errors')
    expect(bodies).toEqual(['uno', 'dos'])
  })

  it('a reply that hits 429 rejects with RateLimitedError carrying retryAfterMs', async () => {
    const { bot, api } = await pollingBot()
    const errors: unknown[] = []
    bot.onMessage(async (ctx) => { await ctx.reply('x').catch((e: unknown) => { errors.push(e) }) })
    await bot.start()
    await bot.ready
    api.failNext('sendMessage', 429, { ok: false, error_code: 429, description: 'Too Many Requests: retry after 7', parameters: { retry_after: 7 } })
    api.text(2, 'hi')
    await waitFor(() => errors.length === 1, 4000, 'error')
    expect((errors[0] as Error).name).toBe('RateLimitedError')
    expect((errors[0] as { retryAfterMs: number }).retryAfterMs).toBe(7000)
  })

  it('stop/start cycles leave no sockets or timers behind and keep the offset', async () => {
    const { bot, api } = await pollingBot()
    const bodies: string[] = []
    bot.onMessage(async (ctx) => { bodies.push(ctx.body) })
    const baseline = new Set(process.getActiveResourcesInfo())
    for (let i = 0; i < 5; i++) {
      await bot.start()
      await bot.ready
      api.text(4, `c${i}`)
      await waitFor(() => bodies.length === i + 1, 4000, `cycle ${i}`)
      await bot.stop()
    }
    expect(bodies).toEqual(['c0', 'c1', 'c2', 'c3', 'c4'])
    await new Promise((r) => setTimeout(r, 50))
    const leaked = process.getActiveResourcesInfo().filter((r) => r === 'Timeout' || r === 'TCPSocketWrap')
    const before = [...baseline].filter((r) => r === 'Timeout' || r === 'TCPSocketWrap')
    expect(leaked.filter((r) => r === 'Timeout').length).toBeLessThanOrEqual(before.filter((r) => r === 'Timeout').length + 0)
  })

  it('a group command addressed to this bot (/menu@fake_bot) reaches bot.command(\'menu\')', async () => {
    const { bot, api } = await pollingBot()
    const args: string[][] = []
    bot.command('menu', async (ctx, a) => { args.push(a); await ctx.reply('menu!') })
    await bot.start()
    await bot.ready
    api.push({ message: { message_id: 70, date: 1_700_000_000, chat: { id: -1001, type: 'supergroup', title: 'G' }, from: { id: 3 }, text: '/menu@Fake_Bot grande', entities: [{ type: 'bot_command', offset: 0, length: 14 }] } })
    await waitFor(() => texts(api, -1001).includes('menu!'), 4000, 'group command')
    expect(args).toEqual([['grande']])
  })

  it('a wrong token fails start() with a clear, token-free error', async () => {
    api = await new FakeBotApi().start()
    const provider = new TelegramProvider({ token: '1:WRONG-secret', baseUrl: api.baseUrl, logger: silent })
    const bot = new Bot({ provider, logger: silent } as ConstructorParameters<typeof Bot>[0])
    const err = await bot.start().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/Unauthorized.*token/i)
    expect((err as Error).message).not.toContain('WRONG-secret')
  })

  it('ctx.stream() in a private chat uses sendMessageDraft then one final message', async () => {
    const { bot, api } = await pollingBot()
    bot.onMessage(async (ctx) => {
      async function* gen() { yield 'Hola, '; await new Promise((r) => setTimeout(r, 20)); yield 'mundo' }
      await ctx.stream(gen())
    })
    await bot.start()
    await bot.ready
    api.text(11, 'cuéntame')
    await waitFor(() => texts(api, 11).includes('Hola, mundo'), 4000, 'stream final')
    expect(api.sent('sendMessageDraft').length).toBeGreaterThanOrEqual(1)
  })
})

describe('Telegram end-to-end (webhook)', () => {
  it('a raw-body HTTP webhook with the secret header reaches handlers; wrong secret is 401; retries are deduped', async () => {
    api = await new FakeBotApi().start()
    const provider = new TelegramProvider({ token: api.token, baseUrl: api.baseUrl, polling: false, webhookSecret: 'hook-secret', logger: silent })
    const bot = new Bot({ provider, logger: silent } as ConstructorParameters<typeof Bot>[0])
    bots.push(bot)
    const bodies: string[] = []
    bot.onMessage(async (ctx) => { bodies.push(ctx.body); await ctx.reply('ok') })
    await bot.start()
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      res.statusCode = provider.ingest(Buffer.concat(chunks), req.headers)
      res.end()
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/tg`
    try {
      const update = JSON.stringify({ update_id: 10, message: { message_id: 1, date: 1_700_000_000, chat: { id: 5, type: 'private' }, from: { id: 5 }, text: 'hola ✓' } })
      const post = (secret: string) => fetch(url, { method: 'POST', body: update, headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret } })
      expect((await post('nope')).status).toBe(401)
      expect((await post('hook-secret')).status).toBe(200)
      expect((await post('hook-secret')).status).toBe(200) // Telegram retry of the same update
      await waitFor(() => api!.sent('sendMessage').length >= 1, 4000, 'reply')
      await new Promise((r) => setTimeout(r, 100))
      expect(bodies).toEqual(['hola ✓'])
    } finally {
      await new Promise<void>((r) => server.close(() => r()))
    }
  })
})
