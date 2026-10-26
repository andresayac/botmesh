/**
 * Chatwoot (real server in Docker) + @botmesh/chatwoot: a full round trip with
 * no fakes on the Chatwoot side. The test creates an API inbox and an account
 * webhook, then: a user message and the bot's answer appear in a Chatwoot
 * conversation; an agent's reply (posted through Chatwoot's API) comes back
 * through Chatwoot's own webhook and reaches the user via `bot.sendTo`,
 * handing the chat off; resolving the conversation resumes the bot.
 *
 *   docker compose -f packages/sandbox/docker/compose.yml up -d chatwoot chatwoot-sidekiq
 *   docker compose -f packages/sandbox/docker/compose.yml run --rm chatwoot-init   # first time only
 *   node packages/sandbox/docker/chatwoot-token.mjs   # prints the three variables below
 *   BOTWA_TEST_CHATWOOT_URL=… BOTWA_TEST_CHATWOOT_TOKEN=… BOTWA_TEST_CHATWOOT_ACCOUNT_ID=… \
 *     pnpm --filter @botmesh/sandbox exec vitest run tests/docker
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestBot, type TestBot } from '@botmesh/core/testing'
import { chatwootPlugin, type ChatwootApi } from '@botmesh/chatwoot'

const BASE = process.env.BOTWA_TEST_CHATWOOT_URL
const TOKEN = process.env.BOTWA_TEST_CHATWOOT_TOKEN ?? ''
const ACCOUNT = process.env.BOTWA_TEST_CHATWOOT_ACCOUNT_ID ?? '1'
const DOCKER_HOST = process.env.BOTWA_TEST_DOCKER_HOST ?? 'host.docker.internal'
const T = 90_000

async function cw<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api/v1/accounts/${ACCOUNT}${path}`, {
    method, headers: { api_access_token: TOKEN, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) throw new Error(`Chatwoot ${method} ${path}: HTTP ${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

describe.skipIf(!BASE)('Chatwoot (Docker) + chatwootPlugin round trip', () => {
  const run = randomUUID().slice(0, 8)
  const webhookToken = `cw-${randomUUID()}`
  let server: Server
  let t: TestBot
  let plugin: ChatwootApi & ReturnType<typeof chatwootPlugin>
  let inboxId = 0
  let webhookId = 0
  const chatId = `sandbox-${run}@s.whatsapp.net`

  beforeAll(async () => {
    const inbox = await cw<{ id: number }>('POST', '/inboxes', { name: `botmesh-it-${run}`, channel: { type: 'api' } })
    inboxId = inbox.id
    t = await createTestBot()
    plugin = chatwootPlugin({
      baseUrl: BASE!, apiKey: TOKEN, accountId: ACCOUNT, inboxId, webhookToken,
      http: { allowHttp: true, allowPrivateHosts: true },
    }) as typeof plugin
    t.bot.plug(plugin)
    t.bot.when('hola', (ctx) => ctx.reply('¡Hola! Soy el bot.'))
    server = createServer(plugin.webhookHandler())
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const hook = await cw<{ payload?: { webhook?: { id: number } }; id?: number }>('POST', '/webhooks', {
      webhook: { url: `http://${DOCKER_HOST}:${port}/?token=${encodeURIComponent(webhookToken)}`, subscriptions: ['message_created', 'conversation_status_changed'] },
    })
    webhookId = hook.payload?.webhook?.id ?? hook.id ?? 0
  }, T)

  afterAll(async () => {
    if (webhookId) await cw('DELETE', `/webhooks/${webhookId}`).catch(() => undefined)
    if (inboxId) await cw('DELETE', `/inboxes/${inboxId}`).catch(() => undefined)
    await t?.bot.stop()
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  }, T)

  it('mirrors the user message and the bot answer into a Chatwoot conversation', async () => {
    const chat = t.dm(chatId)
    await chat.send('hola')
    await chat.expectReply('¡Hola! Soy el bot.')
    await plugin.flush()
    const conversationId = await plugin.conversationOf(chatId)
    expect(conversationId).toBeGreaterThan(0)
    const messages = await cw<{ payload: Array<{ content: string; message_type: number }> }>('GET', `/conversations/${conversationId}/messages`)
    const contents = messages.payload.map((m) => [m.message_type, m.content])
    expect(contents).toEqual(expect.arrayContaining([[0, 'hola'], [1, '¡Hola! Soy el bot.']]))
  }, T)

  it('an agent reply in Chatwoot reaches the user through the real webhook and hands the chat off', async () => {
    const chat = t.dm(chatId)
    const conversationId = (await plugin.conversationOf(chatId))!
    await cw('POST', `/conversations/${conversationId}/messages`, { content: `Hola, soy Ana (${run})`, message_type: 'outgoing', private: false })
    await chat.expectReply(`Hola, soy Ana (${run})`, 30_000)
    expect(t.bot.isHandedOff(chatId)).toBe(true)
  }, T)

  it('resolving the conversation in Chatwoot resumes the bot', async () => {
    expect(t.bot.isHandedOff(chatId)).toBe(true)
    const conversationId = (await plugin.conversationOf(chatId))!
    await cw('POST', `/conversations/${conversationId}/toggle_status`, { status: 'resolved' })
    await expect.poll(() => t.bot.isHandedOff(chatId), { timeout: 30_000, interval: 250 }).toBe(false)
  }, T)
})
