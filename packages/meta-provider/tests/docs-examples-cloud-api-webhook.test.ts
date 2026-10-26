/**
 * Example "WhatsApp Cloud API webhook server" (docs/examples/cloud-api-webhook.md,
 * docs/es/ejemplos/webhook-cloud-api.md). Runs the page's server.js as written: a real
 * node:http server on a random local port in front of a CloudAPIProvider whose Graph
 * calls go to a fake `fetch` (no request leaves the machine). Checks the handshake,
 * signed and forged webhooks, the size limit, the protected notify route with its
 * 24-hour-window template fallback, and the simulator transcript the page shows.
 */
import { createHmac } from 'node:crypto'
import { createServer, type RequestListener, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Bot } from '@botmesh/core'
import { DevSession } from '@botmesh/core/dev'
import { createDocsProject, extractFile, readPage, simulate, transcriptBlock, type DocsProject } from '../../../test-utils/docs-examples.js'
import { CloudAPIProvider } from '../src/index.js'

const PAGES = [
  {
    page: 'docs/examples/cloud-api-webhook.md',
    lines: ['hi', 'track', 'ABC', '20931', 'thanks'],
    hi: 'hi',
    welcome: '👋 Hi! I am the order desk. Send "track" to follow an order.',
    shipped: '🚚 Order 20931 has shipped!',
    language: 'en',
  },
  {
    page: 'docs/es/ejemplos/webhook-cloud-api.md',
    lines: ['hola', 'pedido', 'ABC', '20931', 'gracias'],
    hi: 'hola',
    welcome: '👋 ¡Hola! Soy el mostrador de pedidos. Envía "pedido" para seguir un pedido.',
    shipped: '🚚 ¡Tu pedido 20931 ya salió!',
    language: 'es',
  },
]

const APP_SECRET = 'app-secret'
const VERIFY_TOKEN = 'verify-me'
const ADMIN_TOKEN = 'admin-token'
const USER = '573001112233'
const realFetch = globalThis.fetch

interface GraphCall { url: string; body: Record<string, unknown> }

/** Fake Graph API: free-form messages to `closed` numbers fail with 131047 (outside the 24 h window). */
function fakeGraph(closed: Set<string>): GraphCall[] {
  const calls: GraphCall[] = []
  let n = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    calls.push({ url: String(url), body })
    const fail = body.type !== 'template' && closed.has(String(body.to))
    const payload = fail ? { error: { code: 131047, message: 'Re-engagement message' } } : { messages: [{ id: `wamid.OUT${++n}` }] }
    return new Response(JSON.stringify(payload), { status: fail ? 400 : 200, headers: { 'content-type': 'application/json' } })
  }))
  return calls
}

function webhookBody(text: string, id: string): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA_ID', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '15550001111', phone_number_id: 'PNID' },
      contacts: [{ profile: { name: 'Ana' }, wa_id: USER }],
      messages: [{ from: USER, id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }],
    } }] }],
  })
}

const sign = (raw: string, secret = APP_SECRET): string => 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex')

const projects: DocsProject[] = []
const servers: Server[] = []
beforeEach(() => vi.unstubAllGlobals())
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const s of servers.splice(0)) await new Promise((r) => s.close(r))
  while (projects.length) await projects.pop()!.remove()
})

interface ServerModule {
  default: (p: unknown) => Promise<Bot> | Bot
  createWebhookHandler: (o: { provider: CloudAPIProvider; bot: Bot; adminToken?: string }) => RequestListener
}

async function load(page: string): Promise<{ project: DocsProject; mod: ServerModule }> {
  const project = await createDocsProject({ 'server.js': extractFile(readPage(page), 'server.js') }, { fromSource: ['@botmesh/meta'] })
  projects.push(project)
  return { project, mod: await project.import<ServerModule>('server.js') }
}

