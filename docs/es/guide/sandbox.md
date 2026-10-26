# Sandbox de plataformas

`@botmesh/sandbox` simula las plataformas de mensajería en tu máquina para probar un bot en
todos los canales de extremo a extremo, sin registrar una app, un número ni un webhook público.

El [simulador de la terminal](./simulador.md) reemplaza el provider por uno en memoria. El
sandbox hace lo contrario: conserva el **provider real** y reemplaza la **plataforma**. Tu bot
habla por HTTP real con un servidor local que responde como WhatsApp, Telegram o Twilio. Ese
servidor entrega webhooks firmados con un secreto que él mismo elige, así que la verificación de
firmas, el mapeo de errores, la descarga de media y los reintentos pasan por el mismo código que
en producción.

::: info Paquete privado
`@botmesh/sandbox` vive en el monorepo y no se publica en npm. Úsalo desde un clon:
`pnpm install && pnpm build`.
:::

## Canales

| Canal | Provider | Entrada | Autenticación del webhook |
| --- | --- | --- | --- |
| WhatsApp Cloud API | `@botmesh/meta` | webhook + handshake GET | `X-Hub-Signature-256` |
| Messenger | `@botmesh/messenger` | webhook | `X-Hub-Signature-256` |
| Instagram DM | `@botmesh/instagram` | webhook | `X-Hub-Signature-256` |
| Twilio (WhatsApp, SMS) | `@botmesh/twilio` | webhook de formulario + callbacks de estado | `X-Twilio-Signature` |
| Gupshup | `@botmesh/gupshup` | callbacks v2 | token compartido |
| HighLevel | `@botmesh/gohighlevel` | `InboundMessage` | `X-GHL-Signature` (Ed25519) |
| TikTok | `@botmesh/tiktok` | DMs y comentarios | `TikTok-Signature` |
| Discord | `@botmesh/discord` | WebSocket del Gateway v10 | token del bot |
| Telegram | `@botmesh/telegram` | `getUpdates` o webhook | `X-Telegram-Bot-Api-Secret-Token` |

Cada simulador es un servidor `node:http` pequeño (Discord añade un gateway WebSocket en el mismo
puerto). Cada provider apunta a él con la opción de URL base que ya tenía: `graphUrl` (Meta,
Messenger, Instagram), `apiUrl` y `gatewayUrl` (Discord), `baseUrl` (Telegram, Gupshup,
HighLevel), `apiBaseUrl` (Twilio, TikTok). `sim.providerConfig()` devuelve esa configuración,
incluidas las opciones de descarga de media que permiten `http://127.0.0.1`.

## El chat web

```bash
pnpm build
pnpm sandbox
# → abre http://127.0.0.1:4610
```

El comando arranca los nueve simuladores, un bot por canal y una página web (un único HTML
estático, sin build). Elige un canal en la barra lateral y escribe como usuario. Puedes enviar
archivos (📎), compartir una ubicación (📍), pulsar botones y filas de listas y responder
encuestas. Ves las respuestas del bot como las mostraría la plataforma, con los checks de
entregado y leído.

El inspector de la derecha tiene tres pestañas:

- **API requests:** cada llamada del provider, con su estado y cualquier diferencia con la
  forma documentada de la petición.
- **Webhooks:** cada entrega al bot, con su estado HTTP y el número de intento.
- **Faults & user:** hace fallar el siguiente envío con un error de la plataforma (límite de
  tasa, destinatario inválido, fuera de la ventana de 24 h, media demasiado grande,
  autenticación, error del servidor). Aquí también se cambian el id y el nombre del usuario
  simulado.

Opciones:

```bash
pnpm --filter @botmesh/sandbox start -- --help
pnpm --filter @botmesh/sandbox start -- --channels whatsapp,telegram --port 4620
pnpm --filter @botmesh/sandbox start -- --bot bakery      # examples/bakery-ai con un modelo guionizado
pnpm --filter @botmesh/sandbox start -- --telegram webhook --no-status
```

### API solo local

La página habla con el hub mediante una pequeña API JSON. Cualquier web que abras en el mismo
navegador también podría llegar a `127.0.0.1`, así que la API se protege:

