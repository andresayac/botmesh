/**
 * Defects found while testing @botmesh/chatwoot against a self-hosted Chatwoot 4.7 (Docker)
 * before the beta: each case reproduces what the real server did.
 */
import { describe, expect, it, vi } from 'vitest'
import { OutsideSessionWindowError } from '@botmesh/core'
import { createTestBot } from '@botmesh/core/testing'
import { ChatwootApiError, chatwootPlugin, memoryKeyValue, type ChatwootPluginConfig } from '../src/index.js'
import { FakeChatwoot, publicResolver } from './fakeChatwoot.js'

const CHAT = 'user@s.whatsapp.net'

function setup(over: Partial<ChatwootPluginConfig> = {}, fake = new FakeChatwoot()) {
  const plugin = chatwootPlugin({
    baseUrl: 'https://chatwoot.example.com',
    apiKey: 'secret-key',
    accountId: 1,
    inboxId: 2,
    webhookToken: 'hook-token',
    http: { fetch: fake.fetch as typeof globalThis.fetch, resolver: publicResolver },
    ...over,
  })
  return { fake, plugin }
}

const agentReply = (conversationId: number, content: string, id = 9001) => ({
  rawBody: JSON.stringify({
    event: 'message_created', id, content, message_type: 'outgoing', private: false,
    sender: { id: 7, name: 'Ana', type: 'user' }, inbox: { id: 2 }, conversation: { id: conversationId },
  }),
  headers: {},
  query: { token: 'hook-token' },
})

describe('chatwoot — contact lookup by identifier', () => {
  it('finds the exact contact even when more than a page of contacts contain the chat id', async () => {
    // Chatwoot's /contacts/search is a paginated substring match (15 per page, most
    // active first): `12345` also matches `123456`, `912345`… The exact contact fell
    // off page 1, the plugin tried to create it again and Chatwoot answered 422
    // "Identifier has already been taken" for every message of that chat.
    const onError = vi.fn()
    const fake = new FakeChatwoot()
    fake.contacts.push({ id: 5, name: 'Target', identifier: CHAT, source_id: 'src-target' })
    for (let i = 0; i < 20; i++) fake.contacts.push({ id: 10 + i, name: `n${i}`, identifier: `${CHAT}${i}`, source_id: `s${i}`, last_activity_at: 1000 + i })
    const { plugin } = setup({ onError }, fake)
    const { bot, chat } = await createTestBot()
    bot.plug(plugin)
    await chat.send('hola')
    await plugin.flush()
    expect(onError).not.toHaveBeenCalled()
    expect(fake.contacts).toHaveLength(21)
    expect(fake.onlyConversation().contactId).toBe(5)
    await bot.stop()
  })

  it('re-links a lost mapping to the contact\'s existing conversation and contact inbox', async () => {
    // A bot restarted with an empty (or replaced) store used to open a second contact
    // inbox and a second conversation; the agents kept answering in the old one, whose
    // replies then went nowhere.
    const fake = new FakeChatwoot()
    const first = setup({ storage: memoryKeyValue() }, fake)
    let t = await createTestBot()
    t.bot.plug(first.plugin)
    await t.chat.send('uno')
    await first.plugin.flush()
    const conv = fake.onlyConversation().id
    await t.bot.stop()

    const second = setup({ storage: memoryKeyValue() }, fake)
    t = await createTestBot()
    t.bot.plug(second.plugin)
    const before = fake.requests.length
    await t.chat.send('dos')
    await second.plugin.flush()
    const after = fake.requests.slice(before)
    expect(after.some((r) => r.path.endsWith('/contact_inboxes'))).toBe(false)
    expect(fake.onlyConversation().messages.map((m) => m.content)).toEqual(['uno', 'dos'])
    expect(await second.plugin.conversationOf(CHAT)).toBe(conv)
    expect(await second.plugin.chatOf(conv)).toBe(CHAT)
    await t.bot.stop()
  })
})

