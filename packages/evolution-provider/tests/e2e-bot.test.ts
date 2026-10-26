/**
 * End-to-end through the public API: Bot + EvolutionProvider + a fake REST
 * gateway (no network). Covers a multi-step flow across a LID→PN identity flip,
 * a restart with durable identity, bursts on many chats and stop/start hygiene.
 */
import { describe, it, expect } from 'vitest'
import pino from 'pino'
import { Bot, flow } from '@botmesh/core'
import { EvolutionProvider } from '../src/EvolutionProvider.js'
import type { EvolutionProviderConfig } from '../src/types.js'
import { fakeFetch, resolver, type FakeCall } from './support/fake.js'

const LID = '184523390222111@lid'
const PN = '573001112233@s.whatsapp.net'
const H = { 'x-webhook-secret': 's3cret' }
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms))
async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition')
    await tick(5)
  }
}

let seq = 0
const upsert = (text: string, key: Record<string, unknown>) => ({
  event: 'messages.upsert', instance: 'my-instance',
  data: { key: { fromMe: false, id: `ID${++seq}`, ...key }, pushName: 'Ana', message: { conversation: text }, messageTimestamp: 1760700000 + seq },
})

function make(extra: Partial<EvolutionProviderConfig> = {}) {
  const { fetch, calls } = fakeFetch((c: FakeCall) => {
    if (c.url.includes('/instance/connectionState/')) return { body: { instance: { state: 'open' } } }
    if (c.url.includes('/instance/fetchInstances')) return { body: [{ instance: { ownerJid: '573009998877@s.whatsapp.net' } }] }
    return { body: { key: { id: `OUT${calls.length}`, remoteJid: c.body?.number, fromMe: true } } }
  })
  const provider = new EvolutionProvider({
    baseUrl: 'http://127.0.0.1:8080', apiKey: 'API-KEY', instance: 'my-instance', webhookSecret: 's3cret',
    http: { fetch, resolver }, logger: pino({ level: 'silent' }), ...extra,
  })
  const texts = () => calls.filter((c) => c.url.includes('/message/sendText/')).map((c) => ({ to: c.body.number as string, text: c.body.text as string }))
  return { provider, calls, texts }
}

describe('Evolution + Bot end to end', () => {
  it('a flow keeps going when the contact flips from LID-only to PN+LID, and replies reach one chat', async () => {
    const { provider, texts } = make()
    const bot = new Bot({ provider })
    bot.use(flow('hola').ask('¿Cómo te llamas?', 'name').say((_ctx, c) => `Encantado, ${String(c.state.name)} 👋`))
    await bot.start()
    try {
      expect(provider.ingest(upsert('hola', { remoteJid: LID }), H)).toBe(200)
      await until(() => texts().length === 1)
      expect(provider.ingest(upsert('Ana 🌮', { remoteJid: PN, remoteJidAlt: LID }), H)).toBe(200)
      await until(() => texts().length === 2)
      expect(texts()).toEqual([
        { to: LID, text: '¿Cómo te llamas?' },
        { to: LID, text: 'Encantado, Ana 🌮 👋' },
      ])
    } finally {
      await bot.stop()
    }
  })

  it('with identityPersistence the canonical id survives a restart (first seen LID-only)', async () => {
    const persisted = new Map<string, string>()
    const persistence = { get: (a: string) => persisted.get(a), set: (a: string, c: string) => { persisted.set(a, c) } }
    const first = make({ identityPersistence: persistence })
    const seen1: string[] = []
    first.provider.onEvent((e) => { if (e.kind === 'message') seen1.push(e.message.senderId) })
    first.provider.ingest(upsert('hola', { remoteJid: LID }), H)

    const second = make({ identityPersistence: persistence }) // "restarted" process, empty memory
    const seen2: string[] = []
    second.provider.onEvent((e) => { if (e.kind === 'message') seen2.push(e.message.senderId) })
    second.provider.ingest(upsert('sigo aquí', { remoteJid: PN, remoteJidAlt: LID }), H)
    second.provider.ingest(upsert('y aquí', { remoteJid: PN }), H)
    expect(seen1).toEqual([LID])
    expect(seen2).toEqual([LID, LID])
  })

  it('bursts on many chats: every chat gets its replies in order, none crosses chats', async () => {
    const { provider, texts } = make()
    const bot = new Bot({ provider })
    bot.on('message', () => {})
    bot.when((ctx) => ctx.body.startsWith('n'), (ctx) => ctx.reply(`eco ${ctx.body}`))
    await bot.start()
    try {
      const chats = Array.from({ length: 12 }, (_, i) => `57300000${String(i).padStart(4, '0')}@s.whatsapp.net`)
      for (let n = 0; n < 5; n++) for (const jid of chats) provider.ingest(upsert(`n${n}`, { remoteJid: jid }), H)
      await until(() => texts().length === 60, 5000)
      for (const jid of chats) {
        expect(texts().filter((t) => t.to === jid).map((t) => t.text)).toEqual(['eco n0', 'eco n1', 'eco n2', 'eco n3', 'eco n4'])
      }
    } finally {
      await bot.stop()
    }
  })

  it('a redelivered webhook (same key.id) is answered once', async () => {
    const { provider, texts } = make()
    const bot = new Bot({ provider })
    bot.when('ping', (ctx) => ctx.reply('pong'))
    await bot.start()
    try {
      const hook = upsert('ping', { remoteJid: PN })
      provider.ingest(hook, H)
      provider.ingest(JSON.stringify(hook), H)
      await until(() => texts().length >= 1)
      await tick(50)
      expect(texts()).toEqual([{ to: PN, text: 'pong' }])
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
    const baseline = process.getActiveResourcesInfo().filter((r) => r !== 'TTYWrap').length
    for (let i = 0; i < 5; i++) {
      await bot.start()
      provider.ingest(upsert('x', { remoteJid: PN }), H)
      await tick(20)
      await bot.stop()
    }
    await tick(20)
    expect(process.getActiveResourcesInfo().filter((r) => r !== 'TTYWrap').length).toBeLessThanOrEqual(baseline)
  })
})
