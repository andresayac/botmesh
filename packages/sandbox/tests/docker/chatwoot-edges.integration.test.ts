/**
 * Chatwoot (real server in Docker) + @botmesh/chatwoot: identity and failure paths that
 * a fake cannot prove — the exact contact lookup when Chatwoot's search paginates, a lost
 * mapping, an agent deleting the contact, and an agent reply the channel refuses.
 *
 * Same setup and variables as `chatwoot.integration.test.ts`.
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RecipientUnreachableError } from '@botmesh/core'
import { createTestBot, type TestBot } from '@botmesh/core/testing'
import { chatwootPlugin, memoryKeyValue, type ChatwootPlugin } from '@botmesh/chatwoot'

const BASE = process.env.BOTWA_TEST_CHATWOOT_URL
const TOKEN = process.env.BOTWA_TEST_CHATWOOT_TOKEN ?? ''
const ACCOUNT = process.env.BOTWA_TEST_CHATWOOT_ACCOUNT_ID ?? '1'
const DOCKER_HOST = process.env.BOTWA_TEST_DOCKER_HOST ?? 'host.docker.internal'
const T = 120_000

async function cw<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api/v1/accounts/${ACCOUNT}${path}`, {
    method, headers: { api_access_token: TOKEN, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) throw new Error(`Chatwoot ${method} ${path}: HTTP ${res.status} ${await res.text()}`)
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

interface MessageRow { id: number; content: string; message_type: number; status: string; content_attributes?: { external_error?: string } }
const incoming = async (conv: number) =>
  (await cw<{ payload: MessageRow[] }>('GET', `/conversations/${conv}/messages`)).payload.filter((m) => m.message_type === 0).map((m) => m.content)

describe.skipIf(!BASE)('Chatwoot (Docker) + chatwootPlugin: identity and failure paths', () => {
  const run = randomUUID().slice(0, 8)
  const webhookToken = `cw-${randomUUID()}`
  let server: Server
  let inboxId = 0
  let webhookId = 0
  const bots: TestBot[] = []
  const contactIds: number[] = []
  let current: ChatwootPlugin | undefined
  const errors: Array<[string, string]> = []

  const make = async () => {
    const t = await createTestBot()
    const plugin = chatwootPlugin({
      baseUrl: BASE!, apiKey: TOKEN, accountId: ACCOUNT, inboxId, webhookToken, storage: memoryKeyValue(),
      http: { allowHttp: true, allowPrivateHosts: true },
      onError: (error, context) => errors.push([context, String(error)]),
    })
    t.bot.plug(plugin)
    bots.push(t)
    current = plugin
    return { t, plugin }
  }

  beforeAll(async () => {
    inboxId = (await cw<{ id: number }>('POST', '/inboxes', { name: `botmesh-it-edges-${run}`, channel: { type: 'api' } })).id
    server = createServer((req, res) => {
      if (!current) { res.statusCode = 503; res.end(); return }
      current.webhookHandler()(req, res)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const hook = await cw<{ payload?: { webhook?: { id: number } }; id?: number }>('POST', '/webhooks', {
      webhook: { url: `http://${DOCKER_HOST}:${port}/?token=${encodeURIComponent(webhookToken)}`, subscriptions: ['message_created', 'conversation_status_changed'] },
    })
    webhookId = hook.payload?.webhook?.id ?? hook.id ?? 0
  }, T)

  afterAll(async () => {
    if (webhookId) await cw('DELETE', `/webhooks/${webhookId}`).catch(() => undefined)
    for (const id of contactIds) await cw('DELETE', `/contacts/${id}`).catch(() => undefined)
    if (inboxId) await cw('DELETE', `/inboxes/${inboxId}`).catch(() => undefined)
    for (const t of bots) await t.bot.stop()
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  }, T)

  it('finds the exact contact when more than a page of contacts contain its id', async () => {
    // /contacts/search is a substring match, 15 per page, in no particular order (in
    // practice the table order): a contact created after 15 others containing its id is
    // not on page 1.
    const target = `p${run}`
    for (let i = 0; i < 17; i++) {
      const c = await cw<{ payload: { contact: { id: number } } }>('POST', '/contacts', { inbox_id: inboxId, name: `n${i}`, identifier: `${target}${i}` })
      contactIds.push(c.payload.contact.id)
    }
    const made = await cw<{ payload: { contact: { id: number } } }>('POST', '/contacts', { inbox_id: inboxId, name: 'target', identifier: target })
    contactIds.push(made.payload.contact.id)
    const { t, plugin } = await make()
    await t.dm(target).send('hola exacto')
    await plugin.flush()
    expect(errors).toEqual([])
    const conv = await plugin.conversationOf(target)
    expect(conv).toBeGreaterThan(0)
    const detail = await cw<{ meta: { sender: { id: number } } }>('GET', `/conversations/${conv}`)
    expect(detail.meta.sender.id).toBe(made.payload.contact.id)
  }, T)

  it('a lost mapping re-links to the same contact inbox and conversation', async () => {
    const chatId = `lost-${run}@c.us`
    const first = await make()
    await first.t.dm(chatId).send('uno')
    await first.plugin.flush()
    const conv = (await first.plugin.conversationOf(chatId))!
    await first.t.bot.stop()
    const second = await make()
    await second.t.dm(chatId).send('dos')
    await second.plugin.flush()
    expect(errors).toEqual([])
    expect(await second.plugin.conversationOf(chatId)).toBe(conv)
    const contacts = await cw<{ payload: Array<{ id: number; contact_inboxes: unknown[] }> }>('POST', '/contacts/filter', {
      payload: [{ attribute_key: 'identifier', filter_operator: 'equal_to', values: [chatId], query_operator: null }],
    })
    contactIds.push(contacts.payload[0]!.id)
    expect(contacts.payload[0]!.contact_inboxes).toHaveLength(1)
    expect(await incoming(conv)).toEqual(['uno', 'dos'])
  }, T)

  it('the first message after an agent deletes the contact is not lost', async () => {
    const chatId = `deleted-${run}@c.us`
    const { t, plugin } = await make()
    await t.dm(chatId).send('antes')
    await plugin.flush()
    const old = (await plugin.conversationOf(chatId))!
    const detail = await cw<{ meta: { sender: { id: number } } }>('GET', `/conversations/${old}`)
    await cw('DELETE', `/contacts/${detail.meta.sender.id}`)
    await t.dm(chatId).send('después 🎉')
    await plugin.flush()
    expect(errors).toEqual([])
    const fresh = (await plugin.conversationOf(chatId))!
    expect(fresh).not.toBe(old)
    expect(await incoming(fresh)).toEqual(['después 🎉'])
  }, T)

  it('an agent reply that cannot be delivered shows as failed in Chatwoot', async () => {
    const chatId = `fail-${run}@c.us`
    const { t, plugin } = await make()
    await t.dm(chatId).send('hola')
    await plugin.flush()
    const conv = (await plugin.conversationOf(chatId))!
    const send = t.provider.send.bind(t.provider)
    t.provider.send = (async (...args: Parameters<typeof send>) => {
      if (args[1].kind === 'text' && args[1].text.startsWith('no llega')) throw new RecipientUnreachableError(args[0])
      return send(...args)
    }) as typeof t.provider.send
    const sent = await cw<{ id: number }>('POST', `/conversations/${conv}/messages`, { content: `no llega ${run}`, message_type: 'outgoing', private: false })
    await expect.poll(async () => {
      const m = (await cw<{ payload: MessageRow[] }>('GET', `/conversations/${conv}/messages`)).payload.find((x) => x.id === sent.id)
      return [m?.status, m?.content_attributes?.external_error]
    }, { timeout: 30_000, interval: 300 }).toEqual(['failed', 'RecipientUnreachableError'])
    errors.length = 0
  }, T)
})
