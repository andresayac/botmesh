/**
 * End-to-end through the public API: Bot + WPPConnectProvider + a fake
 * wppconnect-server (no network): a flow answered from a LID resolved through
 * `contact/pn-lid`, and stop/start hygiene.
 */
import { describe, it, expect } from 'vitest'
import pino from 'pino'
import { Bot, flow } from '@botmesh/core'
import { WPPConnectProvider } from '../src/WPPConnectProvider.js'
import { fakeFetch, fixture, resolver, type FakeCall } from './support/fake.js'

const PN = '573001112233@c.us'
const LID = '184523390222111@lid'
const H = { 'x-webhook-token': 'hook' }
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms))
async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition')
    await tick(5)
  }
}
let seq = 0
const dm = (from: string, body: string) => ({
  event: 'onmessage', session: 'my-bot', id: `false_${from}_ID${++seq}`, body, type: 'chat', t: 1760700000 + seq,
  from, to: '573009998877@c.us', chatId: from, fromMe: false, isGroupMsg: false, sender: { id: from, pushname: 'Ana' },
})

function make() {
  const { fetch, calls } = fakeFetch((c: FakeCall) => {
    if (c.url.endsWith('/status-session')) return { body: { status: 'CONNECTED' } }
    if (c.url.includes('/contact/pn-lid/')) return { body: fixture('pn-lid-response') }
    return { body: { status: 'success', response: [{ id: `true_${String(c.body?.phone)}_OUT${calls.length}`, to: c.body?.phone }] } }
  })
  const provider = new WPPConnectProvider({
    baseUrl: 'http://127.0.0.1:21465', session: 'my-bot', token: 'tok', webhookToken: 'hook',
    http: { fetch, resolver }, logger: pino({ level: 'silent' }),
  })
  const texts = () => calls.filter((c) => c.url.endsWith('/send-message')).map((c) => ({ to: c.body.phone as string, text: c.body.message as string }))
  return { provider, texts }
}

describe('WPPConnect + Bot end to end', () => {
  it('a flow started by the PN continues when the answer arrives from the LID (pn-lid linked)', async () => {
    const { provider, texts } = make()
    const bot = new Bot({ provider })
    bot.use(flow('hola').ask('¿Tu nombre?', 'name').say((_ctx, c) => `Gracias, ${String(c.state.name)}`))
    await bot.start()
    try {
      expect(await provider.ingest(dm(PN, 'hola'), H)).toBe(200)
      await until(() => texts().length === 1)
      expect(await provider.ingest(dm(LID, 'Ana ñandú 🦤'), H)).toBe(200)
      await until(() => texts().length === 2)
      expect(texts()).toEqual([{ to: PN, text: '¿Tu nombre?' }, { to: PN, text: 'Gracias, Ana ñandú 🦤' }])
    } finally {
      await bot.stop()
    }
  })

  it('stop/start cycles leave no timers or sockets behind', async () => {
    const { provider } = make()
    const bot = new Bot({ provider })
    bot.when('x', (ctx) => ctx.reply('y'))
    await bot.start()
    await bot.stop()
    const baseline = process.getActiveResourcesInfo().length
    for (let i = 0; i < 5; i++) {
      await bot.start()
      await provider.ingest(dm(PN, 'x'), H)
      await tick(20)
      await bot.stop()
    }
    await tick(20)
    expect(process.getActiveResourcesInfo().length).toBeLessThanOrEqual(baseline)
  })
})
