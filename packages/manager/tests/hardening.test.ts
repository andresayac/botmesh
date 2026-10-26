/**
 * Pre-stable hardening: subflows of config-backed bots, portable file names, and a seeded
 * fuzz of the `/v1` REST API (auth, tenancy, envelopes, no 500s, no crash).
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { Bot } from '@botmesh/core'
import { MockProvider, createTestBot } from '@botmesh/core/testing'
import {
  BotManager,
  FileBotConfigStore,
  ManagerError,
  MemoryBotConfigStore,
  ROUTES,
  createRestApi,
  type BotConfigRecord,
  type FlowDocument,
  type RestApiHandler,
} from '../src/index.js'

const dirs: string[] = []
afterEach(async () => { while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true }) })
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'botmesh-manager-hard-'))
  dirs.push(dir)
  return dir
}

const main: FlowDocument = { version: 1, id: 'main', trigger: 'start', steps: [{ kind: 'say', text: 'main' }, { kind: 'subflow', flowId: 'shared' }] }
const shared: FlowDocument = { version: 1, id: 'shared', trigger: 'shared-only', steps: [{ kind: 'say', text: 'from shared' }] }

describe('config-backed bots with subflows', () => {
  it('createBot() and restore() resolve subflow steps against the bot\'s own flows', async () => {
    const store = new MemoryBotConfigStore()
    const providers: MockProvider[] = []
    const factory = () => { const provider = new MockProvider(); providers.push(provider); return new Bot({ provider }) }
    const manager = new BotManager({ configStore: store, factory })
    await manager.createBot({ id: 'b1', flows: [main, shared], autoStart: false })
    expect(manager.listFlowDocuments('b1').map((f) => f.id)).toEqual(['main', 'shared'])

    const again = new BotManager({ configStore: store, factory })
    const restored = await again.restore()
    expect(restored).toEqual({ b1: 'stopped' })
    await again.updateBot('b1', { flows: [shared, main] })
    expect(again.listFlowDocuments('b1').map((f) => f.id)).toEqual(['shared', 'main'])
  })

  it('a missing subflow is a validation error at createBot(), not a broken bot later', async () => {
    const manager = new BotManager({ configStore: new MemoryBotConfigStore(), factory: () => new Bot({ provider: new MockProvider() }) })
    const error = await manager.createBot({ id: 'b2', flows: [main], autoStart: false }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ManagerError)
    expect((error as ManagerError).code).toBe('INVALID')
    expect(manager.has('b2')).toBe(false)
  })

  it('a diamond of subflows (exponential when inlined) is refused fast at createBot() and at restore()', async () => {
    // f0 calls f1 three times, f1 calls f2 three times...: 3^15 inlined steps from a few KB of JSON.
    const flows: FlowDocument[] = Array.from({ length: 16 }, (_, i) => ({
      version: 1,
      id: `f${i}`,
      trigger: `t${i}`,
      steps: i === 15 ? [{ kind: 'say', text: 'leaf' }] : Array.from({ length: 3 }, () => ({ kind: 'subflow' as const, flowId: `f${i + 1}` })),
    }))
    const store = new MemoryBotConfigStore()
    const factory = () => new Bot({ provider: new MockProvider() })
    const manager = new BotManager({ configStore: store, factory })
    let started = performance.now()
    const error = await manager.createBot({ id: 'diamond', flows, autoStart: false }).catch((e: unknown) => e)
    expect(performance.now() - started).toBeLessThan(2000)
    expect((error as ManagerError).code).toBe('INVALID')
    expect(JSON.stringify((error as ManagerError).details)).toMatch(/expand/)

    // A record stored by an older version fails that one bot at restore, without blocking the process.
    await store.put({ id: 'diamond', tenantId: 'default', flows, desiredState: 'stopped', version: 1, createdAt: 0, updatedAt: 0 })
    started = performance.now()
    const outcome = await new BotManager({ configStore: store, factory }).restore()
    expect(performance.now() - started).toBeLessThan(2000)
    expect(outcome.diamond).not.toBe('stopped')
  })

  it('removeFlow() refuses to drop a flow another stored flow uses as a subflow (restore would break)', async () => {
    const store = new MemoryBotConfigStore()
    const factory = () => new Bot({ provider: new MockProvider() })
    const manager = new BotManager({ configStore: store, factory })
    const nested: FlowDocument = { version: 1, id: 'nested', trigger: 'n', steps: [{ kind: 'condition', if: 'true', then: [{ kind: 'subflow', flowId: 'shared' }] }] }
    await manager.createBot({ id: 'b4', flows: [shared, nested], autoStart: false })
    await expect(manager.removeFlow('b4', 'shared')).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(manager.listFlowDocuments('b4').map((f) => f.id)).toEqual(['shared', 'nested'])
    expect(await manager.removeFlow('b4', 'nested')).toBe(true)
    expect(await manager.removeFlow('b4', 'shared')).toBe(true)
    expect(await new BotManager({ configStore: store, factory }).restore()).toEqual({ b4: 'stopped' })
  })

  it('the subflow actually runs on the rebuilt bot', async () => {
    const { bot, chat } = await createTestBot()
    const manager = new BotManager({ configStore: new MemoryBotConfigStore(), factory: () => bot })
    await manager.createBot({ id: 'b3', flows: [main, shared], autoStart: false })
    await chat.send('start')
    await chat.expectReply('main')
    await chat.expectReply('from shared')
    await bot.stop()
  })
})

describe('FileBotConfigStore on case-insensitive file systems', () => {
  const record = (over: Partial<BotConfigRecord>): BotConfigRecord => ({ id: 'a', tenantId: 'acme', desiredState: 'stopped', version: 1, createdAt: 1, updatedAt: 1, ...over })

  it('refuses a bot id that differs from an existing one only by case (it would share the file)', async () => {
    const store = new FileBotConfigStore({ dir: await tempDir() })
    await store.put(record({ id: 'shop' }))
    const error = await store.put(record({ id: 'Shop' })).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ManagerError)
    expect((error as ManagerError).code).toBe('CONFLICT')
    expect((await store.list()).map((r) => r.id)).toEqual(['shop'])
  })

  it('refuses a tenant id that differs from an existing one only by case (it would share the directory)', async () => {
    const store = new FileBotConfigStore({ dir: await tempDir() })
    await store.put(record({ id: 'a', tenantId: 'acme' }))
    const error = await store.put(record({ id: 'b', tenantId: 'ACME' })).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ManagerError)
    expect((error as ManagerError).code).toBe('CONFLICT')
    const fresh = new FileBotConfigStore({ dir: dirs[dirs.length - 1]! })
    expect((await fresh.list()).map((r) => `${r.tenantId}/${r.id}`)).toEqual(['acme/a'])
  })

  it('createBot() surfaces the collision as CONFLICT and leaves nothing registered', async () => {
    const manager = new BotManager({ persistence: { dir: await tempDir() }, factory: () => new Bot({ provider: new MockProvider() }) })
    await manager.createBot({ id: 'shop', autoStart: false })
    await expect(manager.createBot({ id: 'SHOP', autoStart: false })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(manager.has('SHOP')).toBe(false)
    expect(manager.list().map((s) => s.id)).toEqual(['shop'])
  })
})

/* â”€â”€ REST fuzz â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

interface Res { status: number; headers: Record<string, string>; body: any; raw: string }

const OPS = 'ops-secret-0123456789abcdef'
const ACME = 'acme-secret-0123456789abcdef'
const READER = 'reader-secret-0123456789abcd'
const BETA = 'beta-secret-0123456789abcdefg'

function call(handler: RestApiHandler, method: string, url: string, headers: Record<string, string>, payload?: string): Promise<Res> {
  const req = Readable.from(payload === undefined ? [] : [Buffer.from(payload)]) as unknown as IncomingMessage
  Object.assign(req, { method, url, headers, socket: { remoteAddress: '10.0.0.1' } })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no response for ${method} ${url}`)), 5000)
    const out: Res = { status: 0, headers: {}, body: undefined, raw: '' }
    const res = {
      headersSent: false,
      writeHead(status: number, h: Record<string, string>) { out.status = status; out.headers = h; res.headersSent = true; return res },
      end(chunk?: string) {
        clearTimeout(timer)
        out.raw = chunk ?? ''
        try { out.body = chunk ? JSON.parse(chunk) : undefined } catch (error) { reject(error) }
        resolve(out)
      },
    }
    handler(req, res as unknown as ServerResponse)
  })
}

function prng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (n: number) => Math.floor(next() * n)
  const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)]!
  return { next, int, pick }
}

const WEIRD = ['', 'acme-bot', 'beta-bot', 'ACME-BOT', '..', '%2e%2e', '%2F', 'a%2Fb', '%', '%E0%A4%A', '%00', 'x'.repeat(300), 'Ã±andÃº', 'ðŸ¤–', '__proto__', 'constructor', 'main', 'bot-1', '-1', ' ', '%20']

function randomJson(r: ReturnType<typeof prng>, depth = 0): unknown {
  const k = r.int(depth > 3 ? 5 : 8)
  switch (k) {
    case 0: return r.pick([null, true, false, 0, -1, 1e308, 3.14])
    case 1: return r.pick(WEIRD)
    case 2: return r.pick(['text', 'image', 'poll', 'location', 'contact', 'buttons', 'raw'])
    case 3: return 'y'.repeat(r.int(5000))
    case 4: return r.int(100)
    case 5: return Array.from({ length: r.int(4) }, () => randomJson(r, depth + 1))
    default: {
      const keys = ['id', 'tenantId', 'name', 'provider', 'flows', 'meta', 'autoStart', 'chatId', 'text', 'content', 'kind', 'media', 'url', 'flowId', 'state', 'desiredState', 'expectedVersion', '__proto__', 'constructor', 'version', 'trigger', 'steps', 'options', 'lat', 'lng', 'question']
      const out: Record<string, unknown> = {}
      for (let i = r.int(5); i > 0; i--) Object.defineProperty(out, r.pick(keys), { value: randomJson(r, depth + 1), enumerable: true, configurable: true, writable: true })
      return out
    }
  }
}

describe('REST API fuzz', () => {
  it('never answers 500, never leaks across tenants, always returns a well-formed envelope', async () => {
    const providers = new Map<string, MockProvider>()
    const manager = new BotManager({
      configStore: new MemoryBotConfigStore(),
      factory: (cfg) => { const provider = new MockProvider(); providers.set(cfg.id, provider); return new Bot({ provider }) },
    })
    await manager.createBot({ id: 'acme-bot', tenantId: 'acme', autoStart: true, meta: { apiKey: 'top-secret-value' } })
    await manager.createBot({ id: 'beta-bot', tenantId: 'beta', autoStart: false })
    const api = createRestApi(manager, {
      tokens: [
        { id: 'ops', token: OPS, scopes: ['*'] },
        { id: 'acme', token: ACME, tenantId: 'acme', scopes: ['*'] },
        { id: 'reader', token: READER, tenantId: 'acme', scopes: ['bots:read'] },
        { id: 'beta', token: BETA, tenantId: 'beta', scopes: ['*'] },
      ],
      rateLimit: false,
      mediaHostResolver: async () => ['93.184.216.34'],
    })

    const r = prng(0xb07)
    const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'get']
    const tokens: Array<[string, string | undefined]> = [['none', undefined], ['bad', 'x'.repeat(30)], ['ops', OPS], ['acme', ACME], ['reader', READER], ['beta', BETA]]
    const contentTypes = ['application/json', 'application/json; charset=utf-8', 'text/plain', 'application/merge-patch+json', 'application/jsonx', '']

    for (let i = 0; i < 1500; i++) {
      const route = r.pick(ROUTES)
      const path = route.path.replace(/\{(\w+)\}/g, () => r.pick(WEIRD).replace(/\//g, '%2F') || 'x')
      const query = r.next() < 0.3 ? `?chatId=${encodeURIComponent(r.pick(WEIRD))}&limit=${r.pick(['1', '0', '201', 'abc', '-5', '50'])}&cursor=${r.pick(['', 'bad', 'WzEsImEiXQ', '%%'])}` : ''
      const url = (r.next() < 0.1 ? r.pick(['/v1x', '/V1', '//v1', '/v1/../v1', '']) : '/v1') + path + query
      const method = r.next() < 0.8 ? route.method : r.pick(methods)
      const [who, token] = r.pick(tokens)
      const headers: Record<string, string> = {}
      if (token) headers[r.next() < 0.5 ? 'authorization' : 'x-api-key'] = headers.authorization === undefined && r.next() < 0.5 ? `Bearer ${token}` : token
      let payload: string | undefined
      if (r.next() < 0.7) {
        payload = r.next() < 0.1 ? r.pick(['{', 'null', '[]', '"x"', '\u0000', '{"a":1}{', '1e999']) : JSON.stringify(randomJson(r))
        headers['content-type'] = r.pick(contentTypes)
      }
      if (r.next() < 0.1) headers['x-request-id'] = r.pick(['ok-id', 'bad id with spaces', 'x'.repeat(200), '<script>'])
      if (r.next() < 0.1) headers['idempotency-key'] = r.pick(['k1', 'k2', '', 'Ã©', 'x'.repeat(201)])

      const res = await call(api, method, url, headers, payload)
      const label = `#${i} ${who} ${method} ${url} ${payload?.slice(0, 80) ?? ''}`
      expect(res.status, label).toBeGreaterThanOrEqual(200)
      expect(res.status, `${label} â†’ ${res.raw.slice(0, 300)}`).toBeLessThan(500)
      expect(res.headers['x-request-id'], label).toMatch(/^[A-Za-z0-9._:-]{1,128}$/)
      if (res.status >= 400) {
        expect(res.body?.error?.code, label).toEqual(expect.any(String))
        expect(res.body?.error?.requestId, label).toBe(res.headers['x-request-id'])
      }
      if (res.status < 300 && route.scope !== undefined && route.method === method.toUpperCase()) {
        expect(['ops', 'acme', 'reader', 'beta'], label).toContain(who)
      }
      if (who === 'reader' && res.status < 300) expect(method.toUpperCase(), label).toBe('GET')
      if (who === 'beta' || who === 'acme') {
        const foreign = who === 'beta' ? 'acme-bot' : 'beta-bot'
        if (res.status < 300) expect(res.raw, label).not.toContain(foreign)
      }
      expect(res.raw, label).not.toContain('top-secret-value')
    }

    // Still healthy afterwards.
    expect((await call(api, 'GET', '/v1/health', {})).status).toBe(200)
    await manager.shutdown()
  }, 60_000)
})
