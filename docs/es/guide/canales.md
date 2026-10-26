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

Esta página recoge todos los providers del repositorio, cómo recibe eventos
cada uno y qué puede y qué no puede hacer. Instala el core y el canal que
necesites:

```bash
pnpm add @botmesh/core @botmesh/baileys   # o @botmesh/meta, @botmesh/telegram, @botmesh/discord, @botmesh/twilio...
```

Mientras botmesh esté en prerelease, añade a cada paquete el dist-tag de la
prerelease (ver [Instalación](/es/guide/inicio)).

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
| `@botmesh/tiktok` | `tiktok-provider` | Aún no en npm | TikTok API for Business (comentarios + Business Messaging) |

Los canales **En npm** se instalan con `pnpm add` y siguen semver (durante
la beta, añade el dist-tag `@beta`; los marcados "desde la beta" se publican por
primera vez con ella). `@botmesh/tiktok` lleva `"private": true` en su
`package.json`: está implementado y con tests, pero **no se publica en npm** y
su API todavía puede cambiar. Úsalo desde un clon del monorepo (`"workspace:*"`). Lo mismo vale para el
[sandbox](/es/guide/sandbox). El ingress de webhooks,
[`@botmesh/server`](/es/guide/servidor), sí está en npm.

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
  Evolution, WPPConnect, Twilio, Gupshup y HighLevel también rechazan un
  payload dirigido a otro id de provider en lugar de enviarlo.

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
  `@botmesh/graph-core`); los nombres antiguos `toProviderError` quedan como alias
  deprecados. `ingest()` devuelve el estado HTTP con el que responder (un `number`);
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

### `@botmesh/baileys`

