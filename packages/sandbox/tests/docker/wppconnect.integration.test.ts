/**
 * WPPConnect Server (real server in Docker) + WPPConnectProvider: token
 * generation from the secret key, session start with a webhook whose token
 * travels in the URL query (wppconnect-server cannot send custom headers), the
 * QR reaching the bot through @botmesh/server, and typed errors. Scanning the
 * QR with a phone stays manual.
 *
 *   docker compose -f packages/sandbox/docker/compose.yml up -d wppconnect
 *   BOTWA_TEST_WPPCONNECT_URL=http://127.0.0.1:47812 BOTWA_TEST_WPPCONNECT_SECRET=sandbox-wppconnect-secret \
 *     pnpm --filter @botmesh/sandbox exec vitest run tests/docker
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ProviderError, type ConnectionUpdate } from '@botmesh/core'
import { WPPConnectProvider } from '@botmesh/wppconnect'
import pino from 'pino'
import { serveWebhooks, type BotIngress } from '../../src/index.js'

const BASE = process.env.BOTWA_TEST_WPPCONNECT_URL
const SECRET = process.env.BOTWA_TEST_WPPCONNECT_SECRET ?? ''
const DOCKER_HOST = process.env.BOTWA_TEST_DOCKER_HOST ?? 'host.docker.internal'
/** wppconnect-server only calls allow-listed webhook URLs (WEBHOOK_ALLOWED_URLS): fixed port and token. */
const WEBHOOK_PORT = Number(process.env.BOTWA_TEST_WPPCONNECT_WEBHOOK_PORT ?? 47830)
const WEBHOOK_TOKEN = process.env.BOTWA_TEST_WPPCONNECT_WEBHOOK_TOKEN ?? 'sandbox-wppconnect-webhook-token'
const T = 120_000

describe.skipIf(!BASE)('WPPConnect Server (Docker) + WPPConnectProvider', () => {
  const session = `botmesh${randomUUID().slice(0, 8)}`
  const token = WEBHOOK_TOKEN
  let ingress: BotIngress
  let provider: WPPConnectProvider
  const updates: ConnectionUpdate[] = []
  const statuses: number[] = []

  beforeAll(async () => {
    const holder: { p?: WPPConnectProvider } = {}
    ingress = await serveWebhooks([{
      path: '/webhook/wppconnect',
      provider: { ingest: async (raw, headers, url) => { const s = await holder.p!.ingest(raw, headers, url); statuses.push(s); return s } },
    }], { port: WEBHOOK_PORT })
    provider = new WPPConnectProvider({
      baseUrl: BASE!, session, secretKey: SECRET, webhookToken: token,
      webhookUrl: `http://${DOCKER_HOST}:${ingress.port}/webhook/wppconnect?token=${encodeURIComponent(token)}`,
      http: { allowHttp: true, allowPrivateHosts: true }, logger: pino({ level: 'silent' }),
    })
    holder.p = provider
    provider.onEvent((e) => { if (e.kind === 'connection') updates.push(e.update) })
  }, T)

  afterAll(async () => {
    // Close the browser session the test started (best effort).
    const auth = await fetch(`${BASE}/api/${session}/${SECRET}/generate-token`, { method: 'POST' }).then((r) => r.json() as Promise<{ token?: string }>).catch(() => ({ token: undefined }))
    if (auth.token) await fetch(`${BASE}/api/${session}/close-session`, { method: 'POST', headers: { authorization: `Bearer ${auth.token}` } }).catch(() => undefined)
    await ingress?.close()
  }, T)

  it('generates a token, starts the session and reports the pairing QR', async () => {
    await provider.start()
    await expect.poll(() => updates.some((u) => u.state === 'authenticating' && !!u.authPayload), { timeout: 90_000, interval: 500 }).toBe(true)
    // An unpaired session also sends status-find "inChat" (before "notLogged"): never a false ready.
    expect(updates.some((u) => u.state === 'ready')).toBe(false)
  }, T)

  it('the session webhooks reach the bot with the token in the query string', async () => {
    await expect.poll(() => statuses.length, { timeout: 60_000, interval: 500 }).toBeGreaterThan(0)
    expect(statuses.every((s) => s === 200)).toBe(true)
    const forged = await fetch(`${ingress.url}/webhook/wppconnect?token=wrong`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'onmessage', session }) })
    expect(forged.status).toBe(401)
  }, T)

  it('sending through an unpaired session rejects with a typed ProviderError', async () => {
    const err = await provider.send('573001112233@c.us', { kind: 'text', text: 'hola' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as Error).message).toMatch(/session is not connected/)
  }, T)

  it('a wrong secret key fails start() as an invalid session', async () => {
    const wrong = new WPPConnectProvider({ baseUrl: BASE!, session: `${session}x`, secretKey: 'wrong-secret', webhookToken: token, http: { allowHttp: true, allowPrivateHosts: true }, logger: pino({ level: 'silent' }) })
    const seen: ConnectionUpdate[] = []
    wrong.onEvent((e) => { if (e.kind === 'connection') seen.push(e.update) })
    await expect(wrong.start()).rejects.toBeInstanceOf(ProviderError)
    expect(seen.at(-1)).toMatchObject({ state: 'closed', reason: 'sessionInvalid' })
  }, T)
})
