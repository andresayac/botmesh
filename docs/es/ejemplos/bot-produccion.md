# Bot listo para producción

Lleva un bot de soporte a producción como un proyecto pequeño: persistencia en
SQLite, procesamiento durable de mensajes, endpoints de salud y métricas, logs
JSON sin datos personales, apagado ordenado y una imagen de Docker.

**Nivel:** Avanzado · **Etiquetas:** Producción, Docker, SQLite, Durabilidad, WhatsApp

**Funcionalidades:**
[Store persistente](/es/guide/store) (`SQLiteStore`, `maxMessagesPerChat`) ·
[Procesamiento durable](/es/guide/durabilidad) (`store.durability()`) ·
[Flujos persistentes](/es/guide/flujos) (`.persistent()`, `.timeout`) ·
[Apagado ordenado](/es/guide/deploy#apagado-ordenado) (`bot.stop({ drain })`) ·
[Comprobaciones de salud y métricas](/es/guide/deploy#comprobaciones-de-salud) (`toPrometheus`, `bot.metrics()`) ·
[Logging](/es/guide/deploy#logging) (pino, `logIds`) ·
[Eventos de operación](/es/guide/operations) ·
[Pasar a producción](/es/guide/produccion)

## Requisitos previos

Node.js 22.12 o superior, como en [Inicio rápido](/es/guide/inicio#requisitos).
Mientras botmesh esté en prerelease, lee allí la nota sobre qué etiqueta de
npm instalar. Docker es opcional.

```bash
npm install @botmesh/core @botmesh/baileys @botmesh/sqlite-store better-sqlite3 pino
```

## Estructura del proyecto

```text
support-bot/
├── src/bot.js            el bot, el servidor de salud y el apagado
├── package.json
├── Dockerfile
├── .dockerignore
├── docker-compose.yml
├── sessions/             sesión de WhatsApp (volumen, nunca en git ni en la imagen)
└── data/bot.db           SQLite: mensajes, flujos, journals (volumen)
```

## El bot completo

```js
// src/bot.js
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import pino from 'pino'
import { Bot, PROMETHEUS_CONTENT_TYPE, defineBot, flow, isMainModule, slashCommandsPlugin, toPrometheus } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'
import { SQLiteStore } from '@botmesh/sqlite-store'

const DB_FILE = process.env.DB_FILE ?? './data/bot.db'

const createBot = defineBot((provider) => {
  // 1. Un solo archivo SQLite guarda mensajes, chats, checkpoints de flujos y los journals durables
  mkdirSync(dirname(DB_FILE), { recursive: true })
  const store = new SQLiteStore({ file: DB_FILE, maxMessagesPerChat: 1000 })

  const bot = new Bot({
    provider,
    store,
    lang: 'es',
    // 2. Durabilidad: un mensaje cortado por una caída se reprocesa al reiniciar, sin respuestas dobles
    durability: { backend: store.durability(), instanceId: process.env.INSTANCE_ID ?? 'bot-1' },
    // 3. Logs JSON; los ids de chat y de remitente salen hasheados en los logs del bot (logIds: 'hash')
    logger: pino({ level: process.env.LOG_LEVEL ?? 'info' }),
  })

  bot.plug(slashCommandsPlugin)
  bot.when(['hola', 'buenas'], (ctx) => ctx.reply('👋 ¡Hola! Envía "ticket" para abrir un ticket de soporte.'))

  // 4. Un flujo persistente: quien lo deja a medias lo retoma tras un reinicio o un despliegue
  bot.use(
    flow('ticket')
      .ask('¿Cuál es el problema?', 'issue')
      .ask('¿Cómo te contactamos (email o teléfono)?', 'contact')
      .say((_ctx, c) => `🎫 Ticket creado. Te contactaremos en ${c.state.contact}.`)
      .persistent()
      .timeout('1h'),
  )
  bot.onMessage((ctx) => ctx.reply('Envía "ticket" para abrir un ticket de soporte, o /help.'))

  // 5. Registra qué pasó, nunca el texto de los mensajes ni los teléfonos
  bot.on('conversation:ended', (e) => bot.logger.info({ flow: e.name, outcome: e.outcome, ms: e.durationMs }, 'conversation ended'))
  bot.on('error', ({ error }) => bot.logger.error({ err: error }, 'handler failed'))
  return bot
})

export default createBot

// 6. Liveness, readiness y métricas Prometheus en un puerto privado
export function startHealthServer(bot, port = 9464) {
  let stopping = false
  bot.on('stopping', () => { stopping = true })
  const server = createServer((req, res) => {
    if (req.url === '/healthz') return void res.writeHead(200).end('ok')
    if (req.url === '/readyz') {
      const ready = !stopping && bot.getConnectionState() === 'ready'
      return void res.writeHead(ready ? 200 : 503).end(ready ? 'ready' : 'not ready')
    }
    if (req.url === '/metrics') {
      return void res.writeHead(200, { 'content-type': PROMETHEUS_CONTENT_TYPE }).end(toPrometheus(bot.metrics()))
    }
    res.writeHead(404).end()
  })
  return new Promise((resolve) => server.listen(port, () => resolve(server)))
}

// 7. Apagado ordenado: termina las respuestas en curso y luego cierra el servidor de salud
export function gracefulShutdown(bot, server) {
  let closing
  return (signal) => (closing ??= (async () => {
    bot.logger.info({ signal }, 'shutting down')
    await bot.stop({ drain: true, timeout: '15s' })
    await new Promise((resolve) => server.close(resolve))
  })())
}

// 8. `node src/bot.js` (o el contenedor) ejecuta esto; `npx botmesh dev src/bot.js` solo importa la fábrica
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: process.env.WA_SESSION ?? 'support-bot' }))
  const server = await startHealthServer(bot, Number(process.env.HEALTH_PORT ?? 9464))
  const shutdown = gracefulShutdown(bot, server)
  process.once('SIGTERM', () => void shutdown('SIGTERM'))
  process.once('SIGINT', () => void shutdown('SIGINT'))
  await bot.start()
}
```

## Los archivos del proyecto

`package.json` (`npm install` añade las `dependencies`):

```json
{
  "name": "support-bot",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.12" },
  "scripts": {
    "start": "node --env-file-if-exists=.env src/bot.js",
    "dev": "botmesh dev src/bot.js"
  }
}
```

```dockerfile
# Dockerfile
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
# La sesión de WhatsApp y la base de datos viven en volúmenes, nunca en la imagen
RUN mkdir -p /app/sessions /app/data && chown -R node:node /app
USER node
EXPOSE 9464
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:9464/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "src/bot.js"]
```

```text
# .dockerignore
node_modules
sessions
data
.env
*.qr.png
```

```yaml
# docker-compose.yml
services:
  bot:
    build: .
    restart: unless-stopped
    stop_grace_period: 30s          # más que los 15 s del drenado
    environment:
      DB_FILE: /app/data/bot.db
      LOG_LEVEL: info
    volumes:
      - ./sessions:/app/sessions
      - ./data:/app/data
    ports:
      - '127.0.0.1:9464:9464'       # salud y métricas, en privado
```

## Cómo funciona

### 1. Un archivo SQLite para todo el estado

`SQLiteStore` guarda mensajes, chats, contactos, datos de usuario y
checkpoints de flujos. Su carpeta debe existir (SQLite crea el archivo, no las
carpetas), de ahí el `mkdirSync`. `maxMessagesPerChat` acota el log de
mensajes, que en los stores persistentes no tiene límite por defecto.

### 2. Durabilidad

Con `durability`, cada mensaje admitido se anota en un journal de entrada
antes de que corra ningún handler, y cada respuesta en un outbox con una clave
de idempotencia antes de llamar al provider. Si el proceso muere a mitad, el
siguiente arranque reprocesa el mensaje y se salta las respuestas que ya
salieron. `store.durability()` guarda los dos journals en el mismo archivo.
Mantén `instanceId` estable entre reinicios de un mismo despliegue.

### 3. Logs sin datos personales

El bot escribe sus logs con el logger de pino que le pasas. Los ids de chat y
de remitente salen hasheados en las líneas del propio bot (`logIds: 'hash'`,
el valor por defecto). Tus líneas deberían seguir la misma regla: el paso 5
registra el nombre del flujo, el resultado y la duración, nunca el texto ni el
teléfono. `LOG_LEVEL=debug` muestra más mientras depuras.

### 4. Flujos persistentes

`.persistent()` guarda la posición del flujo y `c.state` en el store después
de cada paso, así que quien deja `ticket` a medias continúa tras un
despliegue. La transcripción de abajo reinicia el bot en mitad del flujo.

### 5. Eventos para operación

`'conversation:ended'` informa de cada flujo con su resultado (`completed`,
`cancelled`, `timedOut`...). `'error'` recibe los fallos de los handlers;
envíalos a tu herramienta de errores. Mira [Operación](/es/guide/operations)
para el resto.

### 6. Salud y métricas

`/healthz` responde mientras el proceso sirve (liveness: reinicia el
contenedor cuando falla). `/readyz` responde `200` solo mientras el bot está
conectado y no se está parando (readiness). `/metrics` es `bot.metrics()` en
formato de texto de Prometheus. Mantén el puerto en privado: el compose lo
enlaza a `127.0.0.1`.

### 7. Apagado ordenado

Con `SIGTERM` (Docker, Kubernetes) o `SIGINT` (Ctrl+C, PM2),
`bot.stop({ drain: true, timeout: '15s' })` espera las respuestas en curso,
las registra y cierra el store; después se cierra el servidor de salud y nada
mantiene vivo el proceso. Una segunda señal espera al mismo apagado. Deja el
periodo de gracia del orquestador (`stop_grace_period`) por encima del timeout
del drenado.

### 8. Un archivo, tres formas de ejecutarlo

`npx botmesh dev src/bot.js` importa solo la fábrica e inyecta el simulador de
la terminal, así que pruebas el mismo bot (con el mismo archivo SQLite) sin
teléfono. `node src/bot.js` y el contenedor ejecutan el bloque
`isMainModule`.

## Transcripción de ejemplo

Capturada con `npx botmesh dev src/bot.js`. `:reset` arranca un bot nuevo,
como haría un reinicio o un despliegue, y el flujo continúa desde el store:

```text
user › hola
bot › 👋 ¡Hola! Envía "ticket" para abrir un ticket de soporte.
user › ticket
bot › ¿Cuál es el problema?
user › La app se cierra al entrar
bot › ¿Cómo te contactamos (email o teléfono)?
• ↺ fresh bot — conversations and in-memory state cleared
user › ana@example.com
bot › 🎫 Ticket creado. Te contactaremos en ana@example.com.
user › /ping
bot › pong 🏓
```

## Ejecutarlo en WhatsApp

En local: `npm start`, escanea el QR con el teléfono que hará de bot y pulsa
Ctrl+C. Con Docker, crea antes las carpetas de los volúmenes (de tu usuario,
uid 1000 como el usuario `node` de la imagen) y sigue los logs para escanear
el QR la primera vez:

```bash
mkdir -p sessions data
docker compose up -d --build
docker compose logs -f bot
```

Para Telegram, instala `@botmesh/telegram` y construye el bot con
`new TelegramProvider({ token: process.env.TELEGRAM_TOKEN })` en su lugar.

## Siguientes pasos

- [Pasar a producción](/es/guide/produccion): la checklist completa
- [Despliegue](/es/guide/deploy): PM2, copias de seguridad y variables de entorno
- [Varias réplicas](/es/guide/replicas): Redis, coordinación y failover
- [Probar tu bot](./probar-tu-bot): cubre los flujos antes de cada versión
