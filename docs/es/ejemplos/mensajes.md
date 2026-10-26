# Enviar mensajes

Construye un bot que muestra todas las formas de responder a un texto:
palabras clave, regex, citas, reacciones, datos del remitente y respuestas
de varias líneas.

**Nivel:** Principiante · **Etiquetas:** WhatsApp, Telegram, Triggers

**Funciones que muestra:** [formas de trigger](/es/guide/conceptos#when-respuestas-simples) ·
[helpers de respuesta](/es/guide/mensajes#helpers-de-respuesta-dentro-de-un-handler) ·
[`ctx.react()`](/es/guide/mensajes#reaccionar) ·
[`ctx.senderInfo`, `ctx.sender`, `ctx.isGroup`](/es/guide/conceptos#el-objeto-ctx) ·
[catch-all](/es/guide/conceptos#el-evento-message-vs-onmessage)

## Requisitos previos

Node.js 22.12 o superior y una carpeta con `"type": "module"` (ver
[Inicio rápido](/es/guide/inicio#requisitos), que también explica las
etiquetas de prerelease). Después instala:

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

  // Una palabra clave, o cualquiera de una lista (mensaje completo, sin importar mayúsculas ni tildes)
  bot.when('hola', (ctx) => ctx.reply('👋 ¡Hola!'))
  bot.when(['adios', 'chao', 'hasta luego'], (ctx) => ctx.reply('👋 ¡Hasta luego!'))

  // La palabra en cualquier parte del mensaje
  bot.when({ pattern: 'factura', match: 'contains' }, (ctx) => ctx.reply('🧾 Veo que mencionaste una factura'))

  // Expresiones regulares
  bot.when(/[\w.]+@[\w.]+\.\w+/, (ctx) => ctx.reply('📧 Eso parece un email'))
  bot.when(/\d{4,}/, (ctx) => ctx.reply(`🔢 Detecté un número largo en "${ctx.body}"`))

  // Citar el mensaje del usuario, o reaccionar a él
  bot.when('citar', (ctx) => ctx.quote('Respondo a tu mensaje exacto'))
  bot.when('buen bot', (ctx) => ctx.react('👍'))

  // Quién escribió y dónde
  bot.when('quien soy', (ctx) =>
    ctx.reply(`Eres ${ctx.senderInfo.displayName ?? 'alguien'} (${ctx.sender}) en un ${ctx.isGroup ? 'grupo' : 'chat privado'}.`),
  )

  // Texto de varias líneas con formato estilo WhatsApp
  bot.when('info', (ctx) => ctx.reply(['ℹ️ *Info del bot*', '', '• Motor: botmesh', '• Funciona en: WhatsApp, Telegram'].join('\n')))

  bot.onMessage((ctx) => ctx.reply('🤔 No reconocí eso. Prueba: hola, citar, quien soy, info.'))

  return bot
})

export default createBot

// `node bot.js` conecta con WhatsApp; `npx botmesh dev bot.js` se salta este bloque
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'messages-bot' }))
  bot.on('ready', () => console.log('✅ Conectado. Escribe "hola" desde otro teléfono.'))
  await bot.start()
}
```

## Transcripción de ejemplo

Capturada con `npx botmesh dev bot.js --name Ana`:

```text
user › Hola
bot › 👋 ¡Hola!
user › hasta luego
bot › 👋 ¡Hasta luego!
user › ¿me reenvías la factura?
bot › 🧾 Veo que mencionaste una factura
user › ana@example.com
bot › 📧 Eso parece un email
user › mi código es 123456
bot › 🔢 Detecté un número largo en "mi código es 123456"
user › citar
bot › Respondo a tu mensaje exacto
user › buen bot
bot › [reaction: 👍]
user › quién soy
bot › Eres Ana (user) en un chat privado.
user › info
bot › ℹ️ *Info del bot*

      • Motor: botmesh
      • Funciona en: WhatsApp, Telegram
user › hola a todos
bot › 🤔 No reconocí eso. Prueba: hola, citar, quien soy, info.
```

## Cómo funciona

- **Exacto por defecto.** `bot.when('hola')` coincide con el mensaje
  completo tras normalizar mayúsculas, tildes y espacios: "Hola" coincide,
  "hola a todos" no.
- **`match: 'contains'`** (también `'startsWith'` y `'endsWith'`) coincide
  con parte del mensaje; una **regex** coincide en cualquier parte.
- **Decide la especificidad** cuando varios triggers coinciden: el texto
  exacto gana a la regex y la regex a `contains` (ver
  [Precedencia](/es/guide/triggers#precedencia)).
- **`ctx.quote(texto)`** responde citando el mensaje entrante;
  **`ctx.react(emoji)`** reacciona a él (los canales sin reacciones lo
  omiten).
- **`ctx.senderInfo.displayName`** es el nombre de perfil del remitente
  cuando el transporte lo informa; `ctx.sender` es su id estable, el mismo en
  un privado y en un grupo.
- Baileys no tiene botones nativos: para una elección rápida usa una
  [encuesta](./bot-encuesta) o un [menú](./bot-menu) numerado.

## Ejecutarlo en WhatsApp o Telegram

`node bot.js` muestra un QR: escanéalo en WhatsApp → Dispositivos
vinculados. Para Telegram, instala `@botmesh/telegram` y cambia el provider
como se muestra en [O conectar Telegram](/es/guide/inicio#o-conectar-telegram);
la factory no cambia.

## Siguientes pasos

- [Respuestas con media](./media): fotos, archivos, ubicaciones y contactos
- [Bot de FAQ](./bot-faq): respuestas por palabra clave con un fallback
- [Mensajes y media](/es/guide/mensajes): indicador de escritura, ediciones, textos largos
