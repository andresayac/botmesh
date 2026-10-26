/**
 * Defects left open by the alpha exit review: putFlow left stale copies of a subflow
 * inlined in the flows that use it, flows went live before they were persisted, the
 * control-plane key check stopped at the first match, and the REST API had no
 * body-read timeout (slowloris).
 */
import { createServer, type Server } from 'node:http'
import { connect } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createTestBot } from '@botmesh/core/testing'
import {
  BotManager,
  MemoryBotConfigStore,
  createControlPlaneApi,
  createRestApi,
  type BotConfigRecord,
  type FlowDocument,
} from '../src/index.js'

const main: FlowDocument = { version: 1, id: 'main', trigger: 'start', steps: [{ kind: 'say', text: 'main' }, { kind: 'subflow', flowId: 'shared' }] }
const shared = (text: string): FlowDocument => ({ version: 1, id: 'shared', trigger: 'shared-only', steps: [{ kind: 'say', text }] })

/** A config store whose next put() fails (a full disk, a lost database). */
class FlakyStore extends MemoryBotConfigStore {
  failNext = false
  override async put(record: BotConfigRecord): Promise<void> {
    if (this.failNext) { this.failNext = false; throw new Error('disk full') }
    return super.put(record)
  }
}

describe('putFlow recompiles the flows that use it as a subflow', () => {
  it('a flow that inlines "shared" runs the NEW version after putFlow("shared")', async () => {
    const { bot, chat } = await createTestBot()
    const manager = new BotManager({ configStore: new MemoryBotConfigStore(), factory: () => bot })
    await manager.createBot({ id: 'b', flows: [main, shared('old shared')], autoStart: false })
    await manager.putFlow('b', 'shared', shared('new shared'))
    await chat.send('start')
    await chat.expectReply('main')
    await chat.expectReply('new shared')
    await bot.stop()
  })
})

describe('flows go live only after they are persisted', () => {
  it('addFlow: a failed save leaves the live bot without the flow', async () => {
    const { bot } = await createTestBot()
    const store = new FlakyStore()
    const manager = new BotManager({ configStore: store, factory: () => bot })
    await manager.createBot({ id: 'b', flows: [shared('s')], autoStart: false })
    store.failNext = true
    await expect(manager.addFlow('b', { version: 1, id: 'extra', trigger: 'x', steps: [{ kind: 'say', text: 'x' }] })).rejects.toThrow(/disk full/)
    expect(bot.hasFlow('extra')).toBe(false)
    expect(manager.listFlowDocuments('b').map((f) => f.id)).toEqual(['shared'])
    await bot.stop()
  })

  it('putFlow: a failed save keeps the live flow as it was', async () => {
    const { bot, chat } = await createTestBot()
    const store = new FlakyStore()
    const manager = new BotManager({ configStore: store, factory: () => bot })
    await manager.createBot({ id: 'b', flows: [main, shared('old shared')], autoStart: false })
    store.failNext = true
    await expect(manager.putFlow('b', 'shared', shared('new shared'))).rejects.toThrow(/disk full/)
    await chat.send('shared-only')
    await chat.expectReply('old shared')
    await chat.send('start')
    await chat.expectReply('main')
    await chat.expectReply('old shared')
    await bot.stop()
  })
})

describe('control plane /v1 key check', () => {
  it('compares the presented key with EVERY configured key (no early exit)', async () => {
    const reads: string[] = []
    const key = (id: string, secret: string) => ({
      id, tenantId: 'acme', scopes: ['bots:read'] as const,
      get secret() { reads.push(id); return secret },
    })
    const api = createControlPlaneApi(new BotManager(), { tenantId: 'acme', apiKeys: [key('a', 'first-key'), key('b', 'second-key'), key('c', 'third-key')] as never })
    const status = await new Promise<number>((resolve) => {
      const res = { status: 0, writeHead(s: number) { this.status = s; return this }, end() { resolve(this.status) } }
      api({ method: 'GET', url: '/v1/bots', headers: { 'x-api-key': 'first-key' } } as unknown as IncomingMessage, res as unknown as ServerResponse)
    })
    expect(status).toBe(200)
    expect(reads).toEqual(['a', 'b', 'c'])
  })
})

describe('REST API body read timeout', () => {
  let server: Server | undefined
  afterEach(async () => { await new Promise<void>((r) => (server ? server.close(() => r()) : r())); server = undefined })

  it('answers 408 to a client that sends the headers but stalls the body', async () => {
    const manager = new BotManager({ configStore: new MemoryBotConfigStore(), factory: () => { throw new Error('unused') } })
    const token = 'ops-token-0123456789'
    const api = createRestApi(manager, { tokens: [{ id: 'ops', token, scopes: ['*'] }], rateLimit: false, bodyTimeoutMs: 100 })
    server = createServer((req, res) => api(req, res))
    const port = await new Promise<number>((r) => server!.listen(0, '127.0.0.1', () => r((server!.address() as { port: number }).port)))
    const reply = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, '127.0.0.1', () => {
        socket.write(
          'POST /v1/bots HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n' +
          `Authorization: Bearer ${token}\r\nContent-Length: 1000\r\nConnection: close\r\n\r\n{"id":`,
        )
      })
      let data = ''
      socket.on('data', (chunk) => { data += chunk.toString() })
      socket.on('close', () => resolve(data))
      socket.on('error', reject)
      setTimeout(() => { socket.destroy(); resolve(data) }, 3000)
    })
    expect(reply).toMatch(/^HTTP\/1\.1 408/)
    expect(reply).toMatch(/REQUEST_TIMEOUT/)
  })

  it('rejects an invalid bodyTimeoutMs', () => {
    expect(() => createRestApi(new BotManager(), { tokens: [{ id: 'ops', token: 'ops-token-0123456789', scopes: ['*'] }], bodyTimeoutMs: 0 })).toThrow(/bodyTimeoutMs/)
  })
})
