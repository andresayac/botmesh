# Bot de saludo

Construye un bot que da la bienvenida una sola vez a cada usuario, saluda,
repite lo que le envías y lista sus comandos.

**Nivel:** Principiante · **Etiquetas:** WhatsApp, Telegram, Comandos

**Funciones que muestra:** [trigger `WELCOME`](/es/guide/triggers#welcome) ·
[triggers de texto y regex](/es/guide/conceptos#when-respuestas-simples) ·
[`ctx.pass()`](/es/guide/conceptos#los-handlers-consumen-por-defecto) ·
[comandos slash](/es/guide/plugins#incluido-slashcommands) ·
[catch-all](/es/guide/conceptos#el-evento-message-vs-onmessage) ·
[simulador de terminal](/es/guide/simulador)

## Requisitos previos

Node.js 22.12 o superior y una carpeta con `"type": "module"` (ver
[Inicio rápido](/es/guide/inicio#requisitos)). Después instala:

```bash
npm install @botmesh/core @botmesh/baileys
```

## El bot completo

```js
// bot.js
import { Bot, WELCOME, defineBot, isMainModule, slashCommandsPlugin } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

const AYUDA = [
  '🤖 *Lo que sé hacer*',
  '• hola: te saludo',
  '• repite <texto>: repito tu texto',
  '• /id: tu id · /ping: ¿sigo vivo?',
].join('\n')

const createBot = defineBot((provider) => {
  const bot = new Bot({ provider, lang: 'es' })

  // /start /help /reset /cancel /id /ping; /start y /help responden con AYUDA
  bot.plug(slashCommandsPlugin, { greeting: AYUDA })

  // Solo en el primer contacto: saluda una vez por usuario y deja seguir el mensaje
  bot.when(WELCOME, async (ctx) => {
    await ctx.reply(`🎉 ¡Bienvenida al bot de demo, ${ctx.pushName ?? 'amiga'}!`)
    ctx.pass()
  })

  // Coincidencia con el mensaje completo, sin importar mayúsculas ni tildes
  bot.when(['hola', 'buenas', 'hey'], (ctx) =>
    ctx.reply(`👋 ¡Hola ${ctx.pushName ?? 'de nuevo'}! Envía /help para ver lo que sé hacer.`),
  )

  // Un trigger regex: todo lo que va después de "repite"
  bot.when(/^repite\s+/i, (ctx) => ctx.reply(`🔁 ${ctx.body.replace(/^repite\s+/i, '')}`))

  // Solo se ejecuta si nada de lo anterior manejó el mensaje
  bot.onMessage((ctx) => ctx.reply('🤔 No te entendí. Envía /help.'))

  return bot
})

export default createBot

// `node bot.js` conecta con WhatsApp; `npx botmesh dev bot.js` se salta este bloque
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'greeting-bot' }))
  bot.on('ready', () => console.log('✅ Conectado. Escribe "hola" desde otro teléfono.'))
  await bot.start()
}
```

## Transcripción de ejemplo

Capturada con `npx botmesh dev bot.js --name Ana`:

```text
user › Hóla
bot › 🎉 ¡Bienvenida al bot de demo, Ana!
bot › 👋 ¡Hola Ana! Envía /help para ver lo que sé hacer.
user › repite ¡Buenos días!
bot › 🔁 ¡Buenos días!
user › /help
bot › 🤖 *Lo que sé hacer*
      • hola: te saludo
      • repite <texto>: repito tu texto
      • /id: tu id · /ping: ¿sigo vivo?
user › /ping
bot › pong 🏓
user › ¿qué tal?
bot › 🤔 No te entendí. Envía /help.
```

## Cómo funciona

- **`WELCOME`** se dispara con el primer mensaje de cada usuario (por chat en
  un privado, por participante en un grupo) y corre antes que cualquier otro
  trigger. `ctx.pass()` deja seguir el mismo mensaje, así que "Hóla" también
  llega al handler de `hola`. `/reset` rearma la bienvenida.
- **Los triggers de texto** comparan el mensaje completo ya normalizado
  (minúsculas, sin tildes, espacios colapsados): `'hola'` coincide con
  "Hóla " pero no con "hola amigo". Una lista coincide con cualquiera de sus
  entradas.
- **Una regex** coincide en cualquier parte del texto; `ctx.body` conserva el
  texto original, así que la repetición respeta lo que escribió el usuario.
- **`slashCommandsPlugin`** añade `/start`, `/help`, `/reset`, `/cancel`,
  `/id` y `/ping`; `greeting` reemplaza el texto de `/start` y `/help`.
  `lang: 'es'` pone en español sus respuestas integradas.
- **`bot.onMessage()`** es el catch-all: solo corre cuando nada más manejó el
  mensaje.

## Ejecutarlo en WhatsApp o Telegram

`node bot.js` muestra un QR: escanéalo en WhatsApp → Dispositivos
vinculados. Para Telegram, instala `@botmesh/telegram` y cambia el provider
como se muestra en [O conectar Telegram](/es/guide/inicio#o-conectar-telegram);
la factory no cambia.

## Siguientes pasos

- [Bot de FAQ](./bot-faq): más formas de trigger (contains, regex, listas)
- [Triggers especiales](/es/guide/triggers): `WELCOME`, tipos de mensaje y llamadas
- [Testing](/es/guide/testing): comprueba estas respuestas con `createTestBot`