- Escucha en `127.0.0.1` por defecto. `--host` lo cambia, y la CLI avisa si la dirección no
  es de loopback. `--host` solo mueve el hub: los simuladores siguen siempre en
  `127.0.0.1`, porque, como las APIs de proveedor que imitan, no comprueban ni `Host` ni
  token.
- Toda petición debe llevar una cabecera `Host` de loopback con el puerto del hub
  (`127.0.0.1`, `localhost` o `[::1]`, más los nombres de `--allow-host`/`allowedHosts`).
  Eso frena el DNS rebinding, en el que un dominio hostil pasa a apuntar a 127.0.0.1. Si el
  navegador envía `Origin` o `Sec-Fetch-Site`, tiene que ser el origen del propio hub.
- Las llamadas que cambian estado (`POST /api/<canal>/send|fault|status|reset`) necesitan
  además el token de la ejecución en la cabecera `x-sandbox-token`. La CLI lo imprime al
  arrancar y el hub lo inserta en la página que sirve. `--token` (o
  `startSandbox({ token })`) lo fija para scripts, y `sandbox.token` lo devuelve desde código.
- Los cuerpos están acotados (32 MiB para `send`, 64 KiB en el resto). Un JSON mal formado,
  campos desconocidos, tipos erróneos o canales que no existen reciben un 4xx con
  `{ "error": "..." }` que nombra el problema, y un simulador que no puede expresar una
  entrada (una ubicación en Discord) responde 422.
- La media subida desde la página se sirve con `nosniff`, una CSP `sandbox` y, salvo
  imágenes, audio y vídeo normales, como descarga.

Los botones de una encuesta envían un voto nativo en los canales cuyo provider lo convierte en
un evento `'poll'` (`POLL_VOTE_PARSING` en `@botmesh/sandbox/providers`). En los demás
envían el texto de la opción. Los simuladores de Telegram y Discord ya entregan votos nativos
(`poll_answer`, `MESSAGE_POLL_VOTE_ADD`), pero sus providers aún no los interpretan. Un test
falla en cuanto uno lo haga, así que el conjunto se actualiza junto con el provider.

