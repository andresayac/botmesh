# @botmesh/chatwoot

[Chatwoot](https://www.chatwoot.com) integration for [`@botmesh/core`](https://www.npmjs.com/package/@botmesh/core): it mirrors the bot's chats into a Chatwoot inbox and lets Chatwoot agents take over through the core's human handoff (`ctx.handoff()`, `bot.resume()`, `bot.send()` and the `'handoff'`/`'resume'` events).

- **Two-way sync:** every inbound message (also during handoff) is posted as `incoming` in Chatwoot and every bot send as `outgoing`.
- **Chat ↔ contact/conversation mapping** persisted in the bot store (cursor API, namespaced per bot): it survives restarts.
- **Agent webhook → `bot.send`**, authenticated with a shared token and/or HMAC-SHA256 over the raw body.
- **Auto-handoff** when an agent replies, and **`bot.resume()`** when the conversation is resolved.
- **Labels** on handoff/resume, per message (`labels.message`) or by hand (`addLabels`/`removeLabels`).
- All outbound HTTP goes through the `secureFetch` of [`@botmesh/http`](https://www.npmjs.com/package/@botmesh/http) (HTTPS, anti-SSRF, timeouts, no redirect following).

Tested end to end against a self-hosted Chatwoot 4.7 (Docker): user and bot messages appear in a conversation, an agent reply comes back through Chatwoot's own webhook and hands the chat off, and resolving the conversation resumes the bot. The same suite covers the failure paths: a contact hidden by search pagination, a lost mapping, a contact deleted by an agent and an agent reply the channel refuses (`packages/sandbox/tests/docker/chatwoot*.integration.test.ts`).

## Install

```bash
pnpm add @botmesh/core @botmesh/chatwoot
```

> **Prerelease.** Until the stable release, npm's `latest` tag can still point to an older build. Add the prerelease dist-tag to get the build these docs describe: `pnpm add @botmesh/core@beta @botmesh/chatwoot@beta` during the beta (`npm view @botmesh/chatwoot dist-tags` lists the tags). Once stable, the plain command above works.

In Chatwoot you need an **API channel** inbox (Settings → Inboxes → Add inbox → API), the access token of a user or agent (Profile settings → Access token) and your account id (in the dashboard URL).

## Quick start

```ts
import { createServer } from 'node:http'
import { Bot } from '@botmesh/core'
import { chatwootPlugin } from '@botmesh/chatwoot'

const bot = new Bot({ provider, handoff: { allowCommands: ['/bot'] } })

const chatwoot = chatwootPlugin({
  baseUrl: 'https://app.chatwoot.com',
  apiKey: process.env.CHATWOOT_TOKEN!,      // access token of a user/agent
  accountId: 1,
  inboxId: 2,                               // inbox of type "API"
  webhookToken: process.env.CHATWOOT_WEBHOOK_TOKEN!,
  labels: { handoff: ['human'], resume: ['bot'] },
})
bot.plug(chatwoot)

bot.when('talk to a human', async (ctx) => {
  await ctx.handoff({ reason: 'the user asked for an agent' })
  await ctx.reply('Connecting you to an agent…')
})

// In Chatwoot: Settings → Integrations → Webhooks →
//   https://bot.example.com/chatwoot?token=<CHATWOOT_WEBHOOK_TOKEN>
//   events: message_created, conversation_status_changed
createServer(chatwoot.webhookHandler()).listen(3001)
await bot.start()
```

Using Express or Fastify? Pass the **raw** body:

```ts
app.post('/chatwoot', express.raw({ type: '*/*' }), async (req, res) => {
  const r = await chatwoot.handleWebhook({ rawBody: req.body, headers: req.headers, query: req.query })
  res.status(r.status).send(r.body)
})
```

## How it works

| Event | What the plugin does |
| --- | --- |
| Inbound message | `incoming` in the chat's conversation (created on first use). In groups, the text is prefixed with the participant's name. |
| The bot sends | `outgoing` (media is mirrored as `[image] caption`, etc.). |
| `ctx.handoff()` / `bot.handoff()` | `open` conversation, private note (`handoffNote`) and `labels.handoff`. |
| Public reply from an agent (`message_created` webhook) | `bot.handoff()` if `autoHandoff` and the chat is not already handed off; then `bot.send()` (attachments by URL). It is not mirrored back into Chatwoot, and a re-delivery of the same message (same id) is ignored. If the channel refuses it (e.g. `OutsideSessionWindowError` on the Cloud API), the message is marked **failed** in Chatwoot with the error name. |
| Conversation resolved (`conversation_status_changed` webhook, or `conversation_updated` only when `changed_attributes` carries the `status` change) | `bot.resume(chatId, { reason: 'chatwoot:resolved' })`. |
| `bot.resume()` for another reason | `resolved` conversation (`resolveOnResume`), removes `labels.handoff`, adds `labels.resume`. |

Ignored: private notes, `incoming` messages, *agent bot* messages, other inboxes, unknown conversations and echoes of the messages the plugin itself created.

Contacts are matched by exact `identifier` (the chat id) through Chatwoot's contacts filter API. If the mapping is lost (new store, restart on `MemoryStore`), the chat keeps its contact and its newest conversation in the inbox. One plugin instance serves one bot: plugging it into a second bot throws.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `baseUrl`, `apiKey`, `accountId`, `inboxId` | — | Chatwoot connection (required; the constructor throws when one is missing or invalid). |
| `webhookToken` / `webhookSecret` | — | At least one (or `insecureNoWebhookAuth: true`). Token in `?token=`, `x-chatwoot-token` or `Authorization: Bearer` (Chatwoot itself does not sign account webhooks, checked on 4.7: put the token in the URL). HMAC, for a sender or proxy that signs, in `x-chatwoot-signature` (hex, accepts `sha256=`), over `${timestamp}.${body}` with `x-chatwoot-timestamp` within `webhookToleranceSec`. A signature over the bare body is replayable, so it is rejected unless `webhookAllowUntimedSignature: true`. |
| `webhookToleranceSec` | `300` | Allowed clock skew of the signed timestamp. |
| `webhookAllowUntimedSignature` | `false` | Also accept a signature without `x-chatwoot-timestamp`. It never expires, so a captured request can be replayed. |
| `insecureNoWebhookAuth` | `false` | Accept unauthenticated webhooks. Only for an endpoint that is not reachable from outside. |
| `autoHandoff` | `true` | Pause the bot when an agent replies. |
| `resumeOnResolve` | `true` | Resume the bot when the conversation is resolved. |
| `resolveOnResume` | `true` | Resolve the conversation when the bot resumes another way. |
| `handoffNote` | `'🤖 → 👤 Handoff: {{reason}}'` | Private note on handoff; `false` disables it. |
| `syncInbound` / `syncOutbound` | `true` | Mirror inbound messages / bot sends. |
| `syncMode` | `'all'` | `'handoff'` mirrors only chats that are handed off. |
| `labels` | — | `{ handoff?, resume?, message?(ctx) }`. |
| `contact(chatId, ctx)` | — | New contact data (`name`, `phoneNumber`, `email`, `customAttributes`). The core does not derive phone numbers from the id. |
| `forwardAttachments` | `true` | Forward agent attachments as media by URL. |
| `http` | — | `{ fetch, resolver, allowHttp, allowPrivateHosts, timeoutMs }` (a self-hosted Chatwoot on a LAN needs `allowPrivateHosts`; an `http://` `baseUrl` without `allowHttp` throws at construction). |
| `storage` | bot store | String `{ get, set }` for the mapping (`memoryKeyValue()` and `storeKeyValue(store)` are exported). |
| `onError(error, context)` | `warn` log | Sync errors; they never break the bot. |

## API

`chatwootPlugin()` returns the plugin with these methods (also available as `ctx.tools.chatwoot`):

- `handleWebhook({ rawBody, headers, query })` → `{ status, body }` (`query` is a `URLSearchParams` or a parsed object such as Express `req.query`; 401 without auth, 400 invalid JSON, 503 if it is not installed yet). Never throws.
- `webhookHandler({ maxBytes })` → `node:http` handler (`POST` only, 1 MiB limit by default).
- `conversationOf(chatId)`, `chatOf(conversationId)`.
- `addLabels(chatId, labels)`, `removeLabels(chatId, labels)`.
- `flush()` — waits for pending sync to finish (tests, graceful shutdown).
- `client` — `ChatwootClient` (contacts, conversations, messages, message status, labels); API failures reject with `ChatwootApiError` (`status`; its message and `path` leave out the query string, so no chat id ends up in logs).

## Limitations

- Inbound media is mirrored as text (`[image] caption`); it is not uploaded as an attachment.
- One chat ↔ one conversation; if the mapped conversation is gone (404, or 422 while Chatwoot is still deleting a contact), a new one is created.
- Resolving the conversation in Chatwoot **resumes the bot** (`bot.resume()`), but **does not close any ticket**: the plugin does not know about [`@botmesh/tickets`](https://www.npmjs.com/package/@botmesh/tickets) (or any other ticketing system). If you use both, close it yourself in the `'resume'` event:

  ```ts
  bot.on('resume', async ({ chatId, reason }) => {
    if (reason !== 'chatwoot:resolved') return
    const tickets = bot.injectTools.tickets
    for (const t of (await tickets?.list({ chatId, status: ['open', 'assigned', 'pending'] })) ?? []) {
      await tickets!.close(t.id, { reason: 'chatwoot:resolved' })
    }
  })
  ```

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Webhook requests answered `401` | The token or signature does not match: check `?token=` in the webhook URL registered in Chatwoot, or the HMAC secret and the server clock (`webhookToleranceSec`). |
| Webhook requests answered `503` | The plugin is not plugged into a bot yet (call `bot.plug(chatwoot)` before serving the webhook). |
| Nothing appears in Chatwoot | `inboxId` is not an **API** inbox of `accountId`, or the token lacks access to it; sync errors go to `onError` (a `ChatwootApiError` with its `status`). |
| `SecureHttpError` (blocked URL) for a self-hosted Chatwoot | `secureFetch` refuses plain `http` and private addresses by default: pass `http: { allowHttp: true, allowPrivateHosts: true }` for a LAN install. |
| `handleWebhook` answers `500` and logs "rawBody must be the raw request body" | A body parser (e.g. `express.json()`) consumed the body: use `express.raw({ type: '*/*' })` on that route. |
| `already plugged into a bot` | One `chatwootPlugin()` per bot. |
| An agent message shows as failed in Chatwoot | The channel refused it; the error name is on the message (`OutsideSessionWindowError`: the 24 h window is closed, send a template from the bot). |
| Agent replies do not reach the user | The webhook is not subscribed to `message_created`, the reply was a private note, or it came from another inbox. |
| The bot does not resume after resolving | Subscribe the webhook to `conversation_status_changed`, and keep `resumeOnResolve: true`. |

## Links

- [Integrations guide (Chatwoot)](https://andresayac.github.io/botmesh/guide/integrations#chatwoot) · [Human handoff](https://andresayac.github.io/botmesh/guide/handoff) · [Security](https://andresayac.github.io/botmesh/guide/security)
- [Changelog](https://github.com/andresayac/botmesh/blob/main/packages/chatwoot/CHANGELOG.md) · [Source](https://github.com/andresayac/botmesh/tree/main/packages/chatwoot) · [Issues](https://github.com/andresayac/botmesh/issues)