WhatsApp Web a través de [Baileys](https://github.com/WhiskeySockets/Baileys).
Se vincula con un código QR (o un código de emparejamiento, `pairingPhoneNumber`) y guarda la sesión en
`sessionsDir` (`./sessions/<session>`): los arranques siguientes reconectan sin
QR. Depende de la versión exacta `7.0.0-rc14` de `@whiskeysockets/baileys`
(todavía no hay Baileys 7 estable); el README explica esa fijación y la
política de actualización.

```ts
import { BaileysProvider } from '@botmesh/baileys'

const provider = new BaileysProvider({ session: 'my-bot' })
```

- Socket propio del provider, con reconexión y backoff
  (`reconnect: { maxAttempts, baseMs, capMs }` lo ajusta, `false` lo
  desactiva).
- Las formas LID y número de teléfono de un usuario se unen en un único
  `senderId` estable.
- Sin botones ni listas nativos (WhatsApp Web los retiró): usa menús
  `choose()` o `ctx.poll()`.
- El rate limiting anti-baneo de envíos está activado por defecto
  (`rateLimit`).
- Las reacciones y los borrados llegan como eventos, nunca como mensajes,
  así que un handler comodín o un `ask` abierto no los toman como texto.
  Una **edición de texto** llega como mensaje con el texto nuevo y el
  `ref.id` original, como en Telegram: `isEditedMessage(ctx)` (de
  `@botmesh/baileys`) la distingue y `editedMessages: 'ignore'` descarta las
  ediciones. Solo el autor de un mensaje que el proceso ha visto puede
  editarlo: la edición de un mensaje ajeno, de uno del bot o de un original
  que ya no está en caché se descarta.
- `ctx.voice()` y `ctx.sticker()` aceptan URLs y streams (descargados con los
  mismos controles anti-SSRF que el resto de la media); `ctx.poll()` necesita
  de 2 a 12 opciones distintas.

[README](https://github.com/andresayac/botmesh/tree/main/packages/baileys-provider)

### `@botmesh/meta` (WhatsApp Cloud API)

La API oficial. Funciona por webhook: handshake GET con `verifyChallenge()`
y eventos POST con `ingest()` (ver el ejemplo de servidor
[más arriba](#socket-polling-o-webhook)).

Configuración en Meta: crea una app con el producto **WhatsApp** en
developers.facebook.com, genera un **token de usuario del sistema** permanente
con `whatsapp_business_messaging`, copia el **phone number id** del número
emisor y, en WhatsApp → Configuración, pon la URL del webhook y un verify token
que elijas, y suscríbelo al campo **`messages`** (trae tanto los mensajes como
los estados de entrega).

```ts
import { CloudAPIProvider } from '@botmesh/meta'

const provider = new CloudAPIProvider({
  accessToken: process.env.META_TOKEN!,        // system-user token
  phoneNumberId: process.env.META_PHONE_ID!,
  verifyToken: process.env.META_VERIFY_TOKEN!, // the one you set in Meta
  appSecret: process.env.META_APP_SECRET!,     // verifies X-Hub-Signature-256
})
```

- Botones de respuesta nativos (máximo 3: con más rechaza con
  `UnsupportedContentError`, envía una lista), listas, plantillas y
  formularios con WhatsApp Flows. Un botón con `url` sale como botón de
  enlace `cta_url` (uno por mensaje: varios enlaces, o un enlace mezclado
  con botones de respuesta, rechazan). Una `card` conserva su imagen (como
  media o como cabecera del mensaje interactivo) y sus botones. Los límites
  de Graph se comprueban antes de enviar: sin botones, ids o títulos de
  botón repetidos (comparados tras el corte a 20 caracteres), una lista sin
  filas, con más de 10 filas en total o con ids de fila repetidos rechazan
  con `UnsupportedContentError`. Las etiquetas se cortan por grafemas, así
  que un emoji se conserva entero o se quita, nunca se parte.
- Si falta `accessToken`, `phoneNumberId` o `verifyToken`, el constructor
  falla con un error que nombra el campo (`phoneNumberId` también puede ser
  un entero seguro). Cada petición a Graph tiene un límite de tiempo
  (`requestTimeoutMs`, 60 s por defecto); las subidas de media tienen el
  suyo (`uploadTimeoutMs`, 5 min por defecto).
- Una respuesta interactiva que no es la pulsación de un botón o una lista
  (por ejemplo `call_permission_reply`) llega como mensaje `unknown`, con el
  payload crudo en `ctx.ref.native`.
- **Versión de la Graph API:** `apiVersion` toma por defecto
  `DEFAULT_GRAPH_API_VERSION` de `@botmesh/graph-core` (`v26.0`, publicada el
  29-07-2026; Messenger e Instagram usan el mismo valor). Meta retira cada
  versión unos dos años después de publicarla, así que el valor por defecto
  sigue a la actual y cambia en una versión menor, tras revisar los payloads
  contra el changelog de Meta. Fija `apiVersion` (por ejemplo `'v24.0'`) para
  quedarte en una versión hasta migrar. Un estado `played` (se escuchó una
  nota de voz) llega como `read` con `platformData.played: true`.
- Los usuarios con username de WhatsApp pueden llegar con un BSUID en lugar
  del teléfono; el provider mantiene un id estable por persona
  (`identityMap`).
- Fuera de la ventana de 24 h los envíos libres rechazan con
  `OutsideSessionWindowError`. El gestor opcional `sessionWindow` reabre el
  chat con una plantilla y reintenta: ver
  [Ventana de 24 h y costos](/es/guide/ventana-24h).
- La API no tiene grupos, indicador de escritura ni encuestas, ni borrado para
  todos: el provider no tiene `typing()` ni `deleteMessage()`, así que
  `ctx.typing()` y `ctx.delete()` no hacen nada (ver el
  [contrato común de los canales](#contrato-comun-de-los-canales)).
- El core divide en varios mensajes el texto de más de 4096 caracteres.
- `publishForm()` fija en el Flow la etiqueta de envío por defecto de un
  formulario en el `lang` del provider (por defecto `'en'`; ponle el
  `BotConfig.lang` de tu bot), o en `publishForm(def, { lang })` para un Flow.
  El `submitLabel` del propio formulario siempre gana.

[README](https://github.com/andresayac/botmesh/tree/main/packages/meta-provider)

### `@botmesh/telegram`

Telegram Bot API. Long polling por defecto; `polling: false` cambia a modo
webhook, donde `webhookSecret` es obligatorio.

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

[README](https://github.com/andresayac/botmesh/tree/main/packages/telegram-provider)

### `@botmesh/messenger`

Facebook Messenger a través del Send API de Graph, con la misma verificación
de webhook que la Cloud API.

```ts
import { MessengerProvider } from '@botmesh/messenger'

const provider = new MessengerProvider({
  accessToken: process.env.FB_PAGE_TOKEN!, // Page access token (pages_messaging)
  verifyToken: process.env.META_VERIFY_TOKEN!,
  appSecret: process.env.META_APP_SECRET!,
})
```

- Botones y listas nativos; las reacciones llegan pero no se pueden enviar
  (suscribe el webhook a `message_reactions`; `emoji` es el carácter y
  `removed` se marca con `unreact`).
- El texto se limita a 2000 caracteres (`maxTextLength`): el texto más largo
  se divide en varios mensajes, y los trozos de `ctx.stream()` caben en la
  Send API.
- Más de 3 botones (plantilla de botones) o de 10 filas de lista (plantilla
  genérica) rechazan con `UnsupportedContentError` en vez de descartar opciones.
- Cada llamada a la Send API vence tras `requestTimeoutMs` (60 s por defecto).
- No se corta texto: una lista envía su texto antes de la plantilla genérica
  (que no tiene encabezado), y el texto de botones que pasa de los 640
  caracteres de la plantilla sale antes como texto plano.
- Varios adjuntos en un mensaje llegan como un mensaje cada uno (`<mid>`,
  `<mid>#2`…). Un mensaje editado (suscribe `message_edits`) llega de nuevo
  con su id original; `isEditedMessage(ctx)` lo distingue.
- Etiquetas de mensaje: `bot.send(psid, texto, { platformData: { tag: 'HUMAN_AGENT' } })`
  envía fuera de la ventana de 24 horas (también acepta `messaging_type`,
  `notification_type` y `persona_id`).

```bash
pnpm add @botmesh/core @botmesh/messenger
```

[README](https://github.com/andresayac/botmesh/tree/main/packages/messenger-provider)

### `@botmesh/instagram`

DMs de una cuenta profesional de Instagram conectada a una Página de
Facebook (Messenger API for Instagram).

```ts
import { InstagramProvider } from '@botmesh/instagram'

const provider = new InstagramProvider({
  accessToken: process.env.META_PAGE_TOKEN!, // token of the connected Page
  verifyToken: process.env.META_VERIFY_TOKEN!,
  appSecret: process.env.META_APP_SECRET!,
})
```

- Los botones salen como quick replies (como mucho 13, títulos cortados a 20
  caracteres, ids y títulos únicos, sobre un texto no vacío; lo demás rechaza
  con `UnsupportedContentError` en vez de descartar opciones); las listas se
  degradan a texto numerado. Cada petición a la Send API caduca tras
  `requestTimeoutMs` (60 s).
- Solo DMs (sin grupos); las reacciones llegan pero no se pueden enviar.
- El texto se limita a 1000 bytes UTF-8 (`maxTextBytes`, además de
  `maxTextLength` 1000), así que el texto no ASCII cabe menos: el texto más
  largo se divide en varios mensajes por bytes, y los trozos de `ctx.stream()`
  también caben.
- Los adjuntos no llevan pie de foto: el caption de un medio sale como un
  mensaje de texto justo después del adjunto, y la imagen de una tarjeta después
  de su texto (una tarjeta solo con imagen envía la imagen; una sin texto ni
  imagen se rechaza).
- Un DM con varias fotos llega como un mensaje por foto (ids `<mid>`,
  `<mid>#2`, `<mid>#3`…).
- Con el bot parado, `ingest()` responde `503`, así que Meta reenvía el
  webhook tras el reinicio.

```bash
pnpm add @botmesh/core @botmesh/instagram
```

[README](https://github.com/andresayac/botmesh/tree/main/packages/instagram-provider)

### `@botmesh/discord`

Gateway de Discord (WebSocket) para los eventos y REST para enviar.

```ts
import { DiscordProvider, GatewayIntents } from '@botmesh/discord'

const provider = new DiscordProvider({ token: process.env.DISCORD_TOKEN! })
// Default intents: Guilds | GuildMessages | MessageContent.
// Add GatewayIntents.DirectMessages to the `intents` bitmask to receive DMs.
```

- Botones, menús de selección, encuestas, reacciones y ediciones nativos;
  `ctx.stream()` edita un mensaje a medida que crece el texto.
- El bot mantiene una reacción por mensaje, como en WhatsApp/Telegram: un
  nuevo `ctx.react(emoji)` reemplaza la anterior y `ctx.react('')` la quita.
  Discord borra reacciones por emoji, así que el provider recuerda el que puso
  (en memoria, `reactionMemory`, 1000 mensajes por defecto); si no lo conoce
  (se puso antes de reiniciar o salió del LRU) rechaza con
  `UnsupportedContentError`.
- Las interacciones tienen un plazo estricto de confirmación
  (`interactionsRequireAck`), así que el core confirma cada una exactamente una
  vez por ti: una confirmación diferida antes del primer envío del handler,
  poco antes del plazo de ~3 s o al terminar el handler, lo que ocurra antes.
  Llama a `ctx.acknowledge('texto')` antes de responder para contestar con un
  texto inmediato; una vez enviada la confirmación automática,
  `ctx.acknowledge('texto')` envía `texto` como respuesta normal y
  `ctx.acknowledge()` no hace nada.
- `ctx.interaction.id` es el id de la interacción a secas: su token no sale
  del provider. Como red de seguridad, el provider también difiere cualquier
  interacción que siga sin respuesta tras `autoAcknowledgeMs` (2000 ms por
  defecto; `false` lo desactiva). Un `ctx.acknowledge('texto')`
  tardío, ya confirmada, sale como followup, con `appId` o, si falta, con el id
  de aplicación que Discord manda en READY y en cada interacción; si no se
  conoce ninguno, la llamada rechaza con `ProviderError` en vez de descartar el
  texto.
- Más de 25 botones (5 filas de 5), 25 opciones de menú o 10 respuestas de
  encuesta rechazan con `UnsupportedContentError` en vez de descartar opciones;
  el texto de más de 2000 caracteres se divide en varios mensajes.
- Cada llamada REST vence tras `requestTimeoutMs` (60 s por defecto); las
  subidas de archivos, tras `uploadTimeoutMs` (5 min).
- Los mensajes de sistema (entradas al servidor, fijados, boosts...) y los de
  bots no se enrutan. Un mensaje sin texto ni archivo llega como `sticker` (con
  la imagen del sticker como media) o `unknown` (solo embeds, o el intent Message
  Content desactivado), nunca como texto vacío.
- Todo mensaje que envía el provider lleva `allowed_mentions` (por defecto
  `{ parse: ['users'] }`, opción `allowedMentions`), así que un texto que el bot
  repite no puede mencionar a `@everyone`, `@here` ni a un rol;
  `SendOptions.mentions`, `platformData.allowed_mentions` y los payloads `native`
  lo sustituyen. Una respuesta citada sigue notificando al autor del mensaje
  citado (`replied_user: true`; `allowedMentions.replied_user: false` responde
  sin notificar).
- Los ids van en las URLs REST codificados, y un id vacío, `.` o `..` rechaza
  con `ProviderError`: un id manipulado nunca llega a otra ruta. Los votos de las
  encuestas nativas no llegan como eventos.
- Un mensaje reenviado trae el texto y la media reenviados (de su snapshot),
  no una respuesta citada; si no tiene nada legible llega como `unknown`. Una
  encuesta nativa llega como `type: 'poll'` con la pregunta como cuerpo.
- **Mensajes editados** (`MESSAGE_UPDATE` con `edited_timestamp`) llegan como
  mensajes con el texto nuevo y el `ref.id` original; `isEditedMessage(ctx)` de
  `@botmesh/discord` los distingue y `editedMessages: 'ignore'` los descarta. Las
  demás actualizaciones (previsualizaciones de enlaces, fijados, flags) no se
  enrutan: el provider entrega una edición una sola vez por `edited_timestamp`
  (recuerda el último de los 1000 mensajes editados más recientes), así que fijar
  un mensaje editado no lo vuelve a entregar.

[README](https://github.com/andresayac/botmesh/tree/main/packages/discord-provider)

### `@botmesh/evolution`

[Evolution API](https://github.com/EvolutionAPI/evolution-api) v2, un
gateway REST de WhatsApp self-hosted construido sobre Baileys. Salida: REST
con la cabecera `apikey`. Entrada: el webhook de la instancia, autenticado con
un secreto compartido en cabecera o con el `jwt_key` de Evolution (JWT HS256).

```bash
pnpm add @botmesh/core @botmesh/evolution   # durante la beta: @beta en ambos
```

```ts
import { EvolutionProvider } from '@botmesh/evolution'

const provider = new EvolutionProvider({
  baseUrl: 'http://localhost:8080',
  apiKey: process.env.EVOLUTION_API_KEY!,
  instance: 'my-instance',
  webhookSecret: process.env.EVOLUTION_WEBHOOK_SECRET!, // or webhookJwtKey
})
// POST /webhook/evolution → res.sendStatus(provider.ingest(body, headers))
```

- `start()` comprueba la instancia; si no está vinculada, el QR o el código
  de emparejamiento llega en la actualización `connection` (`authPayload`).
- Los gemelos LID/PN que envía Evolution se enlazan antes de emitir; pasa
  `identityPersistence` para mantener los ids estables entre reinicios.
- Encuestas, reacciones, edición (texto), escribiendo y confirmaciones de
  lectura; botones, listas y cards se degradan a texto numerado; `template`
  se rechaza, igual que una encuesta que WhatsApp no puede llevar (menos de 2
  o más de 12 opciones, vacías o repetidas).
- Si Evolution deja de ofrecer códigos QR antes de vincular el número
  (`QRCODE_LIMIT`), la actualización `connection` llega como `closed` con
  motivo `sessionInvalid`: llama otra vez a `start()` para obtener un QR nuevo.
- Deja desactivado `webhookByEvents` en el webhook de la instancia: con él,
  Evolution añade el nombre del evento a la URL y una ruta de path exacto
  responde 404.

[README](https://github.com/andresayac/botmesh/tree/main/packages/evolution-provider)

### `@botmesh/wppconnect`

[WPPConnect Server](https://github.com/wppconnect-team/wppconnect-server), un
gateway self-hosted sobre WhatsApp Web (WA-JS). REST con token Bearer;
webhooks autenticados con un token en la URL del webhook.

```bash
pnpm add @botmesh/core @botmesh/wppconnect   # durante la beta: @beta en ambos
```

```ts
import { WPPConnectProvider } from '@botmesh/wppconnect'

const provider = new WPPConnectProvider({
  baseUrl: 'http://localhost:21465',
  session: 'my-bot',
  secretKey: process.env.WPP_SECRET_KEY!,       // or token: '<generated bearer>'
  webhookToken: process.env.WPP_WEBHOOK_TOKEN!, // webhook URL: …/webhooks/wpp?token=<it>
})
// POST /webhooks/wpp → res.sendStatus(await provider.ingest(body, headers, req.originalUrl))
```

- `ingest()` es **asíncrono** y recibe la URL de la petición como tercer
  argumento, porque wppconnect-server no puede añadir cabeceras: el token
  viaja en la query string.
- Los LID desconocidos se resuelven a número de teléfono (`contact/pn-lid`)
  antes de emitir.
- `markRead` marca el chat entero como leído; botones y listas se degradan a
  texto numerado.
- La conexión sigue los webhooks `status-find` del servidor: `isLogged` /
  `qrReadSuccess` → `ready`, `notLogged` y `qrcode` → `authenticating`, y
  desvincular el dispositivo desde el teléfono (`disconnectedMobile`) →
  `closed` con `sessionInvalid`. `bot.stop()` no cierra la sesión en el
  servidor.

[README](https://github.com/andresayac/botmesh/tree/main/packages/wppconnect-provider)

### `@botmesh/twilio`

Twilio Programmable Messaging: **WhatsApp y SMS/MMS** con una sola clase.
Webhooks verificados con `X-Twilio-Signature`, que cubre la URL pública
exacta.

```ts
import { TwilioProvider } from '@botmesh/twilio'

const provider = new TwilioProvider({
  accountSid: process.env.TWILIO_SID!,
  authToken: process.env.TWILIO_TOKEN!,           // signs webhooks + REST auth
  whatsappFrom: 'whatsapp:+14155238886',
  smsFrom: '+15017122661',
  webhookUrl: 'https://bot.example.com/twilio/webhook', // EXACT URL set in Twilio
})
```

- `chatId` es el `From` de Twilio tal cual (`whatsapp:+57…` o `+57…`): la
  misma persona por WhatsApp y por SMS son dos chats.
- Texto de hasta 1600 caracteres; media solo desde URLs públicas; botones y
  listas pasan a texto numerado; `template` se traduce a `ContentSid` +
  `ContentVariables`.
- `ingestRequest({ url, body, headers })` para URLs que cambian por petición
  (multi-tenant). Con `webhookPath` (la URL se reconstruye con las cabeceras
  `Host` / `X-Forwarded-*`), pasa la ruta y la query de la petición como
  tercer argumento de `ingest()` (`@botmesh/server` ya lo hace): así la query
  con la que llamó Twilio entra en la URL firmada.
- El error 63016 se traduce a `OutsideSessionWindowError`.
- Un mensaje con varios adjuntos (`NumMedia` > 1, hasta 10) llega como **un
  mensaje por adjunto**, en orden: el primero conserva el `MessageSid` y el
  texto (`Body`); el adjunto `i` lleva el id `MessageSid:i` y cuerpo vacío
  (ids únicos y estables ante reintentos del webhook).

[README](https://github.com/andresayac/botmesh/tree/main/packages/twilio-provider)

### `@botmesh/gohighlevel`

HighLevel (GoHighLevel / LeadConnector) Conversations API. Entrada por el
webhook `InboundMessage` (Ed25519, `X-GHL-Signature`), salida con
`POST /conversations/messages` por el último canal que usó el contacto.

```ts
import { GoHighLevelProvider } from '@botmesh/gohighlevel'

const provider = new GoHighLevelProvider({
  accessToken: process.env.GHL_TOKEN!,         // Private Integration Token
  locationId: process.env.GHL_LOCATION_ID!,
  // defaultChannel: 'SMS',                    // until the contact writes
})
```

- `chatId` = `contactId` de HighLevel: un chat por contacto en todos los
  canales; el canal de cada mensaje está en `ctx.chat.platformData.channel`.
- La clave pública de HighLevel viene incluida (`GHL_WEBHOOK_PUBLIC_KEY`),
  así que no hace falta secreto de webhook. `ingest()` necesita el body
  **crudo**.
- Media solo desde URLs públicas; `template` se traduce a `templateId`.

[README](https://github.com/andresayac/botmesh/tree/main/packages/gohighlevel-provider)

### `@botmesh/gupshup`

Gupshup WhatsApp API: endpoints de envío v1 y callbacks v2. Gupshup no firma
los callbacks, así que se autentican con un token compartido en la URL del
callback (o en una cabecera).

```ts
import { GupshupProvider } from '@botmesh/gupshup'

const provider = new GupshupProvider({
  apiKey: process.env.GUPSHUP_API_KEY!,
  appName: 'MyBotApp',
  source: '917834811114',                          // the app's number
  webhookToken: process.env.GUPSHUP_WEBHOOK_TOKEN!, // callback: …/gupshup?token=<it>
})
// POST /gupshup → res.sendStatus(provider.ingestRequest({ url: req.originalUrl, body, headers }))
```

- Los botones salen como quick replies (hasta 3), después como lista (hasta
  10) y después como texto numerado; las listas son nativas hasta 10 filas. El
  botón de la lista de los botones degradados usa `listButtonText` (por defecto
  `'Options'`, máximo 20 caracteres; `'Opciones'` para un bot en español).
- `chatId` = los dígitos del teléfono del remitente (sin `+`), justo lo que
  espera la API de envío.
- Media solo desde URLs públicas. Gupshup también documenta restringir por
  IP: haz ambas cosas en producción.

[README](https://github.com/andresayac/botmesh/tree/main/packages/gupshup-provider)

### `@botmesh/email`

Email: **IMAP IDLE** para recibir y **SMTP** para responder. Cada hilo de
correo es un chat, así que los flujos con `ask()` continúan cuando el cliente
responde al email. `imapflow` y `nodemailer` son peer dependencies opcionales
que se cargan de forma lazy.

```ts
import { EmailProvider } from '@botmesh/email'

const provider = new EmailProvider({
  address: 'support@acme.com',
  imap: { host: 'imap.example.com', user: 'support@acme.com', pass: process.env.IMAP_PASS! },
  smtp: { host: 'smtp.example.com', user: 'support@acme.com', pass: process.env.SMTP_PASS! },
})
```

- `threading: 'thread'` (por defecto, un chat por hilo) o `'sender'` (un chat
  por dirección); persiste los hilos con `threadStore: cursorThreadStore(store)`.
  Ese store guarda también el cursor de UID del buzón, así que tras un
  reinicio el bot sigue después del último mensaje que procesó y no vuelve a
  entregar correo (ni siquiera con `markSeen: false`).
- Protección contra bucles de respuestas automáticas y listas de correo,
  gestión de rebotes (eventos `status: 'failed'`, supresión de direcciones con
  rebote permanente).
- El email no autentica `From` por sí mismo: usa
  `requireAuthentication: { authservId }` para aceptar solo correo que tu MTA
  haya autenticado.
- Sin IMAP, `ingest(rawMime)` acepta el MIME crudo de un webhook de correo
  entrante y resuelve `{ status, accepted, reason? }`.
- El transporte creado desde `smtp` se cierra en `stop()` y se reconstruye
  en el siguiente envío (también con pool); un `smtpTransport` inyectado es
  tuyo y `stop()` nunca lo cierra.

[README](https://github.com/andresayac/botmesh/tree/main/packages/email-provider)

### `@botmesh/tiktok` (aún no en npm)

TikTok API for Business (v1.3): **comentarios** en los videos propios de la
cuenta y **mensajes directos** (Business Messaging API, requiere aprobación).
Webhooks verificados con `TikTok-Signature`.

```ts
import { TikTokProvider } from '@botmesh/tiktok'

const provider = new TikTokProvider({
  accessToken: process.env.TIKTOK_TOKEN!,             // or an async refresh function
  businessId: process.env.TIKTOK_BUSINESS_ID!,        // open_id of the account
  appSecret: process.env.TIKTOK_APP_SECRET!,          // verifies TikTok-Signature
  selfUniqueIdentifier: process.env.TIKTOK_SELF_UID!, // required to receive comments
})
```

- Chats: `dm:<conversation_id>` (DM), `comment:<video_id>:<comment_id>`
  (hilo de un comentario, un chat de grupo) y `hic:<comment_id>` (comentario
  de alta intención). `ctx.chat.platformData.surface` los distingue.
- DMs: texto (hasta 6000 caracteres), imágenes, tarjetas Q&A para los
  botones (de 1 a 3); comentarios: respuestas de texto de hasta 150
  caracteres. Los botones o listas que no caben en una tarjeta Q&A (más de 3
  opciones, botones con URL, títulos de más de 40 caracteres) y los menús
  enviados a un hilo de comentarios se degradan a un menú de texto numerado,
  como en Baileys.
- El bot no puede iniciar una conversación y TikTok limita los mensajes por
  ventana de 48 h (`OutsideSessionWindowError`).

[README](https://github.com/andresayac/botmesh/tree/main/packages/tiktok-provider)

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
  `toTelegramError`, `toDiscordError`, `toMessengerError`, `toInstagramError`,
  `toTikTokError`; `toEmailProviderError` → `toEmailError`; el `toProviderError` de
  `@botmesh/meta` → `toGraphError` de `@botmesh/graph-core`.

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