El **bot demo** (`--bot demo`, por defecto) responde a `hola`, `menu`, `ubicacion` y
`encuesta`, confirma la media y las ubicaciones que recibe, y pasa todo lo demás a `aiPlugin`
con un `MockAIProvider` guionizado (sin API key). `--bot bakery` ejecuta el
[ejemplo de la panadería](https://github.com/andresayac/botmesh/tree/main/examples/bakery-ai)
en los mismos canales.

Para usar tu propio bot, llama a `startSandbox()` desde código:

```ts
import { startSandbox } from '@botmesh/sandbox'

const sandbox = await startSandbox({
  bot: 'none',
  setup: (bot, channel) => {
    bot.when('hola', (ctx) => ctx.reply(`Hola desde ${channel}`))
  },
})
console.log(sandbox.url)
```

## En tests

`startHarness()` arranca el simulador, la entrada de webhooks del bot (`@botmesh/server`) y un
`Bot` sobre el provider real:

```ts
import { CloudAPIProvider } from '@botmesh/meta'
import { RateLimitedError } from '@botmesh/core'
import { WhatsAppSimulator, startHarness } from '@botmesh/sandbox'

const h = await startHarness(
  new WhatsAppSimulator(),
  (sim) => new CloudAPIProvider(sim.providerConfig()),
  (bot) => {
    bot.when('menu', (ctx) => ctx.buttons('Elige uno', [{ id: 'pan', title: 'Pan' }]))
    bot.when('pan', (ctx) => ctx.reply('Buena elección'))
  },
)

await h.sim.sendText('menu')                                   // webhook firmado → bot
const menu = await h.sim.waitForOutbound((r) => r.kind === 'buttons')
await h.sim.send({ reply: { kind: 'button', id: 'pan', messageId: menu.id } })
await h.sim.waitForOutbound((r) => r.text === 'Buena elección')
expect(h.sim.issues()).toEqual([])                             // cada petición cumplió la documentación

h.sim.fail('rateLimit', { retryAfterSec: 30 })                 // siguiente envío: 429 + Retry-After
await h.stop()
```

Lo que puede hacer un usuario simulado (`sim.send(input)`): `text`, `media` (`{ kind, data,
mimetype, filename, caption }`), `location`, `reply` (botón o fila de lista), `edit` (Telegram,
Messenger), `pollVote` (Telegram, Discord) y `quotedId`. Cada mensaje que envía el provider se normaliza
en un `OutboundRecord` (`kind`, `text`, `buttons`, `sections`, `media`, `location`, `template`,
`poll`, `action`) y conserva la petición original.

### Validación contra la especificación

Cada simulador valida las peticiones que recibe contra la forma documentada de la plataforma:
campos obligatorios, enumerados, longitudes y cantidades. Por ejemplo, el texto de WhatsApp de
4096 caracteres, 3 botones de respuesta con títulos de 20 caracteres, 10 filas de lista, el `To`
de Twilio más `From` o `MessagingServiceSid` más un cuerpo, el contenido de 2000 caracteres y las
5 filas de componentes de Discord, y el `callback_data` de 64 bytes de Telegram. Los esquemas
usan un subconjunto de JSON Schema.

Twilio y Discord publican documentos OpenAPI oficiales con licencia MIT, así que sus
simuladores validan además cada petición de crear mensaje (y las ediciones y los followups de
webhook de Discord) contra fragmentos de [twilio-oai](https://github.com/twilio/twilio-oai) y
[discord-api-spec](https://github.com/discord/discord-api-spec). Esos problemas llevan la
etiqueta `[openapi]`. Los fragmentos están copiados en `packages/sandbox/src/specs/` con sus
licencias y commits, así que los tests nunca usan la red. `scripts/vendor-openapi.mjs` los
regenera desde copias descargadas. Meta, Gupshup, HighLevel, TikTok y Telegram no publican una
especificación oficial legible por máquina, así que sus esquemas siguen escritos a mano a partir
de la documentación.

En modo estricto, el predeterminado, una petición inválida recibe el error de validación propio
de la plataforma. Con `strict: false` se acepta y solo aparece en `sim.issues()`.

### Escenarios

| Helper | Simula |
| --- | --- |
| `duplicate(sim, input, n)` | el mismo evento entregado `n` veces (un reintento de la plataforma tras perder el 200) |
| `outOfOrder(sim, inputs)` | eventos creados en orden y entregados del más nuevo al más viejo |
| `burst(sim, inputs)` | eventos simultáneos de uno o varios usuarios |
| `expiredMedia(sim, input)` | una URL de media que ya caducó cuando el bot la descarga |
| `statusSequence(sim, id)` | enviado → entregado → leído para un mensaje del bot |

Las opciones del simulador cubren el resto:

- `webhookRetries` / `webhookRetryDelayMs`: reentrega cuando el bot no responde 2xx.
- `mediaTtlMs`: las URLs de media entrante caducan.
- `autoStatus: 'read'`: confirmaciones tras cada mensaje del bot.
- `strict`: responde a las peticiones inválidas con el error de validación de la plataforma (por
  defecto `true`).

### Errores

`sim.fail(kind, { times, match, retryAfterSec })` responde con el formato de la propia
plataforma. El provider debe entonces rechazar con la subclase tipada de `ProviderError`:

| Fallo | WhatsApp | Twilio | Telegram | Discord | Error tipado |
| --- | --- | --- | --- | --- | --- |
| `rateLimit` | 429, código 130429 | 429, código 20429 | 429, `retry_after` | 429, `retry_after` | `RateLimitedError` |
| `invalidRecipient` | código 131026 | código 21211 | 400 chat not found | 50007 | `RecipientUnreachableError` |
| `outsideWindow` | código 131047 | código 63016 | 403 bot bloqueado¹ | 50001 Missing Access¹ | `OutsideSessionWindowError` |
| `mediaTooLarge` | 413, código 131053 | código 11751 | 413 | 413, código 40005 | `PayloadTooLargeError` |
| `auth` | 401, código 190 | 401, código 20003 | 401 | 401 | `ProviderError` |

¹ Telegram y Discord no tienen ventana de mensajería: su respuesta más parecida se mapea a
`RecipientUnreachableError`.

El core reintenta en el sitio un `ctx.reply` que recibe un `Retry-After` corto (5 s como
máximo), así que las suites de extremo a extremo usan `retryAfterSec: 30` para ver el error.

::: tip Interacciones en Discord y Telegram
En Discord (`interactionsRequireAck`) el core confirma cada interacción por su cuenta: una
confirmación diferida (`interaction_callback:6`) antes de la primera respuesta del handler, poco
antes del plazo de 3 s o al terminar el handler, salvo que el handler haya llamado antes a
`ctx.acknowledge(texto)` (`interaction_callback:4`). En Telegram la confirmación es opcional, así
que sin `ctx.acknowledge()` el botón se queda con el indicador de carga. El sandbox registra cada
confirmación como un registro `action`.
:::

## Plataformas autoalojadas en Docker

Algunas plataformas se pueden ejecutar en local: Evolution API, WPPConnect Server, Chatwoot y
Mailpit. Sus suites opcionales están en `packages/sandbox/tests/docker/` y se saltan si no se
definen las variables:

```bash
docker compose -f packages/sandbox/docker/compose.yml up -d
docker compose -f packages/sandbox/docker/compose.yml run --rm chatwoot-init   # la primera vez
node packages/sandbox/docker/chatwoot-token.mjs                                # imprime las variables de Chatwoot

BOTWA_TEST_EVOLUTION_URL=http://127.0.0.1:47811 BOTWA_TEST_EVOLUTION_KEY=sandbox-evolution-key \
BOTWA_TEST_WPPCONNECT_URL=http://127.0.0.1:47812 BOTWA_TEST_WPPCONNECT_SECRET=sandbox-wppconnect-secret \
BOTWA_TEST_MAILPIT_URL=http://127.0.0.1:47814 \
BOTWA_TEST_CHATWOOT_URL=… BOTWA_TEST_CHATWOOT_TOKEN=… BOTWA_TEST_CHATWOOT_ACCOUNT_ID=… \
  pnpm --filter @botmesh/sandbox exec vitest run tests/docker
```

| Suite | Cubre |
| --- | --- |
| Evolution API | salud; creación de la instancia con un webhook que envía el secreto compartido; los webhooks de QR y de conexión llegan al bot por `@botmesh/server` y se aceptan; `start()` informa del QR; errores tipados con una instancia sin emparejar y con una API key incorrecta; los webhooks falsificados reciben 401 |
| WPPConnect Server | token a partir de la clave secreta; inicio de la sesión con el token del webhook en la query de la URL; el QR llega al bot; errores tipados con una sesión sin emparejar y con una clave incorrecta |
| Chatwoot | ida y vuelta completa con `@botmesh/chatwoot`: los mensajes del usuario y del bot aparecen en una conversación; la respuesta de un agente publicada por la API de Chatwoot vuelve por el webhook del propio Chatwoot, llega al usuario y pasa el chat a un humano; al resolver la conversación el bot se reanuda |
| Mailpit | los envíos SMTP de `@botmesh/email` comprobados con la API de Mailpit (identidad, `Auto-Submitted`, adjuntos). La entrada por IMAP la cubre la suite de GreenMail de `@botmesh/email` |

Los contenedores llegan al servidor de webhooks del test por `host.docker.internal`. Define
`BOTWA_TEST_DOCKER_HOST` si tu Docker usa otro nombre. Todos los puertos se publican solo en
`127.0.0.1`. WPPConnect Server está fijado en `1.3.50`: la `1.3.55` (`latest` en octubre de 2026)
descarta el QR de una sesión iniciada por la API REST y solo llama a URLs de webhook de una lista
permitida (`WEBHOOK_ALLOWED_URLS`).

### Lo que sigue siendo manual

Emparejar un número de WhatsApp real (escanear el QR de Evolution o WPPConnect, o el código de
emparejamiento de Baileys) necesita un teléfono, así que sigue siendo manual:

1. Arranca el stack y llama a `start()` en el provider (o crea la instancia desde el manager de
   Evolution en `http://127.0.0.1:47811/manager`).
2. Escanea el QR desde **WhatsApp → Dispositivos vinculados** en un teléfono de pruebas.
3. Vuelve a ejecutar las suites. Con la instancia en `open` también funciona el envío. Las
   suites solo necesitan que la instancia exista.

Nunca apuntes las suites de Docker a un Chatwoot de producción ni a un número de producción
emparejado: crean bandejas, webhooks e instancias y los borran al terminar.
