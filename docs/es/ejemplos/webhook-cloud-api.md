# Servidor de webhooks para la Cloud API de WhatsApp

Pon en producción la Cloud API oficial de WhatsApp solo con `node:http`: el
handshake de verificación de Meta, webhooks firmados comprobados sobre los
bytes crudos, un límite de tamaño, un health check y mensajes proactivos que
recurren a una plantilla aprobada fuera de la ventana de 24 horas.

**Nivel:** Avanzado · **Etiquetas:** WhatsApp, Cloud API, Webhooks, Seguridad, Plantillas

**Funcionalidades:**
[Provider de la Cloud API de WhatsApp](/es/guide/canales) (`@botmesh/meta`: `ingest`, `verifyChallenge`, `appSecret`) ·
[Ventana de 24 h y plantillas](/es/guide/ventana-24h) (`OutsideSessionWindowError`, `kind: 'template'`) ·
[Enviar fuera de un handler](/es/guide/mensajes) (`bot.send`) ·
[Flujos](/es/guide/flujos) (`.ask` con `validate`) ·
[Seguridad](/es/guide/seguridad) ·
[Apagado ordenado](/es/guide/deploy#apagado-ordenado) ·
[Simulador en la terminal](/es/guide/simulador)

## Requisitos previos

- Node.js 22.12 o superior y un proyecto ESM (`"type": "module"`), como en
  [Inicio rápido](/es/guide/inicio#requisitos). Mientras botmesh esté en
  prerelease, lee allí la nota sobre qué etiqueta de npm instalar.
- Una app de Meta con el producto WhatsApp: un token de acceso, el id del
  número de teléfono, el app secret y un verify token que eliges tú. Una
  plantilla aprobada llamada `order_shipped`, en español, con un parámetro en
  el cuerpo.
- Una URL pública HTTPS que llegue al puerto 3000 (un proxy inverso, o un
  túnel mientras desarrollas).

```bash
npm install @botmesh/core @botmesh/meta
```

## El servidor completo

```js
// server.js
import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { Bot, OutsideSessionWindowError, defineBot, flow, isMainModule } from '@botmesh/core'
import { CloudAPIProvider } from '@botmesh/meta'

// 1. El bot: una fábrica, así `npx botmesh dev server.js` lo ejecuta sin Meta
const createBot = defineBot((provider) => {
  const bot = new Bot({ provider, lang: 'es' })
  bot.when(['hola', 'buenas'], (ctx) => ctx.reply('👋 ¡Hola! Soy el mostrador de pedidos. Envía "pedido" para seguir un pedido.'))
  bot.use(
    flow('pedido')
      .ask('¿Cuál es tu número de pedido?', 'order', {
        validate: (body) => (/^\d{4,8}$/.test(body.trim()) ? true : '❌ Los números de pedido tienen de 4 a 8 dígitos.'),
      })
      .say((_ctx, c) => `📦 Estamos preparando el pedido ${c.state.order.trim()}. Te escribo cuando salga.`),
  )
  bot.onMessage((ctx) => ctx.reply('Envía "pedido" para seguir un pedido.'))
  return bot
})

export default createBot

// 2. Los bytes crudos del body, con límite de tamaño: Meta firma exactamente estos bytes
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

// 3. Texto libre dentro de la ventana de 24 h; fuera de ella, una plantilla aprobada
export async function notifyShipped(bot, chatId, order) {
  try {
    await bot.send(chatId, `🚚 ¡Tu pedido ${order} ya salió!`)
    return 'text'
  } catch (err) {
    if (!(err instanceof OutsideSessionWindowError)) throw err
    await bot.send(chatId, {
      kind: 'template',
      name: 'order_shipped',
      language: 'es',
      components: [{ type: 'body', parameters: [{ type: 'text', text: order }] }],
    })
    return 'template'
  }
}

// 4. El servidor HTTP: el handshake de Meta, webhooks firmados, una ruta interna de aviso y un health check
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
        // Handshake de suscripción: devuelve hub.challenge si hub.verify_token coincide
        const challenge = provider.verifyChallenge(Object.fromEntries(url.searchParams))
        return challenge === null ? reply(403) : reply(200, challenge)
      }
      if (url.pathname === '/webhook' && req.method === 'POST') {
        // Bytes crudos + cabeceras: ingest() comprueba X-Hub-Signature-256 y devuelve el status a responder
        const raw = await readRawBody(req)
        return reply(provider.ingest(raw, req.headers))
      }
      if (url.pathname === '/notify/shipped' && req.method === 'POST') {
        // La llama tu backend, nunca Meta: protegida con un token compartido
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

// 5. Entrada de producción: `node server.js` detrás de HTTPS (un proxy inverso o un túnel)
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
    server.close() // deja de aceptar webhooks; Meta reintenta lo que no pudo entregar
    await bot.stop({ drain: true, timeout: '10s' })
  })
}
```

## Cómo funciona

### 1. El bot es una fábrica

La conversación vive en `createBot`, que recibe su provider. `npx botmesh dev
server.js` importa la fábrica e inyecta el simulador de la terminal, así que
iteras sobre las respuestas sin Meta, tokens ni URL pública. La conexión con
la Cloud API solo corre bajo `isMainModule` (paso 5).

### 2. Bytes crudos, nunca JSON re-serializado

Meta firma **exactamente los bytes** que envía con tu app secret
(`X-Hub-Signature-256`). `readRawBody` los junta en un `Buffer`, con un límite
de 1 MiB, y `provider.ingest(raw, req.headers)` comprueba la firma antes de
parsear. Parsear el body y volver a serializarlo (lo que hace un body parser
de JSON) cambia los bytes y la firma deja de coincidir: no pongas
`express.json()` ni nada parecido delante del webhook.

### 3. La ventana de 24 horas

En la Cloud API, los mensajes libres solo llegan a un usuario dentro de las
24 horas siguientes a su último mensaje. Fuera de ella, Meta rechaza el envío
con el error `131047`, que el provider convierte en
`OutsideSessionWindowError`; entonces el servidor envía la plantilla aprobada
`order_shipped`, que siempre está permitida. Para que el provider lleve la
cuenta de la ventana, ponga el mensaje en cola y lo reintente cuando el
usuario responda, configura su opción
[`sessionWindow`](/es/guide/ventana-24h#activar-el-gestor).

### 4. Las rutas

| Petición | Respuesta |
| --- | --- |
| `GET /webhook?hub.mode=subscribe&hub.verify_token=<el tuyo>&hub.challenge=<n>` | `200` con el challenge (la comprobación de suscripción de Meta); `403` con otro token |
| `POST /webhook` con un `X-Hub-Signature-256` válido | `200`: los eventos llegan al bot |
| `POST /webhook` sin firma, falsificado o re-serializado | `403`: nada llega al bot |
| `POST /webhook` de más de 1 MiB | `413` |
| `POST /notify/shipped` con `Authorization: Bearer <ADMIN_TOKEN>` y `{ "chatId", "order" }` | `200` con `text` o `template` (lo que salió) |
| `POST /notify/shipped` sin el token / con JSON inválido | `401` / `400` |
| `GET /healthz` | `200 ok` |

`ingest()` vuelve nada más despachar los eventos, así que Meta recibe su `200`
al momento mientras los handlers corren. El token de administración se compara
en tiempo constante y la ruta solo acepta 4 KiB.

### 5. Ponerlo en marcha

`env()` detiene el proceso al arrancar con una línea clara cuando falta una
variable, en vez de un error del provider más tarde. `appSecret` activa la
comprobación de firma: nunca despliegues sin él (ni pongas
`allowUnsignedWebhooks`). Con `SIGTERM` el servidor deja de aceptar webhooks
(Meta reintenta lo que no pudo entregar) y el bot drena las respuestas en
curso.

`@botmesh/server` (en npm desde la beta) empaqueta el mismo
ingress con límites de concurrencia, timeouts y adaptadores para Express,
Fastify y Hono: mira [Servidor de webhooks](/es/guide/servidor).

## Transcripción de ejemplo

La conversación, capturada con `npx botmesh dev server.js`:

```text
user › hola
bot › 👋 ¡Hola! Soy el mostrador de pedidos. Envía "pedido" para seguir un pedido.
user › pedido
bot › ¿Cuál es tu número de pedido?
user › ABC
bot › ❌ Los números de pedido tienen de 4 a 8 dígitos.
user › 20931
bot › 📦 Estamos preparando el pedido 20931. Te escribo cuando salga.
user › gracias
bot › Envía "pedido" para seguir un pedido.
```

En la Cloud API, las mismas respuestas salen por la Graph API.

## Ejecutarlo en WhatsApp

```bash
META_TOKEN=... META_PHONE_ID=... META_VERIFY_TOKEN=... META_APP_SECRET=... ADMIN_TOKEN=... node server.js
```

En el panel de la app de Meta, pon como URL de callback
`https://<tu-dominio>/webhook` con el mismo verify token y suscríbete al campo
`messages`. Después escribe al número de empresa desde WhatsApp y llama a la
ruta de aviso desde tu backend:

```bash
curl -X POST https://<tu-dominio>/notify/shipped -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"chatId":"573001112233","order":"20931"}'
```

## Siguientes pasos

- [Ventana de 24 h y precios](/es/guide/ventana-24h): el gestor de la ventana, uso y costes
- [Bot listo para producción](./bot-produccion): store, durabilidad, salud y Docker
- [Seguridad](/es/guide/seguridad): la checklist de producción para webhooks
