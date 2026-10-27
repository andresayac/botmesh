# Inicio rápido

Pasa de cero a un bot que te responde en unos cinco minutos. Pruébalo primero
en la terminal (sin teléfono ni cuentas) y luego conéctalo a WhatsApp o
Telegram sin cambiar el código del bot.

## Requisitos

- **Node.js 22.12 o superior** ([descargar](https://nodejs.org/)). Compruébalo con `node -v`.
- **npm** (viene con Node) o **pnpm**. Los comandos usan npm; con pnpm,
  escribe `pnpm add`, `pnpm create` y `pnpm exec`. Con pnpm 11, la primera
  instalación de `@botmesh/baileys` se detiene con `ERR_PNPM_IGNORED_BUILDS`;
  ver [Solución de problemas](#solucion-de-problemas).
- Para conectarlo de verdad: un teléfono con WhatsApp (su número pasa a ser el
  bot) o un token de bot de Telegram de [@BotFather](https://t.me/BotFather).
  El simulador de la terminal no necesita ninguno.

::: info Beta
botmesh está en beta: una instalación sin tag instala la beta, y `@beta` resuelve siempre a la más reciente (`latest` se mueve a mano tras cada publicación). Este sitio documenta la beta y después `@botmesh/core` 2.0.0 estable.
:::

## Opción A: generar un proyecto (recomendado) {#crear-un-proyecto-con-create-botmesh}

`create-botmesh` genera un proyecto que funciona en el simulador y en el canal
real:

```bash
npm create botmesh my-bot                                # pregunta la plantilla
npm create botmesh my-bot -- --template telegram --yes   # o elígela de entrada
cd my-bot
npm install
npm run dev     # chatea con el bot en la terminal (sin teléfono ni credenciales)
```

Escribe `hola`, luego `menu` y luego `/help`. Cuando te convenza, conecta el
canal real:

| Plantilla | Antes de `npm start` |
| --- | --- |
| `baileys` (por defecto) | Nada. Aparece un QR en la terminal: escanéalo como en [Vincular WhatsApp](#vincular-whatsapp). |
| `telegram` | Copia `.env.example` a `.env` y pega tu `TELEGRAM_TOKEN`. |
| `meta` | Rellena las cuatro variables `META_*` en `.env` y expón una URL pública para el webhook ([Servidor de webhooks](./servidor)). |
| `ai`, `ai-full` | Pon `ANTHROPIC_API_KEY` en `.env` y escanea el QR. |

```bash
npm start
```

Si al `.env` le falta una variable que el proyecto necesita, `npm start` se
detiene con una línea que la nombra (`Missing TELEGRAM_TOKEN: copy .env.example
to .env ...`) antes de conectar nada.

Las plantillas están escritas en español y fijan `lang: 'es'`. La lista
completa de plantillas, los flags de la CLI y los archivos generados están en
[Plantillas de proyecto](#plantillas-de-proyecto).

## Opción B: montarlo a mano

### 1. Instalar

```bash
mkdir my-bot && cd my-bot
npm init -y
npm pkg set type=module        # botmesh es solo ESM
npm install @botmesh/core @botmesh/baileys
```

Para Telegram, instala `@botmesh/telegram` en lugar de `@botmesh/baileys` y
usa la versión de `bot.js` para Telegram de
[O conectar Telegram](#o-conectar-telegram): el archivo de abajo importa
`@botmesh/baileys`, así que sin ese paquete no carga. botmesh solo publica módulos ES, así que el proyecto necesita
`"type": "module"` (o archivos `.mjs`) y los paquetes se cargan con `import`.

### 2. Escribir el bot

Crea `bot.js`. El bot es una **fábrica** (`defineBot`): recibe un provider y
devuelve el `Bot` configurado. Así el mismo archivo funciona en el simulador y
en el canal real:

```js
// bot.js
import { Bot, defineBot, flow, isMainModule, slashCommandsPlugin } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

const createBot = defineBot((provider) => {
  const bot = new Bot({ provider, lang: 'es' })

  // Comandos integrados: /start /help /reset /cancel /id /ping
  bot.plug(slashCommandsPlugin)

  bot.when('hola', (ctx) => ctx.reply('👋 ¡Hola! Envía "registro" para probar un flujo.'))

  bot.use(
    flow('registro')
      .ask('¿Cómo te llamas?', 'name')
      .say((_ctx, c) => `¡Encantado, ${c.state.name}!`),
  )

  // Solo se ejecuta si nada de lo anterior manejó el mensaje
  bot.onMessage((ctx) => ctx.reply('Envía "hola", "registro" o /help.'))

  return bot
})

export default createBot

// `node bot.js` conecta con WhatsApp; `botmesh dev` se salta este bloque.
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'my-bot' }))
  bot.on('ready', () => console.log('✅ Conectado. Envía "hola" desde otro teléfono.'))
  await bot.start()
}
```

`lang: 'es'` pone en español los textos que escribe el framework (`/help`,
reintentos, timeouts); sin él salen en inglés.

### 3. Probarlo en la terminal

```bash
npx botmesh dev bot.js      # pnpm: pnpm exec botmesh dev bot.js
```

```text
user › hola
bot › 👋 ¡Hola! Envía "registro" para probar un flujo.
user › registro
bot › ¿Cómo te llamas?
user › Ana
bot › ¡Encantado, Ana!
```

El simulador inyecta un provider en memoria, así que nada sale de tu equipo, y
recarga el bot al guardar el archivo. `:help` lista sus comandos y `:quit`
sale. Más en [Simulador en la terminal](./simulador).

### 4. Conectar un canal real

#### Vincular WhatsApp

```bash
node bot.js
```

Aparece un código QR en la terminal. En el teléfono cuyo número **será el
bot**:

1. Abre **WhatsApp** → **Ajustes** → **Dispositivos vinculados**.
2. Toca **Vincular un dispositivo** y escanea el QR.

Cuando salga `✅ Conectado`, envía `hola` a ese número **desde otro teléfono**.
La sesión se guarda en `./sessions/my-bot/`, así que el siguiente arranque
reconecta sin QR. Mantén esa carpeta privada y fuera de git: quien la tenga
controla la cuenta.

::: warning Protocolo no oficial
Baileys usa el protocolo de WhatsApp Web, que Meta no admite para bots: el
número vinculado puede quedar restringido o bloqueado. Usa un número de
repuesto mientras pruebas, y la [Cloud API](#otros-canales) oficial en
producción.
:::

::: tip ¿Sin cámara a mano?
Vincula con un código: pasa el número del bot al provider e imprime el código
que recibe.

```js
const bot = await createBot(new BaileysProvider({ session: 'my-bot', pairingPhoneNumber: '+57 300 123 4567' }))
bot.on('qr', (code) => console.log('Código de vinculación:', code))
```

Luego en WhatsApp: **Dispositivos vinculados** → **Vincular un dispositivo** →
**Vincular con el número de teléfono**, y escribe el código.
:::

#### O conectar Telegram

Crea un bot con [@BotFather](https://t.me/BotFather) (`/newbot`) y copia su
token. En `bot.js` cambian dos sitios: el import del provider arriba y el
bloque de arranque abajo. La fábrica de en medio no cambia.

```js
// bot.js: inicio del archivo
import { Bot, defineBot, flow, isMainModule, slashCommandsPlugin } from '@botmesh/core'
import { TelegramProvider } from '@botmesh/telegram' // en lugar de @botmesh/baileys

// ... createBot y export default igual que en el paso 2 ...

// final del archivo
if (isMainModule(import.meta)) {
  const bot = await createBot(new TelegramProvider({ token: process.env.TELEGRAM_TOKEN ?? '' }))
  bot.on('ready', () => console.log('✅ Conectado. Escribe "hola" a tu bot.'))
  await bot.start()
}
```

Crea con tu editor un archivo llamado `.env` junto a `bot.js`, con una línea:

```ini
TELEGRAM_TOKEN=123456:ABC-tu-token
```

No uses `echo ... > .env` en Windows PowerShell: escribe el archivo en UTF-16
o con BOM, Node no lee la variable y el provider se detiene con
`` `token` is required ``. Después arranca el bot:

```bash
node --env-file=.env bot.js
```

Abre tu bot en Telegram y envía `hola`. El provider usa long polling por
defecto, así que no hace falta una URL pública.

#### Otros canales

Solo cambia el provider: handlers, flujos, hooks y plugins son los mismos en
todos los transportes.

| Transporte | Paquete | Estado | Notas |
| --- | --- | --- | --- |
| WhatsApp (Baileys 7) | `@botmesh/baileys` | Publicado | Protocolo no oficial de WhatsApp Web, QR o código de vinculación |
| WhatsApp Cloud API | `@botmesh/meta` | Publicado | API oficial de Meta, webhook, botones y plantillas nativos |
| Telegram | `@botmesh/telegram` | Publicado | Bot API, long polling o webhook |
| Facebook Messenger | `@botmesh/messenger` | Publicado (desde la beta) | Send API, webhook, botones postback y plantillas genéricas |
| DMs de Instagram | `@botmesh/instagram` | Publicado (desde la beta) | Messenger API for Instagram, webhook, quick replies |
| WhatsApp vía Evolution API / WPPConnect | `@botmesh/evolution`, `@botmesh/wppconnect` | Publicado (desde la beta) | Tu gateway de WhatsApp Web self-hosted, REST + webhook autenticado |
| Discord | `@botmesh/discord` | Publicado (desde la beta) | Gateway websocket + REST, botones, menús de selección y slash commands |
| WhatsApp + SMS (Twilio), Gupshup, HighLevel, email | `@botmesh/twilio`, `@botmesh/gupshup`, `@botmesh/gohighlevel`, `@botmesh/email` | Publicado (desde la beta) | Ver [Canales](./canales) |
| TikTok | `@botmesh/tiktok` | Experimental | Privado, no está en npm; ver [Canales](./canales) |

La Cloud API oficial de WhatsApp, por ejemplo:

```js
import { CloudAPIProvider } from '@botmesh/meta'

const provider = new CloudAPIProvider({
  accessToken: process.env.META_TOKEN ?? '',
  phoneNumberId: process.env.META_PHONE_ID ?? '',
  verifyToken: process.env.META_VERIFY_TOKEN ?? '',
  appSecret: process.env.META_APP_SECRET, // obligatorio: verifica X-Hub-Signature-256
})
```

Funciona por webhook: tu servidor HTTP pasa el body **crudo** de cada POST a
`provider.ingest(rawBody, headers)`. Consulta [Servidor de webhooks](./servidor)
para montarlo y [Canales](./canales) para lo que admite cada transporte.

## Solución de problemas

| Síntoma | Solución |
| --- | --- |
| `ERR_PNPM_IGNORED_BUILDS` al instalar `@botmesh/baileys` con pnpm 11 | pnpm pide aprobar los scripts de build de las dependencias. Baileys y `protobufjs` no necesitan los suyos, así que deniégalos en `pnpm-workspace.yaml` (`allowBuilds:` con `'@whiskeysockets/baileys': false` y `protobufjs: false`) y vuelve a instalar. npm los ejecuta e instala sin más. |
| `ERR_MODULE_NOT_FOUND` para `@botmesh/baileys` (u otro provider) | `bot.js` importa un paquete de provider que no está instalado. Instálalo o cambia el import al provider que usas (ver [O conectar Telegram](#o-conectar-telegram)). |
| `SyntaxError: Cannot use import statement outside a module`, o `ERR_REQUIRE_ESM` | Añade `"type": "module"` al `package.json` (`npm pkg set type=module`) o renombra el archivo a `.mjs`. |
| `botmesh dev` se detiene con *the entry ran but exports no bot factory* | Exporta por defecto `defineBot((provider) => ...)` y arranca el provider real solo dentro de `if (isMainModule(import.meta))`, como en el paso 2. |
| El bot ignora `hola amigo` o `/hola` | Un trigger de texto compara el mensaje **completo**, normalizado (sin distinguir mayúsculas, tildes ni espacios de más). Para buscar una subcadena usa `{ pattern: 'hola', match: 'contains' }`; ver [Triggers especiales](./triggers). |
| WhatsApp muestra un QR nuevo en cada arranque | Se borró la sesión, o WhatsApp desvinculó el dispositivo (el provider borra entonces `sessions/<session>` por su cuenta). Vuelve a escanear. |
| WhatsApp se desconecta con `440` (`connectionReplaced`) | Otro proceso usa la misma sesión. Detenlo: el provider no reconecta para no pelear por la sesión. |
| Telegram registra `getUpdates conflicts with an active webhook` | El token tiene un webhook configurado. Llama a `deleteWebhook` o usa el modo webhook (`polling: false`). |
| `` TelegramProvider: `token` is required `` | `TELEGRAM_TOKEN` no llegó al proceso. Arranca con `node --env-file=.env bot.js` y comprueba que `.env` contiene `TELEGRAM_TOKEN=...` guardado como UTF-8 sin BOM (en Windows PowerShell, `echo` escribe UTF-16 o con BOM; crea el archivo con un editor). |
| Telegram falla con `Unauthorized — check the bot token` | El token está mal o fue revocado: vuelve a copiarlo de @BotFather. |
| `BotNotRunningError` al enviar | `bot.send()` y `ctx.reply()` necesitan el bot en marcha: envía después de `await bot.start()` (o desde un listener de `'ready'`). |
| Los textos integrados (`/help`, timeouts) salen en inglés | Es el valor por defecto. `new Bot({ provider, lang: 'es' })` los pasa a español; ver [Internacionalización](./i18n). |

## Plantillas de proyecto

| Plantilla | Qué obtienes |
| --- | --- |
| `baileys` (por defecto) | WhatsApp vía Baileys: escaneas un QR para vincular |
| `meta` | WhatsApp Cloud API (webhook; necesita credenciales de Meta y una URL pública) |
| `telegram` | Telegram Bot API (long polling; necesita un token de @BotFather) |
| `ai` | Baileys + autorespondedor de soporte con `@botmesh/ai` limitado al negocio (`ANTHROPIC_API_KEY`) |
| `games` | Adivina el número, ahorcado, trivia, tres en raya, piedra-papel-tijera; puntuaciones en `ctx.user` |
| `support` | Tickets por usuario, menú de FAQ y handoff a humano |
| `store` | Catálogo, carrito por usuario con TTL de 7 días y flujo de checkout |
| `restaurant` | Menú, pedidos a domicilio o para recoger, "repetir mi último pedido", reservas de mesa |
| `clinic` | Agenda de citas (especialidad, día, hora), listar y cancelar citas |
| `ai-full` | IA limitada al negocio + intents por palabra clave/regex + store SQLite + scheduler + comandos slash + handoff (`ANTHROPIC_API_KEY`) |

Las plantillas de casos de uso (de `games` a `ai-full`) usan Baileys. Las de
transporte (`baileys`, `meta`, `telegram`, `ai`) instalan los comandos slash
integrados, así que `/reset` o `/cancel` sale de su flujo de ejemplo `menu`.

| Flag | Significado |
| --- | --- |
| `-t, --template <name>` | Una de las plantillas de arriba (`baileys` en modo no interactivo) |
| `--name <name>` | Nombre del paquete (por defecto, el del directorio) |
| `-y, --yes` | Omite las preguntas y usa los valores por defecto |
| `--overwrite` | Permite generar en un directorio que no está vacío |
| `--force` | Permite un directorio dentro del propio monorepo de botmesh (rechazado por defecto) |
| `-h, --help` | Muestra la ayuda |

Cada proyecto incluye `package.json` (con `npm start` y `npm run dev`),
`src/bot.js`, `.env.example`, `.gitignore`, un `README.md` y un
**`AGENTS.md`** que indica a los agentes de código con IA qué API usar y qué
comandos ejecutar.

## Siguientes pasos

- [Tu primer bot](./primer-bot): comandos, media, un flujo con validación y un catch-all
- [Conceptos básicos](./conceptos): cómo se enruta un mensaje, `ctx`, triggers e ids
- [Referencia de configuración](./configuracion): todas las opciones de `new Bot({...})`
- [Canales](./canales): todos los transportes y lo que admite cada uno
- [Testing](./testing): prueba tus flujos con `createTestBot`, sin red
- [Ejemplos](/es/ejemplos/): recetas listas para copiar
- [Pasar a producción](./produccion) y [Solución de problemas](./solucion-problemas)
