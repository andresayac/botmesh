# Despliegue

Cómo ejecutar un bot en producción y mantenerlo conectado. Para la lista
completa de lo que hay que revisar antes de salir en vivo, mira
[Pasar a producción](./produccion).

::: tip Solo ESM, Node >= 22
`@botmesh/core` y los paquetes de transporte son ESM puro, sin build de
CommonJS. El `package.json` de producción necesita `"type": "module"` (o
archivos de entrada `.mjs`), y el runtime debe ser **Node.js 22 o superior**.
:::

Los ejemplos suponen la estructura que genera `create-botmesh`: el archivo de
entrada es `src/bot.js` y se arranca con `npm start`
(`node --env-file-if-exists=.env src/bot.js`). Ajusta las rutas si las tuyas
son otras. Si escribes TypeScript, compílalo antes (`tsc`) y arranca el archivo
compilado.

## Opción 1: un VPS con PM2

### 1. Preparar el servidor

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

git clone https://github.com/your-user/my-bot.git
cd my-bot
npm ci --omit=dev
```

### 2. Primera conexión (WhatsApp con Baileys)

```bash
npm start
# Escanea el código QR y pulsa Ctrl+C
```

La sesión se guarda en `./sessions/<session>`. Mientras esa carpeta exista, el
bot se reconecta sin volver a escanear. Telegram, la Cloud API y los demás
canales con token se saltan este paso.

### 3. Mantenerlo activo con PM2

```bash
npm install -g pm2
pm2 start src/bot.js --name my-bot --kill-timeout 20000 --node-args="--env-file-if-exists=.env"
pm2 save
pm2 startup  # imprime el comando que arranca PM2 al iniciar el sistema
```

```bash
pm2 status          # estado de cada proceso
pm2 logs my-bot     # seguir los logs
pm2 restart my-bot  # reiniciar: PM2 envía SIGINT y SIGKILL pasado --kill-timeout
pm2 stop my-bot
```

`pm2 restart` y `pm2 stop` solo apagan el bot de forma ordenada si atiende la
señal: añade el manejador de [Apagado ordenado](#apagado-ordenado) (ni el core
ni el `bot.js` generado instalan uno). PM2 mata el proceso `kill_timeout` ms
después de `SIGINT` (1600 ms por defecto), así que deja `--kill-timeout` por
encima del timeout del drain.

## Opción 2: Docker

### Dockerfile

```dockerfile
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
# La sesión y la base de datos viven en volúmenes, nunca en la imagen.
RUN mkdir -p /app/sessions /app/data
CMD ["node", "src/bot.js"]
```

Con pnpm, cambia las líneas de instalación por
`RUN corepack enable && pnpm install --prod --frozen-lockfile` y copia
`pnpm-lock.yaml` en lugar de `package-lock.json`. pnpm 10 y posteriores se
saltan el script de build de `better-sqlite3` hasta que lo apruebes en
`pnpm-workspace.yaml` (`allowBuilds:` con `better-sqlite3: true` en pnpm 11,
`onlyBuiltDependencies` en pnpm 10; ver [SQLiteStore](./store#sqlitestore)).

Añade un `.dockerignore` con `node_modules`, `sessions`, `data`, `.env` y
`*.qr.png`, para que las credenciales nunca acaben en una capa de la imagen.

### docker-compose.yml

```yaml
services:
  bot:
    build: .
    restart: unless-stopped
    env_file: .env
    stop_grace_period: 30s           # tiempo para bot.stop({ drain: true })
    volumes:
      - ./sessions:/app/sessions     # sesión de WhatsApp (Baileys)
      - ./data:/app/data             # base de datos SQLite
    ports:
      - '127.0.0.1:9464:9464'        # salud y métricas, ver más abajo
