# Resumen diario programado

Envía a cada suscriptor un resumen a las 08:00 en la zona horaria del bot: una tarea
cron durable que sobrevive a los reinicios y se ejecuta una sola vez con
varias réplicas, una lista de altas y bajas guardada en el perfil de cada
usuario y un broadcast pausado que respeta los límites de envío.

**Nivel:** Avanzado · **Etiquetas:** Scheduler, Broadcast, Zonas horarias, SQLite, WhatsApp

**Funcionalidades:**
[Scheduler durable](/es/guide/scheduler#tareas-durables-sobreviven-a-reinicios-una-replica-por-ejecucion) (`bot.schedule` con `id`, `missed`, `run.occurrenceKey`, `run.signal`) ·
[Zonas horarias](/es/guide/scheduler#zonas-horarias) (`scheduler.timeZone`) ·
[Difusiones](/es/guide/mensajes#difusiones-broadcast) (`bot.broadcast` con lotes, pausas y reintentos) ·
[Datos por usuario](/es/guide/datos-usuario) (`ctx.user`, `bot.user()`) ·
[Store persistente](/es/guide/store) (`SQLiteStore`, `store.schedules()`) ·
[Rate limiting](/es/guide/rate-limiting)

## Requisitos previos

Node.js 22.12 o superior y un proyecto ESM (`"type": "module"`), como en
[Inicio rápido](/es/guide/inicio#requisitos).

```bash
npm install @botmesh/core @botmesh/baileys @botmesh/sqlite-store better-sqlite3
```

## El bot completo

```js
// bot.js
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { Bot, defineBot, isMainModule, slashCommandsPlugin } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'
import { SQLiteStore } from '@botmesh/sqlite-store'

const DB_FILE = process.env.DB_FILE ?? './data/digest.db'
const TIME_ZONE = process.env.DIGEST_TZ ?? 'America/Bogota'

const TIPS = {
  lunes: 'Apunta la única tarea que haría de esta semana una buena semana.',
  martes: 'Responde ese correo que llevas días aplazando.',
  miércoles: 'Da un paseo de cinco minutos después de comer.',
  jueves: 'Levántate y estírate cada hora.',
  viernes: 'Planifica el lunes antes de cerrar el portátil.',
  sábado: 'Llama a alguien con quien no hablas hace tiempo.',
  domingo: 'Descansa. Mañana vuelve el resumen.',
}

// 1. El resumen de un día, hecho a partir del hueco que cubre la tarea (el mismo texto si se repite)
export function digestFor(date) {
  const weekday = date.toLocaleDateString('es-ES', { timeZone: TIME_ZONE, weekday: 'long' })
  const day = date.toLocaleDateString('es-ES', { timeZone: TIME_ZONE, month: 'long', day: 'numeric' })
  return `☀️ Tu resumen del ${weekday}, ${day}\n💡 ${TIPS[weekday]}\nResponde BAJA para darte de baja.`
}

const createBot = defineBot((provider) => {
  mkdirSync(dirname(DB_FILE), { recursive: true })
  const store = new SQLiteStore({ file: DB_FILE })
  const bot = new Bot({
    provider,
    store,
    lang: 'es',
    // 2. Las tareas durables viven en el mismo archivo SQLite; los campos cron se leen en TIME_ZONE
    scheduler: { store: store.schedules(), timeZone: TIME_ZONE },
  })
  bot.plug(slashCommandsPlugin)

  // 3. Alta y baja: la elección se guarda en el perfil del usuario (ctx.user)
  bot.when('suscribir', async (ctx) => {
    await ctx.user.set('digest', { subscribed: true })
    await ctx.reply(`✅ ¡Suscrito! Recibirás el resumen cada día a las 08:00 (${TIME_ZONE}). Responde BAJA para darte de baja.`)
  })
  bot.when(['baja', 'stop'], async (ctx) => {
    await ctx.user.set('digest.subscribed', false)
    await ctx.reply('👋 Te diste de baja. Envía "suscribir" para volver.')
  })
  bot.onMessage((ctx) => ctx.reply('Envía "suscribir" para recibir un resumen diario a las 08:00.'))

  // 4. Una tarea cron durable: guardada, una vez al día entre reinicios y réplicas
  bot.schedule('0 8 * * *', { id: 'daily-digest', missed: 'run-once' }, async (run) => {
    const chatIds = await pendingSubscribers(bot, run.occurrenceKey)
    const saved = []
    // 5. Un broadcast pausado: 20 chats por lote, 2 s entre lotes, reintentos ante límites de envío
    const result = await bot.broadcast(chatIds, digestFor(run.scheduledAt), {
      batchSize: 20,
      delayBetween: '2s',
      retries: 3,
      signal: run.signal,
      // 6. Registra cada chat en cuanto se le envía el resumen, no al final
      onProgress: (_done, _total, last) => {
        if (!last.ok) return
        saved.push(bot.user(last.chatId).set('digest.last', run.occurrenceKey)
          .catch((err) => bot.logger.warn({ err }, 'digest.last not saved')))
      },
    })
    await Promise.all(saved)
    // 7. Parado a mitad del broadcast (un despliegue a las 08:00): los pendientes se quedan sin el de hoy
    if (result.cancelled) bot.logger.warn({ pending: result.pending.length }, 'daily digest cut short')
    bot.logger.info({ sent: result.sent, failed: result.failed }, 'daily digest')
  })
  return bot
})

export default createBot

// 6. Chats privados suscritos que aún no recibieron esta ocurrencia.
//    En un chat privado el id del chat es el del usuario, así que lee el perfil de ese usuario.
async function pendingSubscribers(bot, occurrenceKey) {
  const ids = []
  for (const chat of await bot.getStore().listChats()) {
    if (chat.kind !== 'dm') continue
    const digest = await bot.user(chat.id).get('digest')
    if (digest?.subscribed && digest.last !== occurrenceKey) ids.push(chat.id)
  }
  return ids
}

if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'digest-bot' }))
  process.once('SIGTERM', () => void bot.stop({ drain: true }))
  await bot.start()
}
```

## Cómo funciona

### 1. El mismo texto si se repite

El resumen se construye a partir de `run.scheduledAt`, el hueco que cubre la
ejecución, no de la hora del reloj. Si la tarea vuelve a ejecutarse para el
mismo hueco (mira el paso 6), produce el mismo mensaje. Las fechas se
formatean en `TIME_ZONE` con `toLocaleDateString`, así que el día de la
semana es el de esa zona, no el del servidor. Hay una sola zona para todo el
bot (`DIGEST_TZ`): cada suscriptor recibe el resumen a las 08:00 de esa zona.
Para zonas por usuario, guarda la zona de cada uno en `ctx.user` y registra
una tarea por zona.

### 2. Un scheduler durable en SQLite

`scheduler.store: store.schedules()` guarda la próxima ejecución de cada
tarea durable en el mismo archivo SQLite que el resto del bot.
`scheduler.timeZone` hace que todas las tareas cron lean sus campos en esa
zona IANA: `0 8 * * *` son las 08:00 en Bogotá, corra donde corra el
servidor, y los cambios de horario siguen la
[política documentada](/es/guide/scheduler#zonas-horarias).

### 3. Altas y bajas

`suscribir` y `baja` guardan la elección del usuario con `ctx.user`, el perfil
por usuario que vive en el store. Nadie recibe el resumen sin pedirlo: los
envíos masivos no solicitados son la forma más rápida de que bloqueen un
número de WhatsApp.

### 4. Una tarea cron durable

El `id` hace la tarea durable: su próxima ejecución queda guardada, un
reinicio conserva el calendario y, con varias réplicas, solo una ejecuta cada
ocurrencia (la reclama con un lease con fencing). `missed: 'run-once'` envía
un resumen si el bot estaba caído a las 08:00 en vez de saltarse el día.
Registra las tareas durables al arrancar, como aquí: solo se guarda el
calendario, nunca el handler.

### 5. Un broadcast pausado

`bot.broadcast()` envía un contenido a muchos chats sin bloquear la cola de
entrada de nadie: 20 chats por lote, una pausa de 2 segundos entre lotes y
hasta 3 reintentos por chat tras un `RateLimitedError` (que pausa a todos los
workers). Un chat que falla nunca detiene al resto; el resultado cuenta
`sent`, `failed` y los chats aún `pending` si `run.signal` lo abortó (el bot
se está parando).

### 6. Al menos una vez, sin duplicados

Una tarea durable se ejecuta **al menos una vez** por ocurrencia: si el
proceso muere a mitad del broadcast, la ocurrencia se repite.
`run.occurrenceKey` (`daily-digest@2026-03-02T13:00:00.000Z`) es estable por
hueco. `onProgress` se ejecuta en cuanto termina cada chat, así que el bot
guarda la clave como `digest.last` justo después de enviarle el resumen, y una
repetición se salta a quien ya lo recibió ese día. Solo un chat cuyo envío
salió justo antes de la caída, sin que se llegara a escribir su
`digest.last`, puede recibirlo dos veces. En un chat
privado el id del chat es el del usuario, así que `bot.user(chat.id)` lee el
perfil correcto; los grupos se omiten.

### 7. Parar durante el broadcast

Una caída hace que la ocurrencia se repita, pero una parada ordenada no:
`bot.stop()` aborta `run.signal`, el broadcast devuelve en `pending` los chats
a los que no llegó, el handler termina y el scheduler confirma el hueco y pasa
al día siguiente. Esos chats se quedan sin el resumen de ese día, y el bot lo
registra como `daily digest cut short`. Despliega fuera de la franja de las
08:00, o envía tú mismo a los chats `pending` si perder un día importa.

## Transcripción de ejemplo

Capturada con `npx botmesh dev bot.js`, con el reloj unos segundos antes de
las 08:00 en Bogotá el lunes 2 de marzo de 2026. El resumen llega solo a las
08:00:

```text
user › suscribir
bot › ✅ ¡Suscrito! Recibirás el resumen cada día a las 08:00 (America/Bogota). Responde BAJA para darte de baja.
bot › ☀️ Tu resumen del lunes, 2 de marzo
      💡 Apunta la única tarea que haría de esta semana una buena semana.
      Responde BAJA para darte de baja.
user › BAJA
bot › 👋 Te diste de baja. Envía "suscribir" para volver.
user › hola
bot › Envía "suscribir" para recibir un resumen diario a las 08:00.
```

## Ejecutarlo en WhatsApp o Telegram

`node bot.js` se conecta a WhatsApp: escanea el QR con el teléfono que hará de
bot. Define `DIGEST_TZ` (por ejemplo `Europe/Madrid`) para cambiar la zona.
Para Telegram, instala `@botmesh/telegram` y pasa
`new TelegramProvider({ token: process.env.TELEGRAM_TOKEN })` en su lugar.

## Siguientes pasos

- [Scheduler](/es/guide/scheduler): todas las opciones de las tareas durables, recuperación y backends
- [Rate limiting](/es/guide/rate-limiting): el limitador del propio provider y consejos anti-bloqueo
- [Bot listo para producción](./bot-produccion): health checks, logs y Docker para este bot