describe.each(PAGES)('$page', ({ page, lines, hi, welcome, shipped, language }) => {
  it('prints the sample transcript in the terminal simulator', async () => {
    const { project } = await load(page)
    const out = await simulate(DevSession, () => project.import('server.js'), lines)
    expect(out).toBe(transcriptBlock(readPage(page)))
  })

  it('serves the handshake, signed webhooks and the notify route as the page describes', async () => {
    const closed = new Set<string>()
    const calls = fakeGraph(closed)
    const { mod } = await load(page)
    const provider = new CloudAPIProvider({ accessToken: 'TOKEN', phoneNumberId: 'PNID', verifyToken: VERIFY_TOKEN, appSecret: APP_SECRET })
    const bot = await mod.default(provider)
    await bot.start()
    const server = createServer(mod.createWebhookHandler({ provider, bot, adminToken: ADMIN_TOKEN }))
    servers.push(server)
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const http = async (path: string, init?: RequestInit) => {
      const res = await realFetch(base + path, init)
      return { status: res.status, body: await res.text() }
    }
    const sent = () => calls.filter((c) => c.url.endsWith('/messages'))
    const until = async (cond: () => boolean) => {
      for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10))
      expect(cond()).toBe(true)
    }

    try {
      expect(await http('/healthz')).toEqual({ status: 200, body: 'ok' })
      expect(await http(`/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1158201444`)).toEqual({ status: 200, body: '1158201444' })
      expect((await http('/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1')).status).toBe(403)

      // A signed webhook is accepted and answered through the Graph API.
      const raw = webhookBody(hi, 'wamid.IN1')
      expect((await http('/webhook', { method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(raw) } })).status).toBe(200)
      await until(() => sent().length === 1)
      expect(sent()[0]!.body).toMatchObject({ to: USER, type: 'text', text: { body: welcome } })

      // Forged or unsigned bodies are refused and never reach the bot.
      const forged = webhookBody(hi, 'wamid.IN2')
      expect((await http('/webhook', { method: 'POST', body: forged, headers: { 'x-hub-signature-256': sign(forged, 'not-the-secret') } })).status).toBe(403)
      expect((await http('/webhook', { method: 'POST', body: forged })).status).toBe(403)
      // A re-serialized body does not match the signature of the original bytes.
      const pretty = JSON.stringify(JSON.parse(raw), null, 2)
      expect((await http('/webhook', { method: 'POST', body: pretty, headers: { 'x-hub-signature-256': sign(raw) } })).status).toBe(403)
      expect((await http('/webhook', { method: 'POST', body: 'x'.repeat(1024 * 1024 + 1) })).status).toBe(413)
      await new Promise((r) => setTimeout(r, 50))
      expect(sent()).toHaveLength(1)

      // The notify route needs the admin token.
      const notify = (token: string, body: unknown) =>
        http('/notify/shipped', { method: 'POST', body: JSON.stringify(body), headers: { authorization: `Bearer ${token}` } })
      expect((await notify('nope', { chatId: USER, order: '20931' })).status).toBe(401)
      expect((await http('/notify/shipped', { method: 'POST', body: '{not json', headers: { authorization: `Bearer ${ADMIN_TOKEN}` } })).status).toBe(400)

      // Inside the 24-hour window: free-form text.
      expect(await notify(ADMIN_TOKEN, { chatId: USER, order: '20931' })).toEqual({ status: 200, body: 'text' })
      expect(sent().at(-1)!.body).toMatchObject({ to: USER, type: 'text', text: { body: shipped } })

      // Outside it (Graph 131047): the approved template instead.
      closed.add(USER)
      expect(await notify(ADMIN_TOKEN, { chatId: USER, order: '20931' })).toEqual({ status: 200, body: 'template' })
      expect(sent().at(-1)!.body).toMatchObject({
        to: USER,
        type: 'template',
        template: { name: 'order_shipped', language: { code: language }, components: [{ type: 'body', parameters: [{ type: 'text', text: '20931' }] }] },
      })
      expect((await http('/elsewhere')).status).toBe(404)
    } finally {
      await bot.stop()
    }
  })
})
