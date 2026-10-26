/**
 * The README's configuration examples, run as written (only the network and
 * Redis are replaced): they must construct, and the pairing-code example must
 * deliver the 8-character code through `bot.on('qr')`.
 */
import { describe, expect, it, vi } from 'vitest'
import { Bot } from '@botmesh/core'

vi.mock('@whiskeysockets/baileys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@whiskeysockets/baileys')>()
  const { fakeMakeWASocket } = await import('./support/harness.js')
  return {
    ...actual,
    default: (config: Record<string, unknown>) => Object.assign(fakeMakeWASocket(config), {
      requestPairingCode: vi.fn(async (phone: string) => (phone === '573001234567' ? 'ABCD1234' : 'WRONG')),
    }),
    makeCacheableSignalKeyStore: (keys: unknown) => keys,
    useMultiFileAuthState: async () => ({ state: { creds: { registered: false }, keys: {} }, saveCreds: async () => {} }),
    fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 1], isLatest: true }),
  }
})

const { BaileysProvider } = await import('../src/index.js')
type PollStore = import('../src/index.js').PollStore
type StoredPoll = import('../src/index.js').StoredPoll

const sessionsDir = `${process.env.TEMP ?? '/tmp'}/botmesh-baileys-readme`

describe('README examples', () => {
  it('pairing code: the 8-character code reaches bot.on("qr")', async () => {
    const provider = new BaileysProvider({
      session: 'my-bot',
      sessionsDir,
      pairingCode: '+57 300 123 4567', // only the digits count
      qr: { terminal: false },
    })
    const bot = new Bot({ provider })
    const artifacts: string[] = []
    const notifyOperator = vi.fn()
    bot.on('qr', (artifact: string) => {
      artifacts.push(artifact)
      if (artifact.length === 8) notifyOperator(artifact)
    })
    const started = bot.start()
    const sock = () => provider.socket as unknown as { handler?: (e: Record<string, unknown>) => Promise<void> }
    await vi.waitFor(() => expect(sock()?.handler).toBeTypeOf('function'))
    await sock().handler!({ 'connection.update': { qr: '2@long-qr-payload' } })
    await sock().handler!({ 'connection.update': { connection: 'open' } })
    await started
    expect(artifacts).toEqual(['2@long-qr-payload', 'ABCD1234'])
    expect(notifyOperator).toHaveBeenCalledWith('ABCD1234')
    await bot.stop()
  })

  it('rate limiter and pollStore examples construct as written', () => {
    const redis = new Map<string, string>()
    const pollStore: PollStore = {
      get: async (id) => {
        const raw = redis.get(`poll:${id}`)
        return raw ? (JSON.parse(raw) as StoredPoll) : undefined
      },
      set: async (id, poll) => { redis.set(`poll:${id}`, JSON.stringify(poll)) },
      delete: async (id) => { redis.delete(`poll:${id}`) },
    }
    expect(() => new BaileysProvider({ session: 'my-bot', sessionsDir, pollStore })).not.toThrow()
    expect(() => new BaileysProvider({
      session: 'my-bot',
      sessionsDir,
      rateLimit: {
        perChat: { max: 5, window: '10s' },
        global: { max: 50, window: '60s' },
        jitter: { min: 500, max: 1500 },
        maxWait: '30s',
      },
    })).not.toThrow()
  })
})
