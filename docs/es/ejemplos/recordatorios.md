# Bot de recordatorios

Construye un bot que programa recordatorios puntuales ("recuerdame 10m
llamar a mamá") y envía un consejo diario a las 9:00 a quien se suscriba.

**Nivel:** Principiante · **Etiquetas:** WhatsApp, Telegram, Scheduler

**Funciones que muestra:** [`bot.delay()`](/es/guide/scheduler) ·
[`bot.schedule()` con cron y zona horaria](/es/guide/scheduler) ·
[cancelar una tarea](/es/guide/scheduler#cancelar-una-tarea) ·
[`bot.send()` fuera de un handler](/es/guide/mensajes#enviar-fuera-de-un-handler) ·
[triggers regex](/es/guide/conceptos#when-respuestas-simples)

## Requisitos previos

Node.js 22.12 o superior y una carpeta con `"type": "module"` (ver
[Inicio rápido](/es/guide/inicio#requisitos)). Después instala:

```bash
npm install @botmesh/core @botmesh/baileys
```

## El bot completo

```js
// bot.js
import { Bot, defineBot, isMainModule } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

const createBot = defineBot((provider) => {
  const bot = new Bot({ provider, lang: 'es' })
  const pendientes = new Map() // id de chat → Set de tareas pendientes
  const suscriptores = new Set() // ids de chat que reciben el consejo diario

  // "recuerdame 10m llamar a mamá": una tarea única con bot.delay()
  bot.when(/^recu[eé]rdame\s/i, async (ctx) => {
    const match = /^recu[eé]rdame\s+(\d+[smhd])\s+(.+)$/i.exec(ctx.body)
    if (!match) return ctx.reply('Uso: recuerdame <10s|5m|2h|1d> <texto>')
    const [, espera, texto] = match
    const chatId = ctx.from
    const tareas = pendientes.get(chatId) ?? new Set()
    pendientes.set(chatId, tareas)
    const tarea = bot.delay(espera, async () => {
      tareas.delete(tarea)
      await bot.send(chatId, `⏰ Recordatorio: ${texto}`)
    })
    tareas.add(tarea)
    await ctx.reply(`👍 Te lo recuerdo en ${espera}.`)
  })

  bot.when('recordatorios', (ctx) => ctx.reply(`📋 Recordatorios pendientes: ${pendientes.get(ctx.from)?.size ?? 0}`))

  bot.when('cancelar recordatorios', async (ctx) => {
    const tareas = pendientes.get(ctx.from) ?? new Set()
    for (const tarea of tareas) tarea.cancel()
    await ctx.reply(`🗑️ Cancelé ${tareas.size} recordatorio(s).`)
    tareas.clear()
  })

  // Todos los días a las 9:00, hora de Bogotá, corra donde corra el servidor
  bot.schedule('0 9 * * *', { timeZone: 'America/Bogota' }, async () => {
    for (const chatId of suscriptores) await bot.send(chatId, '☀️ Consejo del día: bebe un vaso de agua.')
  })
  bot.when('tip diario', (ctx) => {
    suscriptores.add(ctx.from)
    return ctx.reply('☀️ Suscrito: un consejo cada día a las 9:00 (hora de Bogotá).')
  })
  bot.when('sin tip', (ctx) => {
    suscriptores.delete(ctx.from)
    return ctx.reply('👋 Ya no recibirás el consejo diario.')
  })

  bot.onMessage((ctx) => ctx.reply('Prueba: recuerdame 10m llamar a mamá · recordatorios · cancelar recordatorios · tip diario'))

  return bot
})

export default createBot

// `node bot.js` conecta con WhatsApp; `npx botmesh dev bot.js` se salta este bloque
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'reminder-bot' }))
  bot.on('ready', () => console.log('✅ Conectado. Escribe "recuerdame 1m prueba" desde otro teléfono.'))
  await bot.start()
}
```

## Transcripción de ejemplo

Capturada con `npx botmesh dev bot.js`; el primer recordatorio llega dos
segundos después:

```text
user › recuérdame 2s estirar las piernas
bot › 👍 Te lo recuerdo en 2s.
bot › ⏰ Recordatorio: estirar las piernas
user › recuerdame 1h llamar a mamá
bot › 👍 Te lo recuerdo en 1h.
user › recordatorios
bot › 📋 Recordatorios pendientes: 1
user › cancelar recordatorios
bot › 🗑️ Cancelé 1 recordatorio(s).
user › recuerdame mañana
bot › Uso: recuerdame <10s|5m|2h|1d> <texto>
user › tip diario
bot › ☀️ Suscrito: un consejo cada día a las 9:00 (hora de Bogotá).
```

## Cómo funciona

- **`bot.delay(duración, fn)`** ejecuta `fn` una vez pasada la `duración`
  (`'10s'`, `'5m'`, `'2h'`, `'1d'` o milisegundos) y devuelve una tarea con
  `cancel()`. El handler guarda cada tarea para listarla o cancelarla
  después.
- **`bot.send(chatId, texto)`** envía fuera de un handler: cuando salta el
  recordatorio, el mensaje que lo creó ya pasó, así que primero se guarda el
  id del chat (`ctx.from`).
- **`bot.schedule(cron, { timeZone }, fn)`** corre según una expresión cron
  de 5 campos leída en una zona horaria IANA. `bot.every('30m', fn)` repite
  a intervalos fijos.
- **En memoria.** Estas tareas viven en el proceso: un reinicio las olvida.
  Para que sobrevivan a reinicios (y corran una sola vez entre varias
  réplicas), dale a la tarea un `id` y un store de schedules: ver
  [Tareas durables](/es/guide/scheduler#tareas-durables-sobreviven-a-reinicios-una-replica-por-ejecucion).

## Ejecutarlo en WhatsApp o Telegram

`node bot.js` muestra un QR: escanéalo en WhatsApp → Dispositivos
vinculados. Para Telegram, instala `@botmesh/telegram` y cambia el provider
como se muestra en [O conectar Telegram](/es/guide/inicio#o-conectar-telegram);
la factory no cambia.

## Siguientes pasos

- [Scheduler](/es/guide/scheduler): `every`, sintaxis cron, cambios de hora
- [Datos de usuario persistentes](/es/guide/datos-usuario): recuerda a los suscriptores entre reinicios
- [Bot de saludo](./bot-saludo): añade `/help` y un mensaje de bienvenida
