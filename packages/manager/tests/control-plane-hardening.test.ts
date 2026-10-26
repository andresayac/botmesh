/**
 * createControlPlaneApi over a real socket: a malformed path must not crash the process,
 * and the in-memory audit log / idempotency registry must stay bounded.
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { AuditLog, BotManager, IdempotencyRegistry, createControlPlaneApi } from '../src/index.js'

const KEY = 'reader-key-0123456789abcdef'

describe('createControlPlaneApi hardening', () => {
  it('answers 400 for a malformed percent-encoded bot id instead of throwing out of the handler', async () => {
    const manager = new BotManager()
    const handler = createControlPlaneApi(manager, { tenantId: 'acme', apiKeys: [{ id: 'r', tenantId: 'acme', secret: KEY, scopes: ['bots:read'] }] })
    const crashes: unknown[] = []
    const server = createServer((req, res) => {
      try { handler(req, res) } catch (error) { crashes.push(error); res.writeHead(599).end() }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/bots/%E0%A4%A/start`, { method: 'POST', headers: { 'x-api-key': KEY } })
      expect(crashes).toEqual([])
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BAD_REQUEST')
    } finally {
      await new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) })
    }
  })

  it('does not echo an invalid X-Request-Id', async () => {
    const handler = createControlPlaneApi(new BotManager(), { tenantId: 'acme', apiKeys: [{ id: 'r', tenantId: 'acme', secret: KEY, scopes: ['bots:read'] }] })
    const server = createServer(handler)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/health`, { headers: { 'x-api-key': KEY, 'x-request-id': `<script>${'x'.repeat(500)}` } })
      expect(res.status).toBe(200)
      expect(res.headers.get('x-request-id')).toMatch(/^[A-Za-z0-9._:-]{1,128}$/)
    } finally {
      await new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) })
    }
  })

  it('AuditLog keeps at most maxEntries (oldest first out); default 10 000', () => {
    const audit = new AuditLog({ maxEntries: 3 })
    for (let i = 0; i < 5; i++) audit.append({ tenantId: 'a', actorId: 'u', action: `a${i}`, resource: 'r', outcome: 'allowed' })
    expect(audit.list('a').map((e) => e.action)).toEqual(['a2', 'a3', 'a4'])
    const fallback = new AuditLog()
    for (let i = 0; i < 10_005; i++) fallback.append({ tenantId: 'a', actorId: 'u', action: 'x', resource: 'r', outcome: 'allowed' })
    expect(fallback.list('a')).toHaveLength(10_000)
  })

  it('IdempotencyRegistry evicts the oldest settled keys beyond maxEntries (default 1000)', async () => {
    const registry = new IdempotencyRegistry<number>({ maxEntries: 2 })
    let runs = 0
    const op = async () => ++runs
    await registry.run('a', 'k1', 'fp', op)
    await registry.run('a', 'k2', 'fp', op)
    await registry.run('a', 'k3', 'fp', op) // evicts k1
    expect(await registry.run('a', 'k3', 'fp', op)).toBe(3)
    expect(await registry.run('a', 'k1', 'fp', op)).toBe(4) // k1 ran again
    expect(registry.size).toBeLessThanOrEqual(2)
  })
})
