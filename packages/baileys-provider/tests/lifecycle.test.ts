/**
 * start()/stop() races and user callbacks: a stop() that lands while start() is
 * still loading the auth state or the WA Web version must not leave a live
 * socket behind, a second start() must not open a second socket on the same
 * session (WhatsApp would close one with 440), and a failing QR handler must
 * not crash the process. Config mistakes fail in the constructor with an
 * actionable message.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Boom } from '@hapi/boom'
import { ProviderError, RecipientUnreachableError } from '@botmesh/core'

let releaseVersion: (() => void) | undefined
let holdVersion = false

vi.mock('@whiskeysockets/baileys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@whiskeysockets/baileys')>()
  const { fakeMakeWASocket } = await import('./support/harness.js')
  return {
    ...actual,
    default: fakeMakeWASocket,
    makeCacheableSignalKeyStore: (keys: unknown) => keys,
    useMultiFileAuthState: async () => ({ state: { creds: { registered: true }, keys: {} }, saveCreds: async () => {} }),
    fetchLatestBaileysVersion: async () => {
      if (holdVersion) await new Promise<void>((resolve) => { releaseVersion = resolve })
      return { version: [2, 3000, 1], isLatest: true }
    },
  }
})

const { BaileysProvider } = await import('../src/BaileysProvider.js')
type Sock = { end: ReturnType<typeof vi.fn>; handler?: (e: Record<string, unknown>) => Promise<void> }
const sockOf = (p: InstanceType<typeof BaileysProvider>) => p.socket as unknown as Sock | null

const tmpSessions = `${process.env.TEMP ?? process.env.TMPDIR ?? '/tmp'}/botmesh-baileys-lifecycle`
const make = (extra: Record<string, unknown> = {}) =>
  new BaileysProvider({ session: 'lifecycle', sessionsDir: tmpSessions, qr: { terminal: false }, rateLimit: { enabled: false }, ...extra })

afterEach(() => { holdVersion = false; releaseVersion = undefined })

describe('start()/stop() races', () => {
  it('a stop() during start() leaves no socket behind', async () => {
    const p = make()
    holdVersion = true
    const starting = p.start()
    await vi.waitFor(() => expect(releaseVersion).toBeTypeOf('function'))
    await p.stop()
    releaseVersion!()
    await starting
    expect(p.socket).toBeNull()
  })

  it('a second start() ends the first socket instead of opening two on one session', async () => {
    const p = make()
    await p.start()
    const first = sockOf(p)!
    await p.start()
    expect(first.end).toHaveBeenCalledTimes(1)
    expect(sockOf(p)).not.toBe(first)
    await p.stop()
  })

  it('start() → stop() cycles leave no socket and no timer', async () => {
    const p = make()
    for (let i = 0; i < 5; i++) {
      await p.start()
      await p.stop()
    }
    expect(p.socket).toBeNull()
    expect((p as unknown as { reconnectTimer: unknown }).reconnectTimer).toBeNull()
  })
})

describe('reconnect exhaustion', () => {
  it('emits the terminal "reconnect exhausted" close when transient drops use up the attempts', async () => {
    const p = make()
    await p.start()
    const closed: Array<Record<string, unknown> | undefined> = []
    p.onEvent((e) => { if (e.kind === 'connection' && e.update.state === 'closed') closed.push(e.update.detail as Record<string, unknown>) })
    ;(p as unknown as { reconnectAttempts: number }).reconnectAttempts = 10
    await sockOf(p)!.handler!({ 'connection.update': { connection: 'close', lastDisconnect: { error: new Boom('timed out', { statusCode: 408 }) } } })
    expect(closed.map((d) => d?.message)).toEqual(['timed out', 'reconnect exhausted'])
    expect((p as unknown as { reconnectTimer: unknown }).reconnectTimer).toBeNull()
    await p.stop()
  })
})

describe('QR handler failures', () => {
  it('logs a rejecting or throwing qr.handler instead of crashing', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    try {
      for (const handler of [async () => { throw new Error('webhook down') }, () => { throw new Error('sync boom') }]) {
        const warn = vi.fn()
        const logger = { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() }
        const p = make({ qr: { terminal: false, handler }, logger })
        await p.start()
        const events: string[] = []
        p.onEvent((e) => { if (e.kind === 'connection') events.push(e.update.state) })
        await sockOf(p)!.handler!({ 'connection.update': { qr: 'QR-PAYLOAD' } })
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(events).toContain('authenticating')
        expect(warn).toHaveBeenCalled()
        expect(JSON.stringify(warn.mock.calls)).not.toContain('QR-PAYLOAD')
        await p.stop()
      }
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
    expect(unhandled).toEqual([])
  })
})

describe('config validation', () => {
  it('rejects a pairing code with no usable phone number', () => {
    for (const pairingCode of ['abc', '+1 23', '1234567890123456']) {
      expect(() => make({ pairingCode })).toThrow(/pairingCode/)
    }
    expect(() => make({ pairingCode: '+57 300 123 4567' })).not.toThrow()
  })

  it('rejects an unknown browser preset or a malformed tuple', () => {
    expect(() => make({ browser: 'linux' })).toThrow(/browser/)
    expect(() => make({ browser: ['Mac OS', 'Chrome'] })).toThrow(/browser/)
    expect(() => make({ browser: 'ubuntu' })).not.toThrow()
  })
})

describe('deleteMessage errors', () => {
  it('rejects with typed ProviderErrors like send()', async () => {
    const p = make()
    await p.start()
    const sock = p.socket as unknown as { sendMessage: ReturnType<typeof vi.fn> }
    sock.sendMessage.mockRejectedValueOnce(new Boom('forbidden', { statusCode: 403 }))
    await expect(p.deleteMessage({ id: 'X', chatId: '573001112233@s.whatsapp.net' })).rejects.toBeInstanceOf(RecipientUnreachableError)
    sock.sendMessage.mockRejectedValueOnce(new TypeError('boom'))
    await expect(p.deleteMessage({ id: 'X', chatId: '573001112233@s.whatsapp.net' })).rejects.toBeInstanceOf(ProviderError)
    await p.stop()
  })
})
