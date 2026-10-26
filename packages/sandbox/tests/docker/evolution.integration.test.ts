/**
 * Evolution API (real server in Docker) + EvolutionProvider. Everything that
 * works without a phone: health, instance creation with a signed webhook, the
 * QR/connection webhooks reaching the bot through @botmesh/server, the
 * provider's start() surfacing the QR, typed errors for an unpaired instance
 * and for a wrong API key. Pairing a number (scanning the QR) stays manual.
 *
 *   docker compose -f packages/sandbox/docker/compose.yml up -d evolution
 *   BOTWA_TEST_EVOLUTION_URL=http://127.0.0.1:47811 BOTWA_TEST_EVOLUTION_KEY=sandbox-evolution-key \
 *     pnpm --filter @botmesh/sandbox exec vitest run tests/docker
 *
 * BOTWA_TEST_DOCKER_HOST is how the container reaches this machine
 * (default host.docker.internal).
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ProviderError, type ConnectionUpdate } from '@botmesh/core'
import { EvolutionProvider } from '@botmesh/evolution'
import pino from 'pino'
import { serveWebhooks, type BotIngress } from '../../src/index.js'

const BASE = process.env.BOTWA_TEST_EVOLUTION_URL
const KEY = process.env.BOTWA_TEST_EVOLUTION_KEY ?? ''
const DOCKER_HOST = process.env.BOTWA_TEST_DOCKER_HOST ?? 'host.docker.internal'
const T = 60_000

async function evo(method: string, path: string, body?: unknown, key = KEY): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${BASE}${path}`, { method, headers: { apikey: key, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  return { status: res.status, json: await res.json().catch(() => undefined) }
}

describe.skipIf(!BASE)('Evolution API (Docker) + EvolutionProvider', () => {
  const instance = `botmesh-it-${randomUUID().slice(0, 8)}`
  const secret = `whsec-${randomUUID()}`
  let ingress: BotIngress
  let provider: EvolutionProvider
  const updates: ConnectionUpdate[] = []
  const statuses: number[] = []

  beforeAll(async () => {
    provider = new EvolutionProvider({
      baseUrl: BASE!, apiKey: KEY, instance, webhookSecret: secret,
      http: { allowHttp: true, allowPrivateHosts: true }, logger: pino({ level: 'silent' }),
    })
    provider.onEvent((e) => { if (e.kind === 'connection') updates.push(e.update) })
    const counting = { ingest: (raw: unknown, headers?: Record<string, string | string[] | undefined>) => { const s = provider.ingest(raw, headers); statuses.push(s); return s } }
    ingress = await serveWebhooks([{ path: '/webhook/evolution', provider: counting }])
  }, T)

  afterAll(async () => {
    await evo('DELETE', `/instance/logout/${instance}`).catch(() => undefined)
    await evo('DELETE', `/instance/delete/${instance}`).catch(() => undefined)
    await ingress?.close()
  })

  it('answers the health check with its version', async () => {
    const res = await fetch(`${BASE}/`)
    const body = await res.json() as { status?: number; version?: string }
    expect(res.status).toBe(200)
    expect(body.version).toMatch(/^2\./)
  })

  it('creates an instance with a webhook that carries the shared secret header', async () => {
    const webhookUrl = `http://${DOCKER_HOST}:${ingress.port}/webhook/evolution`
    const created = await evo('POST', '/instance/create', {
      instanceName: instance, integration: 'WHATSAPP-BAILEYS', qrcode: true,
      webhook: { url: webhookUrl, byEvents: false, base64: false, headers: { 'x-webhook-secret': secret }, events: ['QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'SEND_MESSAGE'] },
    })
    expect(created.status).toBeLessThan(300)
    const found = await evo('GET', `/webhook/find/${instance}`)
    expect((found.json as { url?: string }).url).toBe(webhookUrl)
  }, T)

  it('start() reports the pairing QR (authenticating) and the QR webhook reaches the bot, authenticated', async () => {
    await provider.start()
    await expect.poll(() => updates.some((u) => u.state === 'authenticating' && typeof u.authPayload === 'string'), { timeout: 30_000 }).toBe(true)
    // Evolution pushes qrcode.updated / connection.update through the webhook: all accepted.
    await expect.poll(() => statuses.length, { timeout: 30_000 }).toBeGreaterThan(0)
    expect(statuses.every((s) => s === 200)).toBe(true)
  }, T)

  it('sending through an unpaired instance rejects with a typed ProviderError', async () => {
    const err = await provider.send('573001112233@s.whatsapp.net', { kind: 'text', text: 'hola' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
  }, T)

  it('a wrong API key fails start() as an invalid session', async () => {
    const wrong = new EvolutionProvider({ baseUrl: BASE!, apiKey: 'wrong-key', instance, webhookSecret: secret, http: { allowHttp: true, allowPrivateHosts: true }, logger: pino({ level: 'silent' }) })
    const seen: ConnectionUpdate[] = []
    wrong.onEvent((e) => { if (e.kind === 'connection') seen.push(e.update) })
    await expect(wrong.start()).rejects.toBeInstanceOf(ProviderError)
    expect(seen.at(-1)).toMatchObject({ state: 'closed', reason: 'sessionInvalid' })
  }, T)

  it("a webhook with Evolution's jwt_key reaches a provider configured with webhookJwtKey (HS256 accepted)", async () => {
    const jwtInstance = `botmesh-it-jwt-${randomUUID().slice(0, 8)}`
    const jwtKey = `jwt-${randomUUID()}`
    const jwtProvider = new EvolutionProvider({
      baseUrl: BASE!, apiKey: KEY, instance: jwtInstance, webhookJwtKey: jwtKey,
      http: { allowHttp: true, allowPrivateHosts: true }, logger: pino({ level: 'silent' }),
    })
    const seen: ConnectionUpdate[] = []
    const codes: number[] = []
    jwtProvider.onEvent((e) => { if (e.kind === 'connection') seen.push(e.update) })
    const jwtIngress = await serveWebhooks([{ path: '/webhook/evolution-jwt', provider: { ingest: (raw: unknown, headers?: Record<string, string | string[] | undefined>) => { const s = jwtProvider.ingest(raw, headers); codes.push(s); return s } } }])
    try {
      const created = await evo('POST', '/instance/create', {
        instanceName: jwtInstance, integration: 'WHATSAPP-BAILEYS', qrcode: true,
        webhook: { url: `http://${DOCKER_HOST}:${jwtIngress.port}/webhook/evolution-jwt`, byEvents: false, base64: false, headers: { jwt_key: jwtKey }, events: ['QRCODE_UPDATED', 'CONNECTION_UPDATE'] },
      })
      expect(created.status).toBeLessThan(300)
      await expect.poll(() => seen.some((u) => u.state === 'authenticating'), { timeout: 30_000 }).toBe(true)
      expect(codes.length).toBeGreaterThan(0)
      expect(codes.every((c) => c === 200)).toBe(true)
    } finally {
      await evo('DELETE', `/instance/logout/${jwtInstance}`).catch(() => undefined)
      await evo('DELETE', `/instance/delete/${jwtInstance}`).catch(() => undefined)
      await jwtIngress.close()
    }
  }, T)

  it('an instance without a WhatsApp session rejects sends with an actionable "not connected" error', async () => {
    const idle = `botmesh-it-idle-${randomUUID().slice(0, 8)}`
    expect((await evo('POST', '/instance/create', { instanceName: idle, integration: 'WHATSAPP-BAILEYS', qrcode: false })).status).toBeLessThan(300)
    try {
      const p = new EvolutionProvider({ baseUrl: BASE!, apiKey: KEY, instance: idle, webhookSecret: secret, http: { allowHttp: true, allowPrivateHosts: true, timeoutMs: 15_000 }, logger: pino({ level: 'silent' }) })
      const err = await p.send('573001112233@s.whatsapp.net', { kind: 'location', lat: 4.6, lng: -74.1 }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ProviderError)
      expect((err as Error).message).toMatch(/not connected to WhatsApp/)
    } finally {
      await evo('DELETE', `/instance/delete/${idle}`).catch(() => undefined)
    }
  }, T)

  it('an unknown instance fails start() with "Instance or resource not found" as an invalid session', async () => {
    const ghost = new EvolutionProvider({ baseUrl: BASE!, apiKey: KEY, instance: `botmesh-it-missing-${randomUUID().slice(0, 8)}`, webhookSecret: secret, http: { allowHttp: true, allowPrivateHosts: true }, logger: pino({ level: 'silent' }) })
    const seen: ConnectionUpdate[] = []
    ghost.onEvent((e) => { if (e.kind === 'connection') seen.push(e.update) })
    await expect(ghost.start()).rejects.toThrow(/Instance or resource not found/)
    expect(seen.at(-1)).toMatchObject({ state: 'closed', reason: 'sessionInvalid' })
  }, T)

  it('rejects a forged webhook (wrong secret) with 401', async () => {
    const res = await fetch(`${ingress.url}/webhook/evolution`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': 'nope' }, body: JSON.stringify({ event: 'messages.upsert', instance, data: {} }) })
    expect(res.status).toBe(401)
  })
})
