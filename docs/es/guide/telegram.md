# Telegram

Telegram Bot API. Long polling por defecto; `polling: false` cambia a modo
webhook, donde `webhookSecret` es obligatorio.

## Instalación

```bash
pnpm add @botmesh/core @botmesh/telegram
```

## Uso

- **Polling** no necesita URL pública: úsalo en desarrollo y para un bot que
  corre en un solo proceso. Solo puede haber un poller por token (un segundo
  recibe `409` y el provider se detiene).
- **Webhook** encaja con serverless y despliegues con varias réplicas detrás de
  HTTPS. Registra la URL una vez con `setWebhook` de la Bot API, pasando el
  mismo secreto como `secret_token`.

```ts
import { TelegramProvider } from '@botmesh/telegram'

const provider = new TelegramProvider({ token: process.env.TELEGRAM_TOKEN! })

// Webhook mode: the same secret goes to setWebhook (secret_token)
const hooked = new TelegramProvider({
  token: process.env.TELEGRAM_TOKEN!,
  polling: false,
  webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET!,
})
```

- Teclados inline, encuestas nativas, reacciones y edición de mensajes.
- `ctx.stream()` usa borradores nativos en chats privados y ediciones en el
  resto.
- En modo webhook `ingest(body, headers)` acepta los bytes crudos, el string
  JSON o el objeto ya parseado, y comprueba la cabecera
  `X-Telegram-Bot-Api-Secret-Token` (en cualquier capitalización, objeto plano
  o `Headers` de Fetch). Con `@botmesh/server` no hace falta ninguna opción.
  Tras `stop()` responde `503` y no emite nada, así que Telegram reenvía esos
  Updates cuando el bot vuelve.
- Los **comandos de grupo** dirigidos al bot (`/menu@MiBot`) llegan a
  `bot.command('menu')`, también en el pie de una foto o un archivo: el
  provider quita el sufijo cuando nombra a este bot (usuario de `getMe`, o la
  opción `username` si pasas `selfId`).
- **Menciones al bot**: un `@MiBot` en el texto y un comando dirigido como
  `/menu@MiBot` añaden el `selfId` del bot a `ctx.mentions`, así que
  `groupMode: 'mentions'` los deja pasar. Las demás menciones `@usuario` no
  llevan id de usuario y no se listan; un `text_mention` (un usuario sin nombre
  de usuario) sí.
- Cada petición a la Bot API tiene timeout de cliente (`requestTimeoutMs`,
  120 s por defecto; el long poll usa `pollTimeoutMs` (30 s por defecto) + 15 s; las subidas de
  archivos, `uploadTimeoutMs`, 5 min por defecto), los errores nunca llevan el
  token del bot, un `retry_after` de 429 se respeta hasta 24 h y `bot.stop()`
  corta al momento las esperas de reintento del bucle de polling.
- **Mensajes editados**: llegan al bot como mensajes con el texto nuevo y el
  `ref.id` original (respuestas, reacciones y ediciones apuntan al mensaje
  editado). `isEditedMessage(ctx)` los distingue; el dedupe del core deja pasar
  la edición porque su contenido cambió. `editedMessages: 'ignore'` los desactiva.
- **Votos de encuesta**: las encuestas se envían no anónimas
  (`is_anonymous: false`), así que cada voto llega como update `poll_answer` y se
  convierte en un evento `'poll'` con el recuento, como en WhatsApp. Los miembros
  del chat ven quién votó; `anonymousPolls: true` envía encuestas anónimas, cuyos
  votos nunca llegan al bot. Se cuentan los votos de las encuestas que envió este
  proceso (en memoria, las últimas 500): un voto en una encuesta enviada antes de
  un reinicio se descarta. Los canales no admiten encuestas con votantes públicos:
  una encuesta a un canal se reintenta una vez como anónima (sin votos) y ese canal
  recibe encuestas anónimas desde entonces.
- **Servidor Bot API propio (self-hosted)**: apunta `baseUrl` a él. Si va por
  HTTP plano o en una red privada, las descargas de media necesitan además
  `mediaDownload: { allowHttp: true, allowPrivateHosts: true }` (y un `maxBytes`
  mayor). Arráncalo sin `--local`: en ese modo las rutas de archivo no se sirven
  por HTTP.

```ts
import { TelegramProvider, isEditedMessage } from '@botmesh/telegram'

const selfHosted = new TelegramProvider({
  token: process.env.TELEGRAM_TOKEN!,
  baseUrl: 'http://telegram-bot-api:8081',
  mediaDownload: { allowHttp: true, allowPrivateHosts: true, maxBytes: 200 * 1024 * 1024 },
})
bot.before('message', async (ctx, next) => { if (!isEditedMessage(ctx)) await next() }) // ignora ediciones
```

## Siguientes pasos

- [Canales](/es/guide/canales): elegir un canal, la matriz de capacidades y el contrato común de los canales.
- [Respuestas en streaming](/es/guide/streaming): borradores nativos en chats privados.
- [Servidor de webhooks](/es/guide/servidor): modo webhook con `@botmesh/server`.
- [README del paquete](https://github.com/andresayac/botmesh/tree/main/packages/telegram-provider)
