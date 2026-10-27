# @botmesh/dialogflow

**Dialogflow ES and CX** intent detection for [`@botmesh/core`](https://www.npmjs.com/package/@botmesh/core). Every inbound text goes through `detectIntent` (REST API), and the detected intent routes to a handler or a flow; Dialogflow parameters land in `c.state`.

- **ES and CX** agents, global or regional, draft or a published environment.
- **Routing:** `whenDialogflowIntent` (or the `routes` option) sends an intent to a handler or a `flow()`; anything unrouted keeps its normal path to your other handlers.
- **Optional auto-reply** with the agent's own texts (`fulfillment`).
- **No Google SDK:** authentication is a service-account JWT signed with `node:crypto` (RS256) and exchanged for an access token; every request goes through the `secureFetch` of [`@botmesh/http`](https://www.npmjs.com/package/@botmesh/http).
- **Privacy:** session ids are SHA-256 hashes of the chat key, so phone numbers and chat ids never reach Google; chats in handoff are never sent.

## Install

```bash
pnpm add @botmesh/core @botmesh/dialogflow
```

> **Beta.** botmesh is in beta: a plain install gets the beta, and `@beta` always resolves to the newest one (`latest` is moved by hand after each publish).

You need a Google Cloud service account with the **Dialogflow API Client** role on the agent's project, and its JSON key. Keep the key out of your code (an environment variable or a secret store).

## Quick start

```ts
import { Bot, flow } from '@botmesh/core'
import { dialogflowPlugin, whenDialogflowIntent } from '@botmesh/dialogflow'

const bot = new Bot({ provider })

bot.plug(dialogflowPlugin({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS!), // service-account JSON
  languageCode: 'en',
  fulfillment: 'unrouted',     // reply with the agent text when the intent has no route
}))

const df = bot.injectTools.dialogflow!

// Handler: receives the normalized result
whenDialogflowIntent(bot, df, 'order.status', (ctx, r) =>
  ctx.reply(`Looking up order ${String(r.parameters.order)}…`))

// Flow: parameters are copied into c.state before the first step
whenDialogflowIntent(bot, df, 'book.table', flow('booking')
  .say((_ctx, c) => `Booking for ${String(c.state.people)} people`)
  .ask('What name is the booking under?', 'name'))

bot.onMessage((ctx) => ctx.reply('Sorry, I did not understand'))   // anything unrouted falls here
await bot.start()
```

You can also declare the routes in the config: `routes: { 'book.table': bookingFlow, greeting: (ctx) => ctx.reply('Hello!') }`.

### Dialogflow CX

```ts
bot.plug(dialogflowPlugin({
  credentials,
  cx: { agentId: 'xxxxxxxx-xxxx-…', location: 'us-central1', environment: 'prod' },
  languageCode: 'en',
}))
```

## How it works

1. A `before('message')` hook (priority `0`; moderation runs before it, at `100`) calls `detectIntent` and stores the result linked to **that** message.
2. `whenDialogflowIntent` registers a `bot.when` predicate that reads that result (without calling Dialogflow again). If the intent matches and meets `minConfidence`, the target runs; otherwise the message continues its normal path (`onMessage`, other matchers…).
3. Not sent to Dialogflow: empty messages, interactions, commands (`/…`, configurable with `commandPrefix`), texts longer than `maxTextLength` (256 characters, the API limit), messages from a user inside an active conversation (`skipActiveConversation`), messages from a chat in handoff (a human is handling it) and anything `filter` discards.
4. If `detectIntent` (or your `filter`) fails, it is logged, `onError` is called and the message still reaches the other handlers. A `401` drops the cached access token and retries once with a fresh one.

While an ES intent still has required parameters to fill, the result has `allRequiredParamsPresent: false` and the agent's prompt in `messages`. A route runs anyway, so check that flag in the handler if the intent relies on Dialogflow's slot filling.

**Sessions:** in groups, one Dialogflow session per participant (`sessionScope: 'participant'`, the default, like conversations) or one shared by the whole group (`'chat'`); a DM is always one session. `sessionKey(ctx)` returns your own key instead. The key becomes a session id with SHA-256 (32 characters).

## Options

`dialogflowPlugin(config)`:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `credentials` | `ServiceAccountCredentials` | — | Service-account JSON (`client_email`, `private_key`, `project_id`…). Accepts literal `\n` in the key. |
| `tokenSource` | `{ getAccessToken(), invalidate?(token) }` | — | Alternative to `credentials` (e.g. workload identity). With `invalidate`, a `401` is retried once with a fresh token. |
| `projectId` | `string` | `credentials.project_id` | Google Cloud project. |
| `languageCode` | `string` | `'en'` | Query language; it must be one of the agent's languages. |
| `languageFor` | `(ctx) => string \| undefined` | — | Per-message language (e.g. `(ctx) => ctx.lang`). |
| `queryParams` | `(ctx) => object \| undefined` | — | Raw per-message `queryParams` (contexts, payload, parameters…). |
| `cx` | `{ agentId, location, environment? }` | — | Use Dialogflow CX. |
| `location` / `environment` | `string` | global / draft | ES only: regional agent or published environment. |
| `minConfidence` | `number` | `0` | Minimum confidence to route, between 0 and 1. |
| `sessionScope` | `'chat' \| 'participant'` | `'participant'` | Session granularity in groups. |
| `sessionKey` | `(ctx) => string` | — | Custom session key. |
| `routes` | `Record<string, handler \| flow>` | — | Routes registered on install. |
| `fulfillment` | `'off' \| 'unrouted' \| 'all'` | `'off'` | Automatic reply with the agent texts (`'all'` also answers fallbacks, so `onMessage` never sees them). |
| `commandPrefix` | `string \| false` | `'/'` | Commands are not sent to Dialogflow. |
| `maxTextLength` | `number` | `256` | Longer texts are not sent to Dialogflow (the API rejects them). |
| `skipActiveConversation` | `boolean` | `true` | Do not query inside a conversation. |
| `filter` | `(ctx) => boolean` | — | `false` = do not query (if it throws, the message is not sent and `onError` is called). |
| `priority` | `number` | `0` | Priority of the `before('message')` hook. |
| `client` | `DialogflowClient` | — | Pre-built client (instead of building it from the config). |
| `onError` | `(error, ctx) => void` | — | `detectIntent` and `filter` errors. |
| `http` | `{ fetch?, resolver?, timeoutMs?, maxBytes? }` | — | `secureFetch` options (useful in tests). |

## Normalized result

```ts
interface DialogflowResult {
  intent: string | null        // displayName; null for CX NO_MATCH
  intentId?: string
  confidence: number
  isFallback: boolean
  parameters: Record<string, unknown>   // without __proto__ / constructor / prototype keys
  allRequiredParamsPresent: boolean
  messages: string[]           // reply texts in order (ES: the default-platform ones when there are any)
  fulfillmentText: string
  action?: string              // ES
  page?: string                // CX
  raw: unknown                 // raw queryResult
}
```

`ctx.tools.dialogflow.resultFor(ctx)` returns the current message's result from any handler. `DialogflowClient` also works on its own: `new DialogflowClient({ credentials }).detectIntent(sessionId, 'hello')`.

## Errors

Invalid credentials (`code: 'INVALID_CREDENTIALS'`) and invalid options (`code: 'INVALID_CONFIG'`: a `minConfidence` outside 0–1, an unknown `fulfillment` or `sessionScope`, an empty `commandPrefix`, a malformed `location`…) throw `DialogflowError` **synchronously** on `bot.plug()`; a route target that is not a handler, a `flow()` builder or a compiled flow throws a `TypeError`. Parameters (in the result and copied into `c.state`) skip `__proto__`, `constructor` and `prototype`. Network and API failures (`status`, and `code` such as `'PERMISSION_DENIED'`) are reported through `onError` without breaking the pipeline.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `DialogflowError` on `bot.plug()` | `INVALID_CREDENTIALS`: the service-account JSON is incomplete, still a string (parse it with `JSON.parse`), or its `private_key` is not a valid PEM key (a key pasted into an env var keeps its `\n`; that is handled). `INVALID_CONFIG`: the message names the option. |
| `detectIntent failed` with `PERMISSION_DENIED` | The service account lacks the Dialogflow API Client role on the agent's project, or `projectId` points to another project. |
| `NOT_FOUND` | Wrong `projectId`, `cx.agentId`, `location` or `environment`. A regional agent needs its `location`. |
| `INVALID_ARGUMENT` about the language | `languageCode` (default `'en'`) is not one of the agent's languages: set it, or use `languageFor`. |
| An intent is detected but its route does not run | Its confidence is under `minConfidence` (a probability: `0.6`, not `60`), the sender is inside a conversation (`skipActiveConversation`), or an earlier handler (a command, a more specific trigger) took the message. |
| Long messages never reach Dialogflow | Texts over `maxTextLength` (256, the API limit) are skipped on purpose. |
| Fallback replies swallow your `onMessage` | `fulfillment: 'all'` answers no-match results too; use `'unrouted'`. |

## Links

- [Integrations guide (Dialogflow)](https://andresayac.github.io/botmesh/guide/integrations#dialogflow) · [Flows](https://andresayac.github.io/botmesh/guide/flows) · [Triggers](https://andresayac.github.io/botmesh/guide/triggers) · [Security](https://andresayac.github.io/botmesh/guide/security)
- [Changelog](https://github.com/andresayac/botmesh/blob/main/packages/dialogflow/CHANGELOG.md) · [Source](https://github.com/andresayac/botmesh/tree/main/packages/dialogflow) · [Issues](https://github.com/andresayac/botmesh/issues)