describe('chatwoot — a conversation being deleted', () => {
  it('re-links when a message is refused with 422 because the conversation is gone', async () => {
    // Right after an agent deletes the contact, Chatwoot answers 422 (not 404) to a new
    // message while it deletes the conversations in the background: the message was lost.
    const onError = vi.fn()
    const { fake, plugin } = setup({ onError })
    const { bot, chat } = await createTestBot()
    bot.plug(plugin)
    await chat.send('uno')
    await plugin.flush()
    const first = fake.onlyConversation()
    fake.deleting.add(first.id)
    fake.deleteContact(first.contactId)
    fake.conversations.set(first.id, first) // still there for messages, 404 for GET
    await chat.send('dos')
    await plugin.flush()
    expect(onError).not.toHaveBeenCalled()
    const fresh = await plugin.conversationOf(CHAT)
    expect(fresh).not.toBe(first.id)
    expect(fake.messagesOf(fresh!).map((m) => m.content)).toEqual(['dos'])
    await bot.stop()
  })

  it('re-links when the probe after the nil-contact 422 answers 500 (real Chatwoot 4.7)', async () => {
    // While the contact is already nil, GET /conversations/:id often fails with 500
    // instead of 404: the first message after the delete was still lost.
    const onError = vi.fn()
    const fake = new FakeChatwoot()
    fake.deletingProbeStatus = 500
    const { plugin } = setup({ onError }, fake)
    const { bot, chat } = await createTestBot()
    bot.plug(plugin)
    await chat.send('uno')
    await plugin.flush()
    const first = fake.onlyConversation()
    fake.deleting.add(first.id)
    fake.deleteContact(first.contactId)
    fake.conversations.set(first.id, first)
    await chat.send('dos')
    await plugin.flush()
    expect(onError).not.toHaveBeenCalled()
    const fresh = await plugin.conversationOf(CHAT)
    expect(fresh).not.toBe(first.id)
    expect(fake.messagesOf(fresh!).map((m) => m.content)).toEqual(['dos'])
    await bot.stop()
  })

  it('does not re-link on a generic 422 when the probe answers 500', async () => {
    const onError = vi.fn()
    const { fake, plugin } = setup({ onError })
    const { bot, chat } = await createTestBot()
    bot.plug(plugin)
    await chat.send('uno')
    await plugin.flush()
    const conv = fake.onlyConversation().id
    fake.failures.push({ match: /POST .*\/messages$/, status: 422, times: 1 })
    fake.failures.push({ match: /GET .*\/conversations\/\d+$/, status: 500, times: 1 })
    await chat.send('dos')
    await plugin.flush()
    expect(onError).toHaveBeenCalledTimes(1)
    expect((onError.mock.calls[0][0] as ChatwootApiError).status).toBe(422)
    expect(fake.onlyConversation().id).toBe(conv)
    await bot.stop()
  })

  it('does not re-link on a 422 for a conversation that still exists (a real validation error)', async () => {
    const onError = vi.fn()
    const { fake, plugin } = setup({ onError })
    const { bot, chat } = await createTestBot()
    bot.plug(plugin)
    await chat.send('uno')
    await plugin.flush()
    const conv = fake.onlyConversation().id
    fake.failures.push({ match: /POST .*\/messages$/, status: 422, times: 1 })
    await chat.send('dos')
    await plugin.flush()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toBeInstanceOf(ChatwootApiError)
    expect(fake.onlyConversation().id).toBe(conv)
    await bot.stop()
  })
})

