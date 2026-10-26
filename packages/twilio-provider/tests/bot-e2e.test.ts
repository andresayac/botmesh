/**
 * End to end through the public API: Bot + TwilioProvider, signed webhooks in,
 * REST calls out (fake fetch). Many chats at once, bursts in one chat,
 * unicode, and a stop()/start() cycle.
 */
import { describe, expect, it } from 'vitest'
import pino from 'pino'
import { Bot, flow } from '@botmesh/core'
import { TwilioProvider } from '../src/TwilioProvider.js'
import { computeTwilioSignature, parseFormParams } from '../src/signature.js'
import { fakeHttp } from './support.js'

const HOOK = 'https://bot.example.com/twilio/webhook'

function setup() {
  let n = 0
  const { calls, http } = fakeHttp(() => ({ status: 201, json: { sid: `SM${String(++n).padStart(32, '0')}` } }))
  const provider = new TwilioProvider({ accountSid: 'AC1', authToken: 'tok', whatsappFrom: 'whatsapp:+14155238886', webhookUrl: HOOK, http, logger: pino({ level: 'silent' }) })
  const bot = new Bot({ provider })
  bot.use(flow('order').ask('¿Cuántas? 🍞', 'qty').say((_ctx, c) => `Listo: ${String(c.state.qty)} 🥖`))
  let sid = 0
  const post = (from: string, body: string): number => {
    const form = new URLSearchParams({ MessageSid: `SM${(++sid).toString(16).padStart(32, '0')}`, From: from, To: 'whatsapp:+14155238886', Body: body, NumMedia: '0' }).toString()
    return provider.ingest(form, { 'x-twilio-signature': computeTwilioSignature('tok', HOOK, parseFormParams(form)) })
  }
  const sentTo = (to: string): string[] => calls.map((c) => new URLSearchParams(c.body)).filter((p) => p.get('To') === to).map((p) => p.get('Body') ?? '')
  return { provider, bot, post, sentTo, calls }
}

const until = async (fn: () => boolean, ms = 5000): Promise<void> => {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('TwilioProvider + Bot end to end', () => {
  it('runs 60 concurrent conversations without mixing answers', async () => {
    const t = setup()
    await t.bot.start()
    const chats = Array.from({ length: 60 }, (_, i) => `whatsapp:+5730000${String(i).padStart(4, '0')}`)
    for (const c of chats) expect(t.post(c, 'order')).toBe(200)
    await until(() => chats.every((c) => t.sentTo(c).length === 1))
    chats.forEach((c, i) => t.post(c, `${i} 👍🏽`))
    await until(() => chats.every((c) => t.sentTo(c).length === 2))
    chats.forEach((c, i) => expect(t.sentTo(c)).toEqual(['¿Cuántas? 🍞', `Listo: ${i} 👍🏽 🥖`]))
    await t.bot.stop()
  })

  it('a burst in one chat is consumed in order: the answer is the first message after the question', async () => {
    const t = setup()
    await t.bot.start()
    const chat = 'whatsapp:+573001112233'
    t.post(chat, 'order')
    await until(() => t.sentTo(chat).length === 1)
    for (const body of ['1', '2', '3']) t.post(chat, body)
    await until(() => t.sentTo(chat).length >= 2)
    await new Promise((r) => setTimeout(r, 50))
    expect(t.sentTo(chat)[1]).toBe('Listo: 1 🥖')
    await t.bot.stop()
  })

  it('a retried webhook (same MessageSid) is dispatched once', async () => {
    const t = setup()
    const seen: string[] = []
    t.bot.when('ping', (ctx) => { seen.push(ctx.body) })
    await t.bot.start()
    const form = new URLSearchParams({ MessageSid: `SM${'c'.repeat(32)}`, From: 'whatsapp:+1', To: 'whatsapp:+2', Body: 'ping' }).toString()
    const headers = { 'x-twilio-signature': computeTwilioSignature('tok', HOOK, parseFormParams(form)) }
    t.provider.ingest(form, headers)
    t.provider.ingest(form, headers)
    await new Promise((r) => setTimeout(r, 50))
    expect(seen).toEqual(['ping'])
    await t.bot.stop()
  })

  it('keeps working across stop()/start() and leaves no timers behind', async () => {
    const t = setup()
    const timers = (): number => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length
    const baseline = timers()
    t.bot.when('hola', (ctx) => ctx.reply('¡hola! 😀'))
    for (let round = 0; round < 3; round++) {
      await t.bot.start()
      t.post(`whatsapp:+57${round}`, 'hola')
      await until(() => t.sentTo(`whatsapp:+57${round}`).length === 1)
      await t.bot.stop()
    }
    expect(timers()).toBeLessThanOrEqual(baseline)
  })
})
