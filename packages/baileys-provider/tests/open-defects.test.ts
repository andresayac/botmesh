/** Low-severity defects left open by the alpha exit review (docs/release-readiness.md). */
import { describe, expect, it, vi } from 'vitest'
import type { WAMessage } from '@whiskeysockets/baileys'

vi.mock('@whiskeysockets/baileys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@whiskeysockets/baileys')>()
  const { fakeMakeWASocket } = await import('./support/harness.js')
  return { ...actual, default: fakeMakeWASocket, makeCacheableSignalKeyStore: (keys: unknown) => keys }
})

const { BaileysProvider } = await import('../src/BaileysProvider.js')
const { RateLimiter } = await import('../src/RateLimiter.js')
const { toJid, isEditedMessage } = await import('../src/index.js')
const { connect } = await import('./support/harness.js')

const PN = '573001112233@s.whatsapp.net'

describe('toJid', () => {
  it('rejects { groupId, userId }: a group participant has no JID of its own', () => {
    expect(() => toJid({ groupId: '120363000000000000', userId: '573001112233' })).toThrow(TypeError)
    expect(toJid({ groupId: '120363000000000000' })).toBe('120363000000000000@g.us')
  })

  it('rejects input with no digits instead of returning "@s.whatsapp.net"', () => {
    expect(() => toJid('')).toThrow(TypeError)
    expect(() => toJid('abc')).toThrow(TypeError)
    expect(() => toJid({ groupId: '' })).toThrow(TypeError)
  })

  it('keeps the hyphen of an old-style group id', () => {
    expect(toJid('573001112233-1590000000', 'group')).toBe('573001112233-1590000000@g.us')
    expect(toJid('+57 300 111 2233')).toBe('573001112233@s.whatsapp.net')
  })
})

describe('RateLimiter: reset() cancels its sleeps', () => {
  it('leaves no timer behind after reset (a long jitter no longer keeps the process alive)', async () => {
    const timers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length
    const before = timers()
    const limiter = new RateLimiter({ jitter: { min: 60_000, max: 60_000 } })
    const first = limiter.acquire('a').catch((e: unknown) => e)
    await new Promise((r) => setTimeout(r, 10))
    expect(timers()).toBeGreaterThan(before)
    limiter.reset()
    await new Promise((r) => setTimeout(r, 10))
    expect(timers()).toBe(before)
    // The send that was sleeping is not let through after the reset.
    const outcome = await Promise.race([first, new Promise((r) => setTimeout(() => r('pending'), 20))])
    expect(outcome).not.toBe(undefined)
  })
})

describe('reconnect policy is configurable', () => {
  type Internals = { scheduleReconnect(ms: number): void }
  const close = (statusCode: number) => ({ 'connection.update': { connection: 'close', lastDisconnect: { error: { output: { statusCode } } } } })

  it('reconnect: { maxAttempts, baseMs, capMs } drives the backoff and the give-up point', async () => {
    const h = await connect(BaileysProvider, { reconnect: { maxAttempts: 2, baseMs: 7, capMs: 10 } })
    const scheduled: number[] = []
    ;(h.provider as unknown as Internals).scheduleReconnect = (ms: number) => { scheduled.push(ms) }
    await h.emit(close(408))
    await h.emit(close(408))
    await h.emit(close(408))
    expect(scheduled).toEqual([7, 10])
    const last = h.ofKind('connection').at(-1)
    expect(last?.update.detail).toMatchObject({ message: 'reconnect exhausted' })
  })

  it('rejects an invalid reconnect policy', () => {
    expect(() => new BaileysProvider({ session: 'x', reconnect: { maxAttempts: 0 } })).toThrow(/reconnect\.maxAttempts/)
    expect(() => new BaileysProvider({ session: 'x', reconnect: { baseMs: -1 } })).toThrow(/reconnect\.baseMs/)
    expect(() => new BaileysProvider({ session: 'x', reconnect: { baseMs: 100, capMs: 50 } })).toThrow(/reconnect\.capMs/)
  })
})

