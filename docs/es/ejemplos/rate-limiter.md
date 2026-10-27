# Plugin: rate limiter

Construye un plugin reutilizable que limita cuántos mensajes puede enviar
cada usuario por ventana de tiempo, y enchúfalo a un bot.

**Nivel:** Intermedio · **Etiquetas:** WhatsApp, Telegram, Plugins, Hooks

**Funciones que muestra:** [`definePlugin()`](/es/guide/plugins#crear-un-plugin) ·
[hooks `before('message')`](/es/guide/hooks) ·
[`ctx.abort()`](/es/guide/hooks) ·
[`ctx.onDispose()` y unplug](/es/guide/plugins#plugin-configurable-con-cleanup) ·
[configuración del plugin](/es/guide/plugins#plugin-configurable-con-cleanup)

## Requisitos previos

Node.js 22.12 o superior y una carpeta con `"type": "module"` (ver
[Inicio rápido](/es/guide/inicio#requisitos)). Después instala:

```bash
npm install @botmesh/core @botmesh/baileys
```

## El bot completo

```js
// bot.js
import { Bot, definePlugin, defineBot, isMainModule } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

const rateLimitPlugin = definePlugin({
  name: 'rate-limit',
  version: '1.0.0',
  description: 'Como máximo N mensajes por usuario y ventana',
  install(ctx, config = {}) {
    const max = config.max ?? 10
    const windowMs = config.windowMs ?? 60_000
    const contadores = new Map() // remitente → { count, resetAt }

    // Corre antes del enrutado: abort() descarta el mensaje, next() lo deja pasar
    ctx.bot.before('message', async (msg, next) => {
      const ahora = Date.now()
      let entrada = contadores.get(msg.sender)
      if (!entrada || entrada.resetAt < ahora) {
        entrada = { count: 0, resetAt: ahora + windowMs }
        contadores.set(msg.sender, entrada)
      }
      entrada.count++
      if (entrada.count === max + 1) await msg.reply(`⏳ Más despacio: como máximo ${max} mensajes cada ${windowMs / 1000}s.`)
      if (entrada.count > max) return msg.abort()
      await next()
    })

    // Los hooks se quitan al desenchufar; lo demás se limpia aquí
    const barrido = setInterval(() => {
      const ahora = Date.now()
      for (const [remitente, entrada] of contadores) if (entrada.resetAt < ahora) contadores.delete(remitente)
    }, windowMs)
    ctx.onDispose(() => clearInterval(barrido))
  },
})

const createBot = defineBot((provider) => {
  const bot = new Bot({ provider, lang: 'es' })

  // plug() devuelve unplug(): quita el hook y ejecuta onDispose()
  bot.plug(rateLimitPlugin, { max: 3, windowMs: 60_000 })

  bot.onMessage((ctx) => ctx.reply(`✅ Recibido "${ctx.body}"`))

  return bot
})

export default createBot

// `node bot.js` conecta con WhatsApp; `npx botmesh dev bot.js` se salta este bloque
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'rate-limit-bot' }))
  bot.on('ready', () => console.log('✅ Conectado. Envía varios mensajes seguidos.'))
  await bot.start()
}
```

## Transcripción de ejemplo

Capturada con `npx botmesh dev bot.js`; el quinto mensaje se descarta en
silencio, así que el usuario recibe un solo aviso por ventana:

```text
user › uno
bot › ✅ Recibido "uno"
user › dos
bot › ✅ Recibido "dos"
user › tres
bot › ✅ Recibido "tres"
user › cuatro
bot › ⏳ Más despacio: como máximo 3 mensajes cada 60s.
user › cinco
```

## Cómo funciona

- **`definePlugin({ name, install })`** empaqueta la funcionalidad;
  `install` recibe el contexto del plugin y la configuración pasada a
  `bot.plug(plugin, config)`. Debe ser síncrono.
- **`ctx.bot.before('message', (msg, next) => ...)`** corre antes del
  enrutado. Llama a `next()` para continuar; `msg.abort()` detiene el
  mensaje, así que ningún handler, flujo ni catch-all lo ve.
- **Por remitente.** `msg.sender` es el id estable del usuario, así que en
  un grupo cada participante tiene su propio contador.
- **Limpieza.** Los hooks y handlers registrados con `ctx.bot` se deshacen
  con la función que devuelve `bot.plug()`; los timers y recursos externos
  van en `ctx.onDispose()`.
- **También en la salida.** Un hook `before('send')` ve cada mensaje que
  envía el bot (`{ chatId, content }`) y puede hacer `abort()` igual. Para el
  ritmo anti-ban de WhatsApp, `@botmesh/baileys` ya limita los envíos (ver
  [Rate limiting](/es/guide/rate-limiting)).

## Ejecutarlo en WhatsApp o Telegram

`node bot.js` muestra un QR: escanéalo en WhatsApp → Dispositivos
vinculados. Para Telegram, instala `@botmesh/telegram` y cambia el provider
como se muestra en [O conectar Telegram](/es/guide/inicio#o-conectar-telegram);
el plugin funciona igual en todos los canales.

## Siguientes pasos

- [Plugins](/es/guide/plugins): `requires`, `multiple` y paquetes de plugins
- [Hooks](/es/guide/hooks): todos los puntos de hook y su payload
- [Handoff y listas de acceso](/es/guide/handoff): bloquea o permite remitentes sin código
