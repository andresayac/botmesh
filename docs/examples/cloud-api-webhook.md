# WhatsApp Cloud API webhook server

Run the official WhatsApp Cloud API in production with nothing but
`node:http`: Meta's verification handshake, signed webhooks checked on the
raw bytes, a size limit, a health check, and proactive messages that fall
back to an approved template outside the 24-hour window.

**Level:** Advanced · **Tags:** WhatsApp, Cloud API, Webhooks, Security, Templates

**Features shown:**
[WhatsApp Cloud API provider](/guide/channels) (`@botmesh/meta`: `ingest`, `verifyChallenge`, `appSecret`) ·
[24-hour window and templates](/guide/session-window) (`OutsideSessionWindowError`, `kind: 'template'`) ·
[Sending outside a handler](/guide/messages) (`bot.send`) ·
[Flows](/guide/flows) (`.ask` with `validate`) ·
[Security](/guide/security) ·
[Graceful shutdown](/guide/deploy#graceful-shutdown) ·
[Terminal simulator](/guide/dev-simulator)

## Prerequisites

- Node.js 22.12 or newer and an ESM project (`"type": "module"`), as in
  [Getting started](/guide/getting-started#requirements). While botmesh is in
  prerelease, read the note there about which npm tag to install.
- A Meta app with the WhatsApp product: an access token, the phone number
  id, the app secret, and a verify token you choose. An approved template
  named `order_shipped` with one body parameter.
- A public HTTPS URL that reaches port 3000 (a reverse proxy, or a tunnel
  while you develop).

```bash
npm install @botmesh/core @botmesh/meta
```

## The complete server

```js
// server.js
import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { Bot, OutsideSessionWindowError, defineBot, flow, isMainModule } from '@botmesh/core'
import { CloudAPIProvider } from '@botmesh/meta'

// 1. The bot: a factory, so `npx botmesh dev server.js` runs it without Meta
const createBot = defineBot((provider) => {
  const bot = new Bot({ provider })
  bot.when(['hi', 'hello'], (ctx) => ctx.reply('👋 Hi! I am the order desk. Send "track" to follow an order.'))
  bot.use(
    flow('track')
      .ask('What is your order number?', 'order', {
        validate: (body) => (/^\d{4,8}$/.test(body.trim()) ? true : '❌ Order numbers have 4 to 8 digits.'),
      })
      .say((_ctx, c) => `📦 Order ${c.state.order.trim()} is being prepared. I will write when it ships.`),
  )
  bot.onMessage((ctx) => ctx.reply('Send "track" to follow an order.'))
  return bot
})

export default createBot

// 2. The raw body bytes, with a size limit: Meta signs these exact bytes
export function readRawBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) reject(Object.assign(new Error('body too large'), { status: 413 }))
      else chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

const sameSecret = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

// 3. Free-form text inside the 24-hour window, an approved template outside it
export async function notifyShipped(bot, chatId, order) {
  try {
    await bot.send(chatId, `🚚 Order ${order} has shipped!`)
    return 'text'
  } catch (err) {
    if (!(err instanceof OutsideSessionWindowError)) throw err
    await bot.send(chatId, {
      kind: 'template',
      name: 'order_shipped',
      language: 'en',
      components: [{ type: 'body', parameters: [{ type: 'text', text: order }] }],
    })
    return 'template'
  }
}

// 4. The HTTP server: Meta's handshake, signed webhooks, an internal notify route and a health check
export function createWebhookHandler({ provider, bot, adminToken }) {
  return async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const reply = (status, body = '') => {
      if (status === 413) res.setHeader('connection', 'close')
      res.writeHead(status, { 'content-type': 'text/plain' }).end(body)
    }
    try {
      if (url.pathname === '/healthz') return reply(200, 'ok')
      if (url.pathname === '/webhook' && req.method === 'GET') {
        // Subscription handshake: echo hub.challenge when hub.verify_token matches
        const challenge = provider.verifyChallenge(Object.fromEntries(url.searchParams))
        return challenge === null ? reply(403) : reply(200, challenge)
      }
      if (url.pathname === '/webhook' && req.method === 'POST') {
        // Raw bytes + headers: ingest() checks X-Hub-Signature-256 and returns the status to answer
        const raw = await readRawBody(req)
        return reply(provider.ingest(raw, req.headers))
      }
      if (url.pathname === '/notify/shipped' && req.method === 'POST') {
        // Called by your backend, never by Meta: protected by a shared token
        if (!adminToken || !sameSecret(req.headers.authorization ?? '', `Bearer ${adminToken}`)) return reply(401)
        const { chatId, order } = JSON.parse((await readRawBody(req, 4096)).toString('utf8'))
        return reply(200, await notifyShipped(bot, chatId, order))
      }
      reply(404)
    } catch (err) {
      reply(err.status ?? (err instanceof SyntaxError ? 400 : 500))
    }
  }
}

// 5. Production entry point: `node server.js` behind HTTPS (a reverse proxy or a tunnel)
if (isMainModule(import.meta)) {
  const env = (name) => {
    const value = process.env[name]?.trim()
    if (!value) throw new Error(`Missing environment variable ${name}`)
    return value
  }
  const provider = new CloudAPIProvider({
    accessToken: env('META_TOKEN'),
    phoneNumberId: env('META_PHONE_ID'),
    verifyToken: env('META_VERIFY_TOKEN'),
    appSecret: env('META_APP_SECRET'),
  })
  const bot = await createBot(provider)
  const server = createServer(createWebhookHandler({ provider, bot, adminToken: env('ADMIN_TOKEN') }))
  await bot.start()
  server.listen(Number(process.env.PORT ?? 3000), () => bot.logger.info('webhook server listening'))
  process.once('SIGTERM', async () => {
    server.close() // stop accepting webhooks; Meta retries what it could not deliver
    await bot.stop({ drain: true, timeout: '10s' })
  })
}
```

## How it works

### 1. The bot is a factory

The conversation lives in `createBot`, which receives its provider. `npx
botmesh dev server.js` imports the factory and injects the terminal
simulator, so you iterate on the replies without Meta, tokens or a public
URL. The Cloud API wiring only runs under `isMainModule` (step 5).

### 2. Raw bytes, never re-serialized JSON

Meta signs the **exact bytes** it sends with your app secret
(`X-Hub-Signature-256`). `readRawBody` collects them as a `Buffer`, with a
1 MiB limit, and `provider.ingest(raw, req.headers)` checks the signature
before parsing. Parsing the body and serializing it again (what a JSON body
parser does) changes the bytes, so the signature no longer matches: do not
put `express.json()` or similar in front of the webhook.

### 3. The 24-hour window

On the Cloud API, free-form messages only reach a user within 24 hours of
their last message. Outside it, Meta rejects the send with error `131047`,
which the provider turns into `OutsideSessionWindowError`; the server then
sends the approved `order_shipped` template, which is always allowed. To have
the provider track the window, queue the message and retry it when the user
replies, configure its [`sessionWindow`](/guide/session-window#enabling-the-manager)
option instead.

### 4. The routes

| Request | Answer |
| --- | --- |
| `GET /webhook?hub.mode=subscribe&hub.verify_token=<yours>&hub.challenge=<n>` | `200` with the challenge (Meta's subscription check); `403` with another token |
| `POST /webhook` with a valid `X-Hub-Signature-256` | `200`: the events reach the bot |
| `POST /webhook` unsigned, forged or re-serialized | `403`: nothing reaches the bot |
| `POST /webhook` larger than 1 MiB | `413` |
| `POST /notify/shipped` with `Authorization: Bearer <ADMIN_TOKEN>` and `{ "chatId", "order" }` | `200` with `text` or `template` (what went out) |
| `POST /notify/shipped` without the token / with invalid JSON | `401` / `400` |
| `GET /healthz` | `200 ok` |

`ingest()` returns right after dispatching the events, so Meta gets its
`200` at once while the handlers run. The admin token is compared in constant
time, and the route only accepts 4 KiB.

### 5. Running it

`env()` stops the process at startup with one clear line when a variable is
missing, instead of a provider error later. `appSecret` turns the signature
check on: never deploy without it (and never set `allowUnsignedWebhooks`).
On `SIGTERM` the server stops accepting webhooks (Meta retries what it could
not deliver) and the bot drains the replies in flight.

`@botmesh/server` (on npm from the beta) packages the same
ingress with concurrency limits, timeouts and adapters for Express, Fastify
and Hono: see [Webhook server](/guide/server).

## Sample transcript

The conversation, captured with `npx botmesh dev server.js`:

```text
user › hi
bot › 👋 Hi! I am the order desk. Send "track" to follow an order.
user › track
bot › What is your order number?
user › ABC
bot › ❌ Order numbers have 4 to 8 digits.
user › 20931
bot › 📦 Order 20931 is being prepared. I will write when it ships.
user › thanks
bot › Send "track" to follow an order.
```

On the Cloud API, the same replies go out through the Graph API.

## Run it on WhatsApp

```bash
META_TOKEN=... META_PHONE_ID=... META_VERIFY_TOKEN=... META_APP_SECRET=... ADMIN_TOKEN=... node server.js
```

In the Meta app dashboard, set the callback URL to
`https://<your-domain>/webhook` with the same verify token and subscribe to
the `messages` field. Then message the business number from WhatsApp, and
call the notify route from your backend:

```bash
curl -X POST https://<your-domain>/notify/shipped -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"chatId":"573001112233","order":"20931"}'
```

## Next steps

- [24-hour window and pricing](/guide/session-window): the window manager, usage and costs
- [Production-ready bot](./production-bot): store, durability, health and Docker
- [Security](/guide/security): the production checklist for webhooks
