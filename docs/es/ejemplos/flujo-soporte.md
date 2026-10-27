# Soporte con timeout

Construye un servicio de soporte que recoge un problema y su urgencia, abre
un ticket y maneja con mensajes propios las sesiones abandonadas o
canceladas.

**Nivel:** Intermedio · **Etiquetas:** WhatsApp, Telegram, Conversaciones

**Funciones que muestra:** [`bot.conversation()`](/es/guide/flujos#mas-alla-del-dsl) ·
[`c.waitText()` con `timeout` y `validate`](/es/guide/flujos#mas-alla-del-dsl) ·
[`c.choose()`](/es/guide/flujos#mas-alla-del-dsl) ·
[`ConversationTimeout` / `ConversationCancelled`](/es/guide/flujos#mas-alla-del-dsl) ·
[`/cancel` sale de una conversación](/es/guide/plugins#incluido-slashcommands)

## Requisitos previos

Node.js 22.12 o superior y una carpeta con `"type": "module"` (ver
[Inicio rápido](/es/guide/inicio#requisitos)). Después instala:

```bash
npm install @botmesh/core @botmesh/baileys
```

## El bot completo

```js
// bot.js
import {
  Bot, ConversationCancelled, ConversationTimeout, defineBot, isMainModule, slashCommandsPlugin,
} from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

const createBot = defineBot((provider) => {
  const bot = new Bot({ provider, lang: 'es' })
  bot.plug(slashCommandsPlugin)
  let siguienteTicket = 1001

  // Arranca cuando el usuario envía "soporte"
  bot.conversation('soporte', async (c, ctx) => {
    try {
      await ctx.reply('🛠️ *Soporte técnico*\nDescribe tu problema en una frase (tienes 2 minutos):')
      const problema = await c.waitText({
        timeout: '2m',
        validate: (texto) => (texto.length >= 10 ? true : '✏️ Dame un poco más de detalle, por favor.'),
      })
      const prioridad = await c.choose('¿Qué tan urgente es?', {
        alta: 'Urgente 🔴',
        media: 'Hoy 🟡',
        baja: 'Sin prisa 🟢',
      }, { timeout: '2m' })
      await ctx.reply(`🎫 Ticket #${siguienteTicket++} abierto ("${problema}", prioridad: ${prioridad}). Te contactaremos pronto.`)
    } catch (err) {
      if (err instanceof ConversationTimeout) await ctx.reply('⏰ La sesión de soporte caducó. Envía "soporte" para empezar de nuevo.')
      else if (err instanceof ConversationCancelled) await ctx.reply('🗑️ Borrador del ticket descartado.')
      else throw err
    }
  })

  bot.onMessage((ctx) => ctx.reply('Envía "soporte" para abrir un ticket.'))

  return bot
})

export default createBot

// `node bot.js` conecta con WhatsApp; `npx botmesh dev bot.js` se salta este bloque
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'support-bot' }))
  bot.on('ready', () => console.log('✅ Conectado. Escribe "soporte" desde otro teléfono.'))
  await bot.start()
}
```

## Transcripción de ejemplo

Capturada con `npx botmesh dev bot.js`:

```text
user › soporte
bot › 🛠️ *Soporte técnico*
      Describe tu problema en una frase (tienes 2 minutos):
user › no va
bot › ✏️ Dame un poco más de detalle, por favor.
user › El router se reinicia cada hora
bot › ¿Qué tan urgente es?

      1) Urgente 🔴
      2) Hoy 🟡
      3) Sin prisa 🟢
user › 1
bot › 🎫 Ticket #1001 abierto ("El router se reinicia cada hora", prioridad: alta). Te contactaremos pronto.
user › soporte
bot › 🛠️ *Soporte técnico*
      Describe tu problema en una frase (tienes 2 minutos):
user › /cancel
bot › ✅ Conversación cancelada.
bot › 🗑️ Borrador del ticket descartado.
```

Si el usuario no responde en dos minutos, el bot contesta
`⏰ La sesión de soporte caducó. Envía "soporte" para empezar de nuevo.`

## Cómo funciona

- **`bot.conversation(nombre, async (c, ctx) => ...)`** es código async
  normal: arranca cuando un mensaje coincide con `nombre` (o con la opción
  `trigger`), `ctx` es ese mensaje y `c` contiene las esperas. Úsalo cuando
  la lógica no cabe en un `flow()` lineal.
- **`c.waitText({ timeout, validate })`** espera el siguiente texto del
  mismo usuario. Una respuesta rechazada envía el texto de `validate` y
  vuelve a esperar.
- **`c.choose(texto, opciones)`** envía un menú numerado y resuelve con la
  clave elegida.
- **Los errores terminan la conversación.** Un usuario que no responde hace
  que la espera lance `ConversationTimeout`; `/cancel` confirma la
  cancelación por su cuenta y hace que la espera lance
  `ConversationCancelled`. Captúralos para responder o limpiar (aquí, se
  descarta el borrador del ticket); sin `catch`, un timeout envía el texto
  integrado, que se personaliza con `conversation.timeoutMessage`.
- **Los comandos siempre escapan.** `/cancel` y `/reset` ganan a una
  conversación activa, así que nadie queda atrapado.

## Ejecutarlo en WhatsApp o Telegram

`node bot.js` muestra un QR: escanéalo en WhatsApp → Dispositivos
vinculados. Para Telegram, instala `@botmesh/telegram` y cambia el provider
como se muestra en [O conectar Telegram](/es/guide/inicio#o-conectar-telegram);
la factory no cambia.

## Siguientes pasos

- [Handoff y listas de acceso](/es/guide/handoff): pasa el chat a un agente humano
- [Flujos conversacionales](/es/guide/flujos): reintentos, inactividad, flujos persistentes
- [Plugin: rate limiter](./rate-limiter): protege el bot de avalanchas de mensajes