describe('chatwoot — agent replies that cannot be delivered', () => {
  it('marks the Chatwoot message as failed (error name only) so the agent sees it', async () => {
    const onError = vi.fn()
    const { fake, plugin } = setup({ onError })
    const { bot, chat, provider } = await createTestBot()
    bot.plug(plugin)
    await chat.send('hola')
    await plugin.flush()
    const conv = fake.onlyConversation().id
    const send = provider.send.bind(provider)
    provider.send = (async (...args: Parameters<typeof send>) => {
      if (args[1].kind === 'text' && args[1].text.startsWith('Hola, soy Ana')) throw new OutsideSessionWindowError(args[0], 'outside the 24h window for +573001112233')
      return send(...args)
    }) as typeof provider.send
    const res = await plugin.handleWebhook(agentReply(conv, 'Hola, soy Ana', 4242))
    expect(res.status).toBe(200)
    await plugin.flush()
    expect(fake.patchedStatuses).toEqual([{ conversationId: conv, messageId: 4242, status: 'failed', external_error: 'OutsideSessionWindowError' }])
    expect(onError).toHaveBeenCalled()
    await bot.stop()
  })
})

describe('chatwoot — user mistakes get actionable errors', () => {
  it('one plugin instance cannot be plugged into two bots at once', async () => {
    const { plugin } = setup()
    const a = await createTestBot()
    const b = await createTestBot()
    const unplug = a.bot.plug(plugin)
    expect(() => b.bot.plug(plugin)).toThrow(/already plugged into a bot.*one chatwootPlugin\(\) per bot/i)
    unplug()
    expect(() => b.bot.plug(plugin)).not.toThrow()
    await a.bot.stop()
    await b.bot.stop()
  })

  it('an http:// baseUrl without http.allowHttp fails at construction with the fix', () => {
    expect(() => setup({ baseUrl: 'http://chatwoot.lan:3000' })).toThrow(/http\.allowHttp/)
    expect(() => setup({ baseUrl: 'http://chatwoot.lan:3000', http: { allowHttp: true, fetch: new FakeChatwoot().fetch as typeof globalThis.fetch, resolver: publicResolver } })).not.toThrow()
  })

  it('accountId / inboxId errors say what is expected', () => {
    expect(() => setup({ accountId: 'abc' })).toThrow(/accountId.*number/)
    expect(() => setup({ inboxId: Number.NaN })).toThrow(/inboxId.*number/)
  })

  it('a blocked private host names the http.allowPrivateHosts option', async () => {
    const onError = vi.fn()
    const { bot, chat } = await createTestBot()
    const { plugin } = setup({ baseUrl: 'https://10.0.0.5', onError, http: { fetch: new FakeChatwoot().fetch as typeof globalThis.fetch } })
    bot.plug(plugin)
    await chat.send('hola')
    await plugin.flush()
    expect(String(onError.mock.calls[0][0])).toMatch(/allowPrivateHosts/)
    await bot.stop()
  })

  it('a parsed (non-raw) body is refused with a hint instead of a TypeError', async () => {
    const onError = vi.fn()
    const { bot } = await createTestBot()
    const { plugin } = setup({ onError })
    bot.plug(plugin)
    const res = await plugin.handleWebhook({ rawBody: { event: 'message_created' } as unknown as string, headers: {}, query: { token: 'hook-token' } })
    expect(res.status).toBe(500)
    expect(String(onError.mock.calls[0][0])).toMatch(/raw.*express\.raw/i)
    await bot.stop()
  })
})

describe('chatwoot — no chat ids in error messages', () => {
  it('ChatwootApiError leaves the query string (which carries the chat id) out of message and path', async () => {
    const client = setup().plugin.client
    const fake = new FakeChatwoot()
    fake.failures.push({ match: /GET .*\/contacts\/search$/, status: 500, times: 1 })
    const c = setup({}, fake).plugin.client
    void client
    const err = await c.request('GET', `/contacts/search?q=${encodeURIComponent(CHAT)}`).catch((e: unknown) => e) as ChatwootApiError
    expect(err).toBeInstanceOf(ChatwootApiError)
    expect(err.message).not.toContain('whatsapp')
    expect(err.path).toBe('/contacts/search')
  })
})
