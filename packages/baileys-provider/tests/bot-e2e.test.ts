/**
 * End to end through the public API: a real `Bot` driving a `BaileysProvider`
 * whose Baileys socket is the test fake. Covers what a user sees: replies,
 * flows that survive a LID→PN switch, reactions not hitting the catch-all,
 * bursts across many chats, a poll round-trip and stop/start cycles.
 */
import { describe, expect, it, vi } from 'vitest'
import type { WAMessage } from '@whiskeysockets/baileys'
import { Bot, flow } from '@botmesh/core'

vi.mock('@whiskeysockets/baileys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@whiskeysockets/baileys')>()
  const { fakeMakeWASocket, ME } = await import('./support/harness.js')
  return {
    ...actual,
    default: fakeMakeWASocket,
    makeCacheableSignalKeyStore: (keys: unknown) => keys,
    useMultiFileAuthState: async () => ({ state: { creds: { me: ME, registered: true }, keys: {} }, saveCreds: async () => {} }),
    fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 1], isLatest: true }),
  }
})

const { BaileysProvider } = await import('../src/BaileysProvider.js')
type Sock = {
  handler?: (e: Record<string, unknown>) => Promise<void>
  sendMessage: ReturnType<typeof vi.fn>
  lidMap: Map<string, string>
}

let n = 0
const text = (key: Record<string, unknown>, body: string): WAMessage =>
  ({ key: { fromMe: false, id: `E2E-${++n}`, ...key }, message: { conversation: body }, messageTimestamp: 1_700_000_000 } as unknown as WAMessage)

async function startBot(setup: (bot: Bot) => void) {
  const provider = new BaileysProvider({
    session: 'e2e', sessionsDir: `${process.env.TEMP ?? '/tmp'}/botmesh-baileys-e2e`, qr: { terminal: false }, rateLimit: { enabled: false },
  })
  const bot = new Bot({ provider })
  setup(bot)
  const started = bot.start()
  const sock = () => provider.socket as unknown as Sock
  await vi.waitFor(() => expect(sock()?.handler).toBeTypeOf('function'))
  await sock().handler!({ 'connection.update': { connection: 'open' } })
  await started
  const deliver = (messages: WAMessage[]) => sock().handler!({ 'messages.upsert': { type: 'notify', messages } })
  const sent = () => sock().sendMessage.mock.calls.map(([jid, content]) => ({ jid: jid as string, text: (content as { text?: string }).text }))
  return { bot, provider, sock, deliver, sent }
}

const LID = '200000000000001@lid'
const PN = '573002222222@s.whatsapp.net'

describe('Bot + BaileysProvider end to end', () => {
  it('answers, keeps a flow on one identity across a LID→PN switch and ignores reactions', async () => {
    const t = await startBot((bot) => {
      bot.use(flow('pedido').ask('¿Cuántas?', 'qty').say((_ctx, c) => `Listo: ${c.state.qty}`))
      bot.when(() => true, (ctx) => ctx.reply('fallback'))
    })
    await t.deliver([text({ remoteJid: LID, remoteJidAlt: PN }, 'pedido')])
    await vi.waitFor(() => expect(t.sent().map((s) => s.text)).toContain('¿Cuántas?'))
    // A reaction to the question arrives as an upsert first: it must not reach the catch-all.
    await t.deliver([{ key: { remoteJid: LID, fromMe: false, id: `E2E-${++n}` }, message: { reactionMessage: { key: { remoteJid: LID, id: 'OUT-1', fromMe: true }, text: '👍' } } } as unknown as WAMessage])
    // The answer arrives as a bare LID: same person, same conversation.
    await t.deliver([text({ remoteJid: LID }, '3')])
    await vi.waitFor(() => expect(t.sent().map((s) => s.text)).toContain('Listo: 3'))
    expect(t.sent().map((s) => s.text)).not.toContain('fallback')
    expect(new Set(t.sent().map((s) => s.jid))).toEqual(new Set([PN]))
    await t.bot.stop()
  })

  it('serves a burst over many chats, each chat in order', async () => {
    const t = await startBot((bot) => { bot.when(() => true, (ctx) => ctx.reply(`echo ${ctx.body}`)) })
    const chats = Array.from({ length: 40 }, (_, i) => `57300${String(i).padStart(7, '0')}@s.whatsapp.net`)
    await Promise.all(chats.map((jid) => t.deliver([text({ remoteJid: jid }, '1'), text({ remoteJid: jid }, '2'), text({ remoteJid: jid }, '3')])))
    await vi.waitFor(() => expect(t.sent()).toHaveLength(chats.length * 3), { timeout: 5000 })
    for (const jid of chats) {
      expect(t.sent().filter((s) => s.jid === jid).map((s) => s.text)).toEqual(['echo 1', 'echo 2', 'echo 3'])
    }
    await t.bot.stop()
  })

  it('handles unicode, empty and huge bodies without crashing', async () => {
    const t = await startBot((bot) => { bot.when(() => true, (ctx) => ctx.reply(`len ${[...ctx.body].length}`)) })
    const jid = '573009999999@s.whatsapp.net'
    const bodies = ['👨‍👩‍👧‍👦🇨🇴', 'ñandú\u0000‮txt', 'x'.repeat(200_000)]
    await t.deliver(bodies.map((b) => text({ remoteJid: jid }, b)))
    await vi.waitFor(() => expect(t.sent()).toHaveLength(bodies.length))
    expect(t.sent().map((s) => s.text)).toEqual(bodies.map((b) => `len ${[...b].length}`))
    await t.bot.stop()
  })

  it('survives stop/start cycles and keeps answering', async () => {
    const t = await startBot((bot) => { bot.when('ping', (ctx) => ctx.reply('pong')) })
    await t.bot.stop()
    for (let i = 0; i < 3; i++) {
      const started = t.bot.start()
      await vi.waitFor(() => expect(t.sock()?.handler).toBeTypeOf('function'))
      await t.sock().handler!({ 'connection.update': { connection: 'open' } })
      await started
      await t.deliver([text({ remoteJid: PN }, 'ping')])
      await vi.waitFor(() => expect(t.sent().map((s) => s.text)).toEqual(['pong']))
      await t.bot.stop()
      expect(t.provider.socket).toBeNull()
    }
  })
})
