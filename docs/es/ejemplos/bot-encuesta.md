# Bot de encuestas

Construye un bot que envía encuestas nativas, responde cada voto con el
recuento en vivo y reacciona a los mensajes con emoji.

**Nivel:** Principiante · **Etiquetas:** WhatsApp, Telegram, Encuestas, Reacciones

**Funciones que muestra:** [`ctx.poll()`](/es/guide/mensajes#botones-normalizados-degradados-por-transporte) ·
[votos de encuestas (`bot.on('poll')`)](/es/guide/mensajes#votos-de-encuestas) ·
[`bot.send()` fuera de un handler](/es/guide/mensajes#enviar-fuera-de-un-handler) ·
[`ctx.react()`](/es/guide/mensajes#reaccionar) ·
[`:click` del simulador](/es/guide/simulador#_3-comandos-dentro-del-simulador)

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

  // Opción única
  bot.when('votar', (ctx) => ctx.poll('¿Qué cenamos esta noche?', ['🍕 Pizza', '🍣 Sushi', '🥗 Ensalada']))

  // Opción múltiple: tercer argumento `true`
  bot.when('dias', (ctx) => ctx.poll('¿Qué días puedes venir?', ['Lunes', 'Miércoles', 'Viernes'], true))

  // Cada voto llega aquí con el recuento actual de toda la encuesta
  bot.on('poll', async (vote) => {
    const elegidas = vote.options.filter((o) => o.voters?.includes(vote.senderId)).map((o) => o.name)
    const recuento = vote.options.map((o) => `${o.name}: ${o.votes}`).join(' · ')
    await bot.send(vote.ref.chatId, elegidas.length ? `🗳️ Elegiste ${elegidas.join(', ')}\n📊 ${recuento}` : '🗳️ Voto retirado')
  })

  // Reacciona al mensaje del usuario en vez de responder
  bot.when(['gracias', 'genial', 'muchas gracias'], (ctx) => ctx.react('❤️'))

  bot.onMessage((ctx) => ctx.reply('Envía "votar" o "días" para recibir una encuesta.'))

  return bot
})

export default createBot

// `node bot.js` conecta con WhatsApp; `npx botmesh dev bot.js` se salta este bloque
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'poll-bot' }))
  bot.on('ready', () => console.log('✅ Conectado. Escribe "votar" desde otro teléfono.'))
  await bot.start()
}
```

## Transcripción de ejemplo

Capturada con `npx botmesh dev bot.js`; `:click 2` vota por la segunda
opción de la última encuesta:

```text
user › votar
bot › [poll] ¿Qué cenamos esta noche?
        [1] 🍕 Pizza
        [2] 🍣 Sushi
        [3] 🥗 Ensalada
      (:click <n> to vote)
user › :click 2
• voted for "🍣 Sushi"
bot › 🗳️ Elegiste 🍣 Sushi
      📊 🍕 Pizza: 0 · 🍣 Sushi: 1 · 🥗 Ensalada: 0
user › días
bot › [poll · multiple choice] ¿Qué días puedes venir?
        [1] Lunes
        [2] Miércoles
        [3] Viernes
      (:click <n> to vote)
user › :click 3
• voted for "Viernes"
bot › 🗳️ Elegiste Viernes
      📊 Lunes: 0 · Miércoles: 0 · Viernes: 1
user › gracias
bot › [reaction: ❤️]
```

## Cómo funciona

- **`ctx.poll(pregunta, opciones, multiSelect?)`** envía una encuesta
  nativa. Las encuestas son nativas en WhatsApp con Baileys y en Telegram;
  la WhatsApp Cloud API no las tiene (allí `ctx.poll()` rechaza con
  `UnsupportedContentError`: usa botones, ver el [Bot de menú](./bot-menu)).
- **Los votos son eventos, no mensajes.** `bot.on('poll')` recibe
  `{ ref, senderId, options }`, donde `options` trae cada opción con sus
  `votes` y `voters`. Cambiar o retirar un voto lo dispara otra vez.
- **`bot.send(chatId, texto)`** envía fuera de un handler;
  `vote.ref.chatId` es el chat donde se votó la encuesta.
- **`ctx.react(emoji)`** reacciona al mensaje entrante. Los canales sin
  reacciones resuelven `{ skipped: true }` en vez de fallar.
- En WhatsApp los votos van cifrados de extremo a extremo: el provider los
  descifra, pero solo para encuestas que este proceso envió o vio (ver
  [Votos de encuestas](/es/guide/mensajes#votos-de-encuestas)).

## Ejecutarlo en WhatsApp o Telegram

`node bot.js` muestra un QR: escanéalo en WhatsApp → Dispositivos
vinculados. En Telegram, instala `@botmesh/telegram` y cambia el provider
como se muestra en [O conectar Telegram](/es/guide/inicio#o-conectar-telegram);
sus encuestas se envían no anónimas para que los votos lleguen al bot.

## Siguientes pasos

- [Respuestas con media](./media): imágenes, documentos, ubicaciones y contactos
- [Bot de menú](./bot-menu): botones en canales sin encuestas
- [Mensajes y media](/es/guide/mensajes): todos los métodos de envío