describe('message edits', () => {
  const edit = (originalId: string, content: Record<string, unknown>, wrapped = false): WAMessage => {
    const protocolMessage = { type: 14, key: { remoteJid: PN, fromMe: false, id: originalId }, editedMessage: content }
    return {
      key: { remoteJid: PN, fromMe: false, id: `EDIT-${originalId}` },
      message: wrapped ? { editedMessage: { message: { protocolMessage } } } : { protocolMessage },
      messageTimestamp: 1_700_000_100,
    } as unknown as WAMessage
  }

  const original = (id: string, text = 'typo'): WAMessage => ({ key: { remoteJid: PN, fromMe: false, id }, message: { conversation: text }, messageTimestamp: 1_700_000_000 }) as unknown as WAMessage

  it('delivers an edit as a message with the ORIGINAL id and the new text', async () => {
    const h = await connect(BaileysProvider)
    await h.emit({ 'messages.upsert': { type: 'notify', messages: [original('ORIG-1'), original('ORIG-2')] } })
    await h.emit({ 'messages.upsert': { type: 'notify', messages: [edit('ORIG-1', { conversation: 'fixed text' })] } })
    await h.emit({ 'messages.upsert': { type: 'notify', messages: [edit('ORIG-2', { extendedTextMessage: { text: 'also fixed' } }, true)] } })
    const messages = h.ofKind('message').map((e) => e.message)
    const edits = messages.filter((m) => isEditedMessage(m))
    expect(edits.map((m) => [m.ref.id, m.type, m.body])).toEqual([['ORIG-1', 'text', 'fixed text'], ['ORIG-2', 'text', 'also fixed']])
    expect(edits[0]!.senderId).toBe(PN)
  })

  it('a regular message is not an edit', async () => {
    const h = await connect(BaileysProvider)
    await h.emit({ 'messages.upsert': { type: 'notify', messages: [{ key: { remoteJid: PN, fromMe: false, id: 'M1' }, message: { conversation: 'hola' }, messageTimestamp: 1 } as unknown as WAMessage] } })
    expect(isEditedMessage(h.ofKind('message')[0]!.message)).toBe(false)
  })

  it("editedMessages: 'ignore' drops them, and an edit without its original id is dropped", async () => {
    const h = await connect(BaileysProvider, { editedMessages: 'ignore' })
    await h.emit({ 'messages.upsert': { type: 'notify', messages: [original('ORIG-1')] } })
    await h.emit({ 'messages.upsert': { type: 'notify', messages: [edit('ORIG-1', { conversation: 'fixed' })] } })
    expect(h.ofKind('message').filter((e) => isEditedMessage(e.message))).toEqual([])
    const h2 = await connect(BaileysProvider)
    await h2.emit({ 'messages.upsert': { type: 'notify', messages: [{ key: { remoteJid: PN, fromMe: false, id: 'E' }, message: { protocolMessage: { type: 14, editedMessage: { conversation: 'x' } } }, messageTimestamp: 1 } as unknown as WAMessage] } })
    expect(h2.ofKind('message')).toEqual([])
  })
})

describe('message edits are checked against the original', () => {
  const G = '120363000000000001@g.us'
  const A = '573001110001@s.whatsapp.net'
  const B = '573001110002@s.whatsapp.net'
  const groupMsg = (id: string, participant: string, text: string): WAMessage =>
    ({ key: { remoteJid: G, participant, fromMe: false, id }, message: { conversation: text }, messageTimestamp: 1_700_000_000 }) as unknown as WAMessage
  const groupEdit = (by: string, key: Record<string, unknown>, text: string): WAMessage =>
    ({ key: { remoteJid: G, participant: by, fromMe: false, id: `EDIT-${String(key.id)}-${by}` }, message: { protocolMessage: { type: 14, key, editedMessage: { conversation: text } } }, messageTimestamp: 1_700_000_100 }) as unknown as WAMessage
  const edits = (h: Awaited<ReturnType<typeof connect>>) =>
    h.ofKind('message').map((e) => e.message).filter((m) => isEditedMessage(m)).map((m) => [m.ref.id, m.senderId, m.body])

  it('delivers a group edit by the author of the original (sender view: fromMe)', async () => {
    const h = await connect(BaileysProvider)
    await h.emit({ 'messages.upsert': { type: 'notify', messages: [groupMsg('A-MSG', A, 'pido 2')] } })
    await h.emit({ 'messages.upsert': { type: 'notify', messages: [groupEdit(A, { remoteJid: G, fromMe: true, id: 'A-MSG' }, 'pido 3')] } })
    expect(edits(h)).toEqual([['A-MSG', A, 'pido 3']])
  })

  it("drops an edit of another participant's message, whatever the key claims", async () => {
    const h = await connect(BaileysProvider)
    await h.emit({ 'messages.upsert': { type: 'notify', messages: [groupMsg('A-MSG', A, 'pido 2')] } })
    await h.emit({ 'messages.upsert': { type: 'notify', messages: [
      groupEdit(B, { remoteJid: G, participant: A, fromMe: false, id: 'A-MSG' }, 'cancela todo'),
      groupEdit(B, { remoteJid: G, fromMe: true, id: 'A-MSG' }, 'cancela todo'),
    ] } })
    expect(edits(h)).toEqual([])
  })

  it("drops an edit naming one of the bot's own messages or a message from another chat", async () => {
    const h = await connect(BaileysProvider)
    // The bot's own send (Baileys emits it as `append`) and a message in a 1:1 chat.
    await h.emit({ 'messages.upsert': { type: 'append', messages: [{ key: { remoteJid: G, fromMe: true, id: 'BOT-OUT-1' }, message: { conversation: 'total: 10' }, messageTimestamp: 1 } as unknown as WAMessage] } })
    await h.emit({ 'messages.upsert': { type: 'notify', messages: [{ key: { remoteJid: B, fromMe: false, id: 'B-DM' }, message: { conversation: 'hola' }, messageTimestamp: 1 } as unknown as WAMessage] } })
    await h.emit({ 'messages.upsert': { type: 'notify', messages: [
      groupEdit(B, { remoteJid: G, fromMe: true, id: 'BOT-OUT-1' }, 'x'),
      groupEdit(B, { remoteJid: 'other@s.whatsapp.net', fromMe: true, id: 'BOT-OUT-1' }, 'x'),
      groupEdit(B, { remoteJid: B, fromMe: true, id: 'B-DM' }, 'x'),
    ] } })
    expect(edits(h)).toEqual([])
  })

  it('drops an edit whose original this process has not seen', async () => {
    const h = await connect(BaileysProvider)
    await h.emit({ 'messages.upsert': { type: 'notify', messages: [groupEdit(A, { remoteJid: G, fromMe: true, id: 'UNKNOWN' }, 'x')] } })
    expect(edits(h)).toEqual([])
  })
})
