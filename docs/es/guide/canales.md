# Canales (providers)

El motor del bot (`@botmesh/core`) no conoce ningún transporte. Un
**provider** lo conecta a un canal: recibe los eventos del canal, los
convierte en `InboundEvent` neutros y envía `OutboundContent` de vuelta. Los
mismos flujos, triggers y plugins funcionan en todos los canales; solo cambia
el constructor.

```ts
import { Bot } from '@botmesh/core'

const bot = new Bot({ provider }) // cualquiera de los providers de abajo
```

Esta página compara todos los providers del repositorio: cómo recibe eventos
cada uno y qué puede y qué no puede hacer. Cada canal tiene su propia página
con la configuración, las opciones y los límites (ver [Providers](#providers)).
Instala el core y el canal que necesites:

```bash
pnpm add @botmesh/core @botmesh/baileys   # o @botmesh/meta, @botmesh/telegram, @botmesh/discord, @botmesh/twilio...
```

::: tip Prueba un canal sin cuenta
El [sandbox de plataformas](/es/guide/sandbox) ejecuta tu bot sobre los
providers reales de la Cloud API, Telegram, Twilio, Discord y otros contra
simuladores locales, y el [simulador en la terminal](/es/guide/simulador) te
deja chatear con él en la terminal. Ninguno necesita una app, un número de
teléfono ni una URL pública.
:::

## Paquetes publicados y sin publicar

| Paquete | Directorio | Estado | Transporte |
| --- | --- | --- | --- |
| `@botmesh/baileys` | `baileys-provider` | En npm | WhatsApp Web (socket de Baileys) |
| `@botmesh/meta` | `meta-provider` | En npm | WhatsApp Cloud API (oficial) |
| `@botmesh/telegram` | `telegram-provider` | En npm | Telegram Bot API |
| `@botmesh/messenger` | `messenger-provider` | En npm (desde la beta) | Facebook Messenger (Send API) |
| `@botmesh/instagram` | `instagram-provider` | En npm (desde la beta) | DMs de Instagram (Messenger API for Instagram) |
| `@botmesh/discord` | `discord-provider` | En npm (desde la beta) | Discord (gateway + REST) |
| `@botmesh/evolution` | `evolution-provider` | En npm (desde la beta) | Evolution API v2 (gateway de WhatsApp self-hosted) |
| `@botmesh/wppconnect` | `wppconnect-provider` | En npm (desde la beta) | WPPConnect Server (gateway de WhatsApp self-hosted) |
| `@botmesh/twilio` | `twilio-provider` | En npm (desde la beta) | Twilio Programmable Messaging (WhatsApp + SMS/MMS) |
| `@botmesh/gohighlevel` | `gohighlevel-provider` | En npm (desde la beta) | HighLevel (LeadConnector) Conversations API |
| `@botmesh/gupshup` | `gupshup-provider` | En npm (desde la beta) | Gupshup WhatsApp API |
| `@botmesh/email` | `email-provider` | En npm (desde la beta) | Email (IMAP IDLE + SMTP) |
| `@botmesh/tiktok` | `tiktok-provider` | Privado (no está en npm) | TikTok API for Business (comentarios + Business Messaging) |

`@botmesh/tiktok` está implementado y con tests, pero es privado: no está en
npm y su API puede cambiar. El estado de publicación, los dist-tags y cómo
instalar cada paquete están en [Paquetes y versiones](/es/guide/paquetes).

## Elegir un canal

**WhatsApp** tiene varias opciones:

- **`@botmesh/baileys`**: vincula el bot como un dispositivo de WhatsApp Web
  (QR o código de emparejamiento) y abre su propio socket. Sin servidor
  público ni webhook, con grupos y encuestas, sin coste por mensaje. Es un
  cliente **no oficial**: automatizar una cuenta puede infringir los términos
  de WhatsApp y acabar en el bloqueo del número. Deja activado el
  [rate limiter](/es/guide/rate-limiting).
- **`@botmesh/meta`**: la WhatsApp Cloud API oficial. Botones, listas,
  plantillas y [formularios con WhatsApp Flows](/es/guide/formularios)
  nativos, sin riesgo de baneo. Necesita un webhook HTTPS público, no tiene
  grupos y los mensajes libres solo funcionan dentro de la
  [ventana de atención de 24 horas](/es/guide/ventana-24h).
- **`@botmesh/evolution`** / **`@botmesh/wppconnect`**: ya tienes desplegado un
  Evolution API o un WPPConnect Server. El bot habla con ese gateway por REST
  y recibe sus webhooks. Ambos gateways manejan WhatsApp Web, así que valen
  las mismas advertencias que con Baileys (no oficial, sin botones nativos
  fiables). Lo común (cliente REST, media, reconciliación LID/PN) vive en
  `@botmesh/wa-gateway-kit`, una dependencia pública de ambos; se instala el
  canal, no el kit (salvo que escribas un transporte para otro gateway).
- **`@botmesh/twilio`** / **`@botmesh/gupshup`**: envías WhatsApp a través de
  la cuenta de ese proveedor. Admiten plantillas; Twilio cubre además SMS/MMS
  con la misma clase.
- **`@botmesh/gohighlevel`**: el bot responde a los contactos del CRM
  HighLevel por el canal que usaron (SMS, WhatsApp, Email, Facebook,
  Instagram, Live chat...).

**Otros canales:** `@botmesh/telegram` (long polling por defecto, webhook
opcional), `@botmesh/discord` (socket del gateway), `@botmesh/messenger` e
`@botmesh/instagram` (webhooks de Meta), `@botmesh/email` (cada hilo de correo
es un chat) y `@botmesh/tiktok` (comentarios en tus propios videos y DMs).

### Socket, polling o webhook

- **Socket / polling** (el provider abre la conexión): Baileys, Discord,
  Telegram en modo polling, Email (IMAP IDLE). No hay nada que exponer a
  internet.
- **Webhook** (`capabilities.pushIngress: true`): Cloud API, Messenger,
  Instagram, Telegram en modo webhook, Evolution, WPPConnect, Twilio,
  HighLevel, Gupshup, TikTok. **Tu** servidor HTTP recibe el POST y le pasa
  el **body crudo** y las cabeceras a `provider.ingest()`, que verifica la
  firma o el token y devuelve el status HTTP con el que responder.
  [`@botmesh/server`](/es/guide/servidor) resuelve ese cableado (body crudo,
  límites de tamaño, timeouts, límite de concurrencia, endpoints de salud) para
  `node:http`, Express, Fastify y Hono.

La forma recomendada es `@botmesh/server` (`pnpm add @botmesh/server`): una
ruta por provider, y el handshake `GET` y los `POST` firmados quedan resueltos:

```ts
import { createServer } from 'node:http'
import { createIngress, createNodeHandler } from '@botmesh/server'

const ingress = createIngress({ routes: [{ path: '/webhook', provider }], bot })
createServer(createNodeHandler(ingress)).listen(3000) // también /healthz y /readyz
```

Sin él basta una ruta en cualquier framework. Lee el body **como bytes** (la
firma cubre los bytes exactos, así que nunca pases un objeto JSON
re-serializado) y responde con el status que devuelve `ingest()`:

```ts
import { createServer } from 'node:http'
import { Bot } from '@botmesh/core'
import { CloudAPIProvider } from '@botmesh/meta'

const provider = new CloudAPIProvider({
  accessToken: process.env.META_TOKEN!,
  phoneNumberId: process.env.META_PHONE_ID!,
  verifyToken: process.env.META_VERIFY_TOKEN!,
  appSecret: process.env.META_APP_SECRET!,
})
const bot = new Bot({ provider })
await bot.start()

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname !== '/webhook') return void res.writeHead(404).end()
  if (req.method === 'GET') { // handshake de suscripción de Meta
    const challenge = provider.verifyChallenge(Object.fromEntries(url.searchParams))
    return void (challenge ? res.writeHead(200).end(challenge) : res.writeHead(403).end())
  }
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of req as AsyncIterable<Buffer>) {
      if ((size += chunk.length) > 1024 * 1024) return void res.writeHead(413).end() // tope de 1 MiB
      chunks.push(chunk)
    }
  } catch {
    return void res.destroy() // el cliente cortó la subida: se descarta sin tumbar el proceso
  }
  res.writeHead(provider.ingest(Buffer.concat(chunks), req.headers)).end()
}).listen(3000)
```

Los demás providers por webhook siguen el mismo patrón: Messenger e Instagram
tienen el mismo handshake `GET`, Telegram no tiene ninguno, y los providers
cuya autenticación cubre la URL también la reciben (el
`ingest(body, headers, url)` asíncrono de WPPConnect,
`ingestRequest({ url, body, headers })` en Twilio y Gupshup). `ingest()` no
espera a tus handlers, así que la plataforma recibe su respuesta enseguida.

El constructor de todo provider por webhook (Telegram, solo en modo webhook)
**lanza un error** si falta su credencial de webhook (app secret, auth token o token compartido), salvo que
pases `allowUnsignedWebhooks: true`, pensado solo para desarrollo local
aislado. HighLevel es la excepción: su clave pública de firma viene incluida.

## Matriz de capacidades

Los valores salen de la declaración `capabilities` de cada provider. Una
función marcada "no" se **degrada, no se rompe**: los botones y las listas
pasan a un menú de texto numerado, `ctx.edit` envía un mensaje nuevo,
`ctx.react` resuelve `{ skipped: true }` y `ctx.typing` no hace nada (ver
[Mensajes y media](/es/guide/mensajes#soporte-por-transporte)).

**Contenido.** Lo que cada canal envía de forma nativa.

| Provider | Botones | Listas | Encuestas | Enviar reacciones | Editar | Plantillas | Formularios |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Baileys | no | no | sí | sí | no | no | campo a campo |
| Cloud API (`meta`) | sí | sí | no | sí | no | sí | nativo (WhatsApp Flows) |
| Telegram | sí | no (teclado inline) | sí | sí | sí | no | campo a campo |
| Messenger | sí | sí | no | no | no | no | campo a campo |
| Instagram | sí (quick replies) | no | no | no | no | no | campo a campo |
| Discord | sí | sí | sí | sí | sí | no | campo a campo |
| Evolution | no | no | sí | sí | sí | no | campo a campo |
| WPPConnect | no | no | sí | sí | sí | no | campo a campo |
| Twilio | no | no | no | no | no | sí | campo a campo |
| HighLevel | no | no | no | no | no | sí | campo a campo |
| Gupshup | sí | sí | no | no | no | sí | campo a campo |
| Email | no | no | no | no | no | no | campo a campo |
| TikTok | sí (de 1 a 3, DMs; más → texto numerado) | sí (hasta 3 filas, DMs; más → texto numerado) | no | no | no | no | campo a campo |

**Entrada y presencia.** Cómo llegan los eventos y qué indicadores de presencia funcionan.

| Provider | Entrada | Escribiendo | Confirmación de lectura | Grupos | `ctx.stream` |
| --- | --- | --- | --- | --- | --- |
| Baileys | socket | sí | sí | sí | fragmentos |
| Cloud API (`meta`) | webhook | no | sí | no | fragmentos |
| Telegram | polling o webhook | sí | no | sí | borrador |
| Messenger | webhook | sí | sí | no | fragmentos |
| Instagram | webhook | sí | sí | no | fragmentos |
| Discord | socket | sí | no | sí | edición |
| Evolution | webhook | sí | sí | sí | fragmentos |
| WPPConnect | webhook | sí | sí | sí | fragmentos |
| Twilio | webhook | sí (solo WhatsApp) | no | no | fragmentos |
| HighLevel | webhook | no | sí | no | fragmentos |
| Gupshup | webhook | no | no | no | fragmentos |
| Email | IMAP IDLE (o `ingest()`) | no | no | no | fragmentos |
| TikTok | webhook | sí (DMs) | sí (DMs) | no | fragmentos |

- **Enviar reacciones** solo describe el envío. Varios providers reciben
  igualmente reacciones como eventos `reaction` (Messenger, Instagram,
  Gupshup, TikTok...).
- **`ctx.stream`**: `borrador` = vistas previas nativas en borrador y un
  mensaje final (chats privados de Telegram; ediciones en el resto),
  `edición` = un mensaje que se edita a medida que crece el texto,
  `fragmentos` = sin vista previa en vivo, mensajes del tamaño de una frase
  con indicador de escritura (`streaming: 'none'`). Ver [Respuestas en streaming](/es/guide/streaming).
- **Formularios**: `nativo` envía `flow().form()` como un WhatsApp Flow;
  `campo a campo` pregunta cada campo con mensajes de texto.
- **`textFormat`** (no es columna): el formato de texto que muestra el canal,
  para que quien genere Markdown, como `@botmesh/ai`, lo convierta.
  `'whatsapp'` (`*negrita*`, `_cursiva_`, `~tachado~`): Baileys, Cloud API,
  Evolution, WPPConnect, Gupshup. `'plain'` (sin formato): Telegram (se envía
  sin `parse_mode`), Messenger, Instagram, TikTok. `'markdown'`: Discord. Sin
  declarar: Email. Los providers que sirven varios canales deciden por chat con
  el método opcional `textFormatFor(chatId)`, que gana a
  `capabilities.textFormat` y llega a los handlers como `ctx.textFormat`:
  Twilio devuelve `'whatsapp'` en los chats `whatsapp:` y `'plain'` en SMS;
  HighLevel sigue el canal de respuesta del contacto (`'whatsapp'` en WhatsApp,
  `'plain'` en SMS, Email, FB, IG, Live chat, GMB y custom).
- **Plantillas** es el tipo de contenido `template`: plantillas de la Cloud
  API, Content Templates de Twilio (`ContentSid`), `templateId` de HighLevel,
  plantillas de Gupshup. El resto de providers lo rechaza con
  `UnsupportedContentError`.
- Todos los providers salvo Baileys aceptan el tipo de contenido `native`
  (`ctx.sendNative('<id del provider>', payload)`) como vía de escape a la API
  propia del canal, con un payload específico de cada provider. Baileys lo
  rechaza con `UnsupportedContentError`. Discord, Messenger, Instagram,
  Evolution, WPPConnect, Twilio, Gupshup, HighLevel, Email y TikTok también
  rechazan un payload dirigido a otro id de provider en lugar de enviarlo.

## Contrato común de los canales

Las mismas reglas valen en todos los canales, así un bot se comporta igual donde corra.
Quien escribe un provider las comprueba con los helpers de `@botmesh/core/testing`
(ver [Testing](/es/guide/testing#contratos-de-providers)).

- **Los timestamps son milisegundos epoch.** `ctx.timestamp`,
  `InboundMessage.timestamp`, `InboundInteraction.timestamp` y
  `DeliveryStatus.timestamp` son ms epoch en todos los canales. Los transportes que
  informan segundos (WhatsApp, Telegram, la Cloud API) se multiplican por 1000; uno que
  no informa hora (Twilio) usa la hora de recepción, nunca `0`. Telegram no envía la
  hora de pulsación de un botón, así que un callback query lleva la hora de recepción.
- **El texto largo se divide.** Cada canal declara su límite de texto y el core divide un
  envío `text` más largo en varios mensajes (ver
  [Mensajes](/es/guide/mensajes#el-texto-largo-se-divide-solo); `splitLongText: false`
  lo desactiva).
- **Las operaciones no soportadas no existen.** Una operación que el transporte no puede
  hacer no se implementa: falta el método opcional (`typing`, `markRead`, `editMessage`,
  `deleteMessage`) y su flag de capacidad es `false`, así que `ctx.typing()`,
  `ctx.markRead()` y `ctx.delete()` no hacen nada. Un método que existe hace la
  operación o rechaza; nunca es un sustituto silencioso.
- **La presencia es de mejor esfuerzo sin conexión.** `typing()` y `markRead()`
  resuelven sin tocar el transporte mientras el último estado de conexión del provider
  no es `'ready'` (antes de que `start()` conecte, durante una reconexión, después de
  `stop()`): sin error, sin cola y sin reintento posterior. El bot aplica la misma
  regla antes de llamarlos, registra la señal omitida en debug y la cuenta en
  `metrics().presenceSkipped` (`botmesh_presence_skipped_total` en `toPrometheus()`).
  Ya conectado, un fallo del transporte sigue rechazando.
  `assertPresenceWhileDisconnected()` lo comprueba en un provider.
- **Demasiadas opciones rechazan.** Un transporte que muestra menos botones, filas o
  respuestas de encuesta de las que enviaste rechaza con `UnsupportedContentError`
  (Cloud API, Messenger, Instagram, Discord), salvo que tenga una degradación
  documentada (texto numerado en Baileys, Evolution, WPPConnect, Gupshup, TikTok).
- **Una ruta local de media que no se puede leer** rechaza con
  `UnsupportedContentError` (el error de fs como `cause`), nunca con un `ENOENT` crudo.
- **Las esperas tienen tope.** Cada llamada REST tiene timeout (`requestTimeoutMs` en la
  Cloud API, Telegram, Discord, Messenger e Instagram) y un `RateLimitedError` nunca pide
  más de 24 h.
- **Una edición conserva el id original.** Donde el transporte informa de ediciones de
  texto (Baileys, `edited_message` de Telegram, `MESSAGE_UPDATE` de Discord), la edición
  llega como mensaje con el texto nuevo y el `ref.id` original; cada uno de esos paquetes
  exporta `isEditedMessage(ctx)` y una opción `editedMessages: 'ignore'`. El dedupe del
  core deja pasar la edición porque su contenido cambió y descarta una re-entrega de la
  misma edición.
- **Los votos de encuesta tienen una sola forma.** Baileys y Telegram emiten cada voto
  como evento `'poll'` (`bot.on('poll', (vote) => …)`): `vote.ref` es el mensaje de la
  encuesta, `vote.senderId` quien votó y `vote.options` el recuento actual de cada opción
  con sus `voters`.
- **Un solo esquema de nombres para los helpers de bajo nivel.** El mapeador de errores
  de cada provider es `to<Canal>Error` (`toTelegramError`, `toDiscordError`,
  `toTwilioError`…; los canales de Meta comparten `toGraphError` de
  `@botmesh/graph-core`). Telegram, TikTok y la Cloud API conservan su antiguo
  `toProviderError` (y Email su `toEmailProviderError`) como alias deprecados; los canales
  que se publican por primera vez con la beta solo tienen los nombres nuevos.
  `ingest()` devuelve el estado HTTP con el que responder (un `number`);
  WPPConnect lo devuelve como `Promise<number>` (resuelve los LID desconocidos contra el
  gateway antes de emitir, sin esperar a tus handlers) y
  el `ingest()` de email recibe un mensaje crudo, no un webhook, y devuelve un
  `EmailIngestResult`.

| Provider | `maxTextLength` | `maxTextBytes` |
| --- | --- | --- |
| Baileys, Evolution, WPPConnect | 65 536 | |
| Cloud API (`meta`), Gupshup | 4096 | |
| Telegram | 4096 | |
| Discord, Messenger | 2000 | |
| Instagram | 1000 | 1000 |
| Twilio | 1600 | |
| TikTok | 6000 (DMs; las respuestas a comentarios admiten 150) | |
| HighLevel, Email | sin declarar (no se divide) | |

## Providers

Cada canal tiene su propia página con la configuración, las opciones y los límites.

### `@botmesh/baileys`

WhatsApp Web a través de Baileys: vinculación por QR o código, socket propio, grupos y encuestas. Ver [Baileys (WhatsApp Web)](/es/guide/baileys).

### `@botmesh/meta` (WhatsApp Cloud API)

La WhatsApp Cloud API oficial: botones, listas, plantillas y formularios de WhatsApp Flows nativos sobre webhooks. Ver [WhatsApp Cloud API](/es/guide/whatsapp-cloud-api).

### `@botmesh/telegram`

Telegram Bot API, por long polling o webhook. Ver [Telegram](/es/guide/telegram).

### `@botmesh/messenger`

Facebook Messenger a través de la Send API de Graph y los webhooks de Meta. Ver [Messenger](/es/guide/messenger).

### `@botmesh/instagram`

DMs de Instagram de una cuenta profesional (Messenger API for Instagram). Ver [Instagram](/es/guide/instagram).

### `@botmesh/discord`

Gateway de Discord (WebSocket) para los eventos y REST para enviar. Ver [Discord](/es/guide/discord).

### `@botmesh/evolution`

Evolution API v2, un gateway de WhatsApp self-hosted: REST de salida, webhook de la instancia de entrada. Ver [Evolution API](/es/guide/evolution).

### `@botmesh/wppconnect`

WPPConnect Server, un gateway de WhatsApp Web self-hosted: REST con token Bearer, webhooks con token en la URL. Ver [WPPConnect](/es/guide/wppconnect).

### `@botmesh/twilio`

Twilio Programmable Messaging: WhatsApp y SMS/MMS con una sola clase. Ver [Twilio](/es/guide/twilio).

### `@botmesh/gohighlevel`

HighLevel (LeadConnector) Conversations API: responde a los contactos del CRM por el canal que usaron. Ver [HighLevel (GoHighLevel)](/es/guide/gohighlevel).

### `@botmesh/gupshup`

Gupshup WhatsApp API, con callbacks autenticados por un token compartido. Ver [Gupshup](/es/guide/gupshup).

### `@botmesh/email`

Email por IMAP IDLE y SMTP: cada hilo de correo es un chat. Ver [Email](/es/guide/email).

### `@botmesh/tiktok` (no está en npm)

TikTok API for Business: comentarios en tus propios vídeos y mensajes directos. Ver [TikTok](/es/guide/tiktok).

## Actualizar desde una alpha de 2.0

Los bots nuevos pueden saltarse esta sección. Si tenías un bot sobre una de las
primeras alphas de 2.0, el [contrato común de los canales](#contrato-comun-de-los-canales)
cambió algunos comportamientos; el detalle por paquete está en
[Notas de actualización: canales y plugins](/es/guide/actualizar-canales-plugins)
y [Migrar a la API estable](/es/guide/migracion-estable).

::: details Qué cambió en todos los canales

- **`ctx.timestamp` es milisegundos epoch en todas partes.** Baileys, la Cloud API y
  `MockProvider` informaban segundos epoch. Quita cualquier `* 1000`
  (`new Date(ctx.timestamp)` ya es correcto). Lo mismo vale para los timestamps de
  `InboundMessage`, `InboundInteraction` y `DeliveryStatus` en hooks propios. Un provider
  de terceros que aún emite segundos sigue funcionando: el core convierte un valor menor
  que `1e12` para `ctx.timestamp` y el log de mensajes, pero actualízalo para emitir ms
  (`assertInboundContract` lo detecta).
- **Las pulsaciones de botones en Telegram** llevan la hora de recepción, no la fecha del
  mensaje que tiene el teclado.
- **Se quitaron métodos que no hacían nada**: `CloudAPIProvider#typing()` y
  `#deleteMessage()`, `TelegramProvider#markRead()` y `DiscordProvider#markRead()`. Usa
  `ctx.typing()`/`ctx.delete()`/`ctx.markRead()` (que ahí no hacen nada) o
  `provider.typing?.(…)`.
- **El texto largo se divide** en varios mensajes en vez de rechazar con
  `PayloadTooLargeError`. `new Bot({ splitLongText: false })` recupera el comportamiento
  anterior. Los hooks `before('send')` siguen corriendo una vez por mensaje (sobre el texto
  completo, antes de dividirlo); los `after('send')`, una vez por parte.
- **Demasiadas opciones rechazan** en Discord (más de 25 botones u opciones de menú, más
  de 10 respuestas de encuesta), Messenger (más de 3 botones, más de 10 filas de lista) e
  Instagram (más de 13 quick replies) con `UnsupportedContentError`; antes descartaban
  las opciones sobrantes en silencio.
- **Discord difiere las interacciones sin responder** tras 2 s.
  `autoAcknowledgeMs: false` recupera el comportamiento anterior. Un
  `ctx.acknowledge('texto')` tardío sale entonces como followup; sin `appId` ni id de
  aplicación recibido de Discord, rechaza.
- **`MockProvider`** informa `capabilities.typing` y `readReceipts` como `false` salvo que
  exista un método `typing()`/`markRead()` (antes tampoco tenían efecto), y emite
  timestamps en ms epoch.
- **`RateLimitedError.retryAfterMs`** tiene un tope de 24 h.
- **Las encuestas de Telegram se envían no anónimas** para que sus votos lleguen al bot
  como eventos `'poll'`. `new TelegramProvider({ anonymousPolls: true })` mantiene las
  encuestas anónimas.
- **Las ediciones de Discord se entregan** como mensajes con el `ref.id` original; un
  handler que no deba verlas comprueba `isEditedMessage(ctx)` o usa
  `editedMessages: 'ignore'`.
- **Helpers renombrados** (los nombres antiguos son alias deprecados hasta v3):
  `pollTimeout` de Telegram (segundos) → `pollTimeoutMs`; `toProviderError` →
  `toTelegramError`, `toTikTokError`; `toEmailProviderError` → `toEmailError`; el
  `toProviderError` de `@botmesh/meta` → `toGraphError` de `@botmesh/graph-core`.
  Discord, Messenger e Instagram quitaron su `toProviderError` de las alphas antes de su
  primera publicación en npm: usa `toDiscordError`, `toMessengerError` y
  `toInstagramError`.

:::

## Siguientes pasos

- [Mensajes y media](/es/guide/mensajes): qué hace cada helper en cada
  transporte.
- [Sandbox de plataformas](/es/guide/sandbox): ejecuta un bot sobre los
  providers reales contra simuladores locales, sin cuentas.
- [Servidor de webhooks](/es/guide/servidor): monta los providers por webhook
  con `@botmesh/server`.
- [Ventana de 24 h y costos](/es/guide/ventana-24h): ventana de sesión de la
  Cloud API y seguimiento de uso.
- [Formularios](/es/guide/formularios): WhatsApp Flows nativos en la Cloud API,
  campo a campo en el resto.