```

```bash
docker compose up -d
docker compose logs -f bot  # la primera vez, escanea aquí el QR
```

Docker envía `SIGTERM` con `docker compose stop` y espera `stop_grace_period`
antes de matar el contenedor: que sea mayor que el timeout del drain.

## Variables de entorno

El framework **no** lee ninguna variable de entorno por su cuenta: cada
credencial y ajuste es una opción de un constructor. Pasa tus variables de
forma explícita, por ejemplo:

```ts
import { Bot } from '@botmesh/core'
import { CloudAPIProvider } from '@botmesh/meta'
import { SQLiteStore } from '@botmesh/sqlite-store'

/** Una variable obligatoria: si falta, el arranque falla con una sola línea clara. */
function env(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing environment variable ${name}`)
  return value
}

const bot = new Bot({
  provider: new CloudAPIProvider({
    accessToken: env('META_TOKEN'),
    phoneNumberId: env('META_PHONE_ID'),
    verifyToken: env('META_VERIFY_TOKEN'),
    appSecret: env('META_APP_SECRET'),
  }),
  store: new SQLiteStore({ file: process.env.SQLITE_FILE ?? './data/bot.db' }),
})
```

Carga un `.env` local con `node --env-file-if-exists=.env` y, en producción,
toma los valores de tu orquestador o gestor de secretos. Comprobar las
obligatorias al arrancar (como hace `env()`) hace que un secreto ausente falle
con una línea clara en vez de con un error del provider más tarde.

## Persistencia

### Sesiones

El provider de Baileys guarda las credenciales de WhatsApp en
`sessionsDir/<session>` (por defecto `./sessions/<session>`). **No borres esa
carpeta** o tendrás que volver a escanear el QR:

```ts
const provider = new BaileysProvider({ session: 'mi-bot', sessionsDir: './sessions' })
```

La carpeta contiene las claves de la cuenta: trátala como una contraseña
(permisos restringidos, copias cifradas, nunca en git ni en una imagen).

### Store

El `MemoryStore` por defecto vive en RAM. En producción usa **`SQLiteStore`**
para un proceso (o `RedisStore` para varias réplicas), así los mensajes, chats,
contactos, checkpoints de flujos e historial de IA sobreviven a los reinicios:

```ts
import { Bot } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'
import { SQLiteStore } from '@botmesh/sqlite-store'

const bot = new Bot({
  provider: new BaileysProvider({ session: 'mi-bot' }),
  store: new SQLiteStore({ file: './data/bot.db' }),
})
```

La carpeta de `file` debe existir (SQLite crea el archivo, no sus carpetas).
Con un store persistente, los checkpoints de `flow(...).persistent()`
sobreviven a los reinicios. Ver [Store persistente](./store).

### Copias de seguridad

Respalda la sesión y los datos juntos: son lo que permite que un bot
redesplegado continúe sin escanear otro QR ni perder conversaciones.

```bash
pm2 stop my-bot            # o: docker compose stop bot
tar -czf backup-$(date +%F).tar.gz sessions/ data/
pm2 start my-bot
```

Copia los archivos de SQLite con el bot parado, o usa
`sqlite3 data/bot.db ".backup backup.db"` mientras corre: con WAL activo, una
copia simple de una base de datos viva puede perder las últimas escrituras.
Haz una copia antes de actualizar `@botmesh/sqlite-store`, porque una versión
anterior no puede abrir un archivo migrado a un esquema más nuevo.

## Apagado ordenado

`bot.stop()` desconecta el provider y termina las conversaciones activas. Con
`{ drain: true }` antes **espera los envíos en vuelo**, para que un despliegue
no corte una respuesta a la mitad:

```ts
async function shutdown(signal: string) {
  bot.logger.info({ signal }, 'apagando')
  await bot.stop({ drain: true, timeout: '15s' }) // una duración o ms
  process.exit(0)
}
process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
```

| Opción | Tipo | Default | Descripción |
|---|---|---|---|
| `drain` | `boolean` | `false` | Esperar los envíos en vuelo antes de parar |
| `timeout` | `string \| number` | `10000` | Espera máxima del drain (una duración como `'15s'`, o ms) |

Las respuestas que siguen enviándose cuando empieza `stop()`, y las que el
provider ya aceptó, se registran en el log de mensajes (hooks `after('send')`
y escritura en el store, hasta 5 s) antes de cerrar el store, con o sin
`drain`.

Tras el drain no queda nada corriendo: los mensajes que esperaban en la cola de
un chat se descartan, no arranca ninguna conversación nueva hasta `start()`,
las respuestas en pausa que seguían esperando resuelven con `{ skipped: true }`
y los `ctx.stream()` en curso se cancelan sin volver a tocar el transporte
(resuelven con `cancelled: true`). Ningún temporizador del bot mantiene vivo el
proceso después.

Con [durabilidad](./durabilidad), un mensaje descartado así sigue en el journal
y se procesa en el siguiente arranque.

## Comprobaciones de salud

Un pequeño endpoint HTTP le dice a Docker, Kubernetes o tu balanceador si el
bot está vivo y conectado. `bot.getConnectionState()` es `'connecting'`,
`'authenticating'`, `'ready'` o `'closed'`:

```ts
import { createServer } from 'node:http'
import { toPrometheus, PROMETHEUS_CONTENT_TYPE } from '@botmesh/core'

let stopping = false
bot.on('stopping', () => { stopping = true })

createServer((req, res) => {
  if (req.url === '/healthz') return void res.writeHead(200).end('ok')        // liveness
  if (req.url === '/readyz') {                                                 // readiness
    const ready = !stopping && bot.getConnectionState() === 'ready'
    return void res.writeHead(ready ? 200 : 503).end(ready ? 'ready' : bot.getConnectionState())
  }
  if (req.url === '/metrics') {
    res.setHeader('Content-Type', PROMETHEUS_CONTENT_TYPE)
    return void res.end(toPrometheus(bot.metrics()))
  }
  res.writeHead(404).end()
}).listen(9464)
```

- Usa `/healthz` para **liveness** (reiniciar el contenedor cuando falla) y
  `/readyz` para **readiness** (enviar tráfico solo mientras pasa).
- Con [réplicas](./replicas) y un transporte exclusivo (Baileys), las réplicas
  en espera no están conectadas a propósito, así que su `/readyz` responde
  `503`. No las reinicies por eso.
- Escucha en una interfaz privada o protege el puerto: `bot.metrics()` no
  contiene datos personales, pero describe tu tráfico.
- `@botmesh/server` sirve `/healthz` y
  `/readyz` junto a las rutas de webhooks: ver [Servidor de webhooks](./servidor).

```yaml
# docker-compose.yml, dentro del servicio bot
    healthcheck:
      test: ['CMD', 'node', '-e', "fetch('http://127.0.0.1:9464/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
```

## Logging

Sin `logger`, el bot registra con un logger pino integrado en nivel `warn`, así
que se ven los avisos de plugins y handlers (por ejemplo una respuesta de IA
fallida), y `debug: true` lo baja a `debug`. En producción, pasa tu propio
logger para elegir el nivel y el destino:

```ts
import pino from 'pino'

const bot = new Bot({
  provider,
  logger: pino({ level: process.env.LOG_LEVEL ?? 'info' }),
  // logIds: 'hash' (por defecto) | 'raw' | 'omit': cómo aparecen los ids de chat y remitente en los logs
})
```

Los ids de chat y de remitente (teléfonos, emails) van hasheados en los logs
del bot por defecto. Usa `logIds: 'raw'` solo para depurar en local.

## Siguientes pasos

- [Pasar a producción](./produccion): la lista completa
- [Varias réplicas](./replicas): varios procesos del mismo bot (relevo ante caídas, volumen de webhooks)
- [Operación](./operations): métricas y eventos
- [Preguntas frecuentes](./faq): problemas comunes
