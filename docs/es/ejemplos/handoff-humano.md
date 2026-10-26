# Handoff humano

Construye un bot de soporte que pasa el chat a una persona cuando se lo
piden, reenvía a los agentes lo que escribe el usuario, les deja responder con
comandos y recupera el chat cuando lo cierran o dejan de contestar.

**Nivel:** Intermedio · **Etiquetas:** WhatsApp, Soporte, Handoff

**Funcionalidades:**
[handoff humano](/es/guide/handoff#handoff-humano) ·
[comandos de escape (`allowCommands`)](/es/guide/handoff#que-pasa-mientras-el-chat-esta-en-handoff) ·
[eventos `'handoff'`, `'resume'` y `'message'`](/es/guide/handoff#handoff-humano) ·
[comandos con argumentos](/es/guide/conceptos#when-respuestas-simples) ·
[enviar fuera de un handler](/es/guide/mensajes#enviar-fuera-de-un-handler) ·
[`bot.delay()`](/es/guide/scheduler)

## Requisitos

- Node.js 22.12 o superior y una carpeta vacía con `"type": "module"` en su
  `package.json` ([Inicio rápido](/es/guide/inicio#_1-instalar)).
- Mientras botmesh esté en prerelease, añade a cada paquete `@botmesh/*` el
  dist-tag de la [nota de prerelease](/es/guide/inicio#requisitos).

```bash
npm install @botmesh/core @botmesh/baileys
```

## El bot completo

```js
// bot.js
import { Bot, defineBot, isMainModule, slashCommandsPlugin } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

// Quién atiende los chats derivados: sus ids de usuario, tal como los muestra /id
const AGENTS = (process.env.AGENTS ?? 'agente').split(',')
// Devuelve el chat al bot si ningún agente escribe en este tiempo
const AGENT_TIMEOUT = '10m'

const createBot = defineBot((provider) => {
  // 1. `/bot` sigue funcionando mientras una persona atiende el chat
  const bot = new Bot({ provider, lang: 'es', handoff: { allowCommands: ['/bot'] } })
  const tickets = new Map() // número de ticket → id del chat
  let lastTicket = 0
  const timers = new Map() // id del chat → temporizador de inactividad
  const isAgent = (ctx) => AGENTS.includes(ctx.sender)
  const ticketOf = (chatId) => [...tickets].find(([, id]) => id === chatId)?.[0]

  // Reinicia la cuenta atrás que devuelve el chat al bot
  const armTimer = (chatId) => {
    timers.get(chatId)?.cancel()
    timers.set(chatId, bot.delay(AGENT_TIMEOUT, () => bot.resume(chatId, { reason: 'timeout' })))
  }

  bot.plug(slashCommandsPlugin, {
    greeting: '👋 Soy el bot de soporte. Pregúntame el "horario" o envía "humano" para hablar con una persona.',
  })

  bot.when('horario', (ctx) => ctx.reply('🕘 Abrimos de lunes a viernes, de 9:00 a 18:00.'))

  // 2. El usuario pide una persona: se deriva el chat
  bot.when(['humano', 'agente', 'hablar con una persona'], async (ctx) => {
    await ctx.reply('🙋 Te paso con una persona. Envía /bot para volver conmigo.')
    await ctx.handoff({ reason: 'user request' })
  })

  // 3. Avisa a los agentes y arranca la cuenta atrás
  bot.on('handoff', async ({ chatId }) => {
    const ticket = ++lastTicket
    tickets.set(ticket, chatId)
    armTimer(chatId)
    for (const agent of AGENTS) {
      await bot.send(agent, `🔔 El ticket #${ticket} necesita una persona. Responde con /reply ${ticket} <texto> y ciérralo con /done ${ticket}.`)
    }
  })

  // 4. Mientras está derivado el bot calla, pero cada mensaje sigue emitiendo 'message'
  bot.on('message', async (ctx) => {
    const ticket = ticketOf(ctx.from)
    if (!bot.isHandedOff(ctx.from) || ticket === undefined) return
    for (const agent of AGENTS) await bot.send(agent, `💬 #${ticket}: ${ctx.body}`)
  })

  // 5. Comandos de agente (solo desde los ids de los agentes)
  bot.command('reply', async (ctx, [ticket, ...words]) => {
    if (!isAgent(ctx)) return
    const chatId = tickets.get(Number(ticket))
    if (!chatId || !bot.isHandedOff(chatId)) return ctx.reply(`El ticket #${ticket} no está abierto.`)
    armTimer(chatId)
    await bot.send(chatId, `👩‍💼 ${words.join(' ')}`)
  })
  bot.command('done', async (ctx, [ticket]) => {
    if (!isAgent(ctx)) return
    const chatId = tickets.get(Number(ticket))
    if (chatId && (await bot.resume(chatId, { reason: 'agent' }))) await ctx.reply(`✅ Ticket #${ticket} cerrado.`)
  })

  // 6. El usuario llama de vuelta al bot
  bot.command('bot', (ctx) => bot.resume(ctx.from, { reason: 'user' }))

  // 7. De vuelta al bot, sea cual sea el motivo
  bot.on('resume', async ({ chatId, reason }) => {
    timers.get(chatId)?.cancel()
    timers.delete(chatId)
    for (const [ticket, id] of tickets) if (id === chatId) tickets.delete(ticket)
    await bot.send(
      chatId,
      reason === 'timeout'
        ? '⏰ Ahora mismo no hay nadie libre, así que vuelvo yo. Prueba "humano" más tarde.'
        : '🤖 Ya estoy de vuelta. Pregúntame el "horario" o envía "humano".',
    )
  })

  bot.onMessage((ctx) => ctx.reply('Pregúntame el "horario" o envía "humano" para hablar con una persona.'))

  return bot
})

export default createBot

// `node bot.js` se conecta a WhatsApp; `npx botmesh dev bot.js` se salta este bloque
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'bot-soporte' }))
  bot.on('ready', () => console.log('✅ Conectado'))
  await bot.start()
}
```

## Cómo funciona

1. **La compuerta.** Mientras un chat está en handoff, el bot no enruta sus
   mensajes: ni handlers, ni flujos, ni catch-all. Solo siguen funcionando los
   comandos de `handoff.allowCommands` que tienen un `bot.command()`, así que
   `/bot` siempre trae de vuelta al bot.
2. **Empezar el handoff.** `ctx.handoff()` cierra la compuerta de este chat y
   cancela cualquier conversación en curso. El handler que hace el handoff
   todavía puede responder.
3. **Avisar a los agentes.** El evento `'handoff'` se emite una vez por
   handoff. `bot.send(chatId, texto)` envía fuera de un handler, aquí al chat
   de cada agente. El número de ticket acorta los comandos del agente.
4. **Reenviar.** Los mensajes de un chat en handoff se siguen guardando y
   siguen emitiendo el evento `'message'`, que los reenvía a los agentes. (Tu
   CRM o tu bandeja de entrada se suscribiría aquí).
5. **Comandos de agente.** `bot.command('reply', (ctx, args) => ...)` recibe
   las palabras que siguen al comando. `isAgent(ctx)` comprueba el id del
   remitente, así que cualquier otro que escriba `/reply` no obtiene nada.
6. **De vuelta al bot.** `bot.resume(chatId, { reason })` reabre la compuerta
   y emite `'resume'` con ese motivo, lo llame quien lo llame: el agente
   (`/done`), el usuario (`/bot`) o el temporizador.
7. **El timeout.** `bot.delay(AGENT_TIMEOUT, fn)` se ejecuta una vez a los
   10 minutos, y cada respuesta del agente lo reinicia. Si ningún agente
   escribe a tiempo, el chat vuelve al bot con el mensaje de `timeout`. El
   handler de `'resume'` cancela el temporizador acabe como acabe el handoff.

El estado del handoff se guarda en el store, así que con un store persistente
([SQLite, Redis](/es/guide/store)) un chat sigue con los agentes tras un
reinicio. Este ejemplo guarda tickets y temporizadores en memoria: reconstrúyelos
al arrancar con `bot.listHandoffs()` si necesitas que sobrevivan.

## Pruébalo

```bash
npx botmesh dev bot.js --user ana
```

El agente es el usuario `agente`: `:as agente` cambia a él, y las líneas
`bot → agente ›` son lo que el bot envía al chat del agente.

```text
ana › horario
bot › 🕘 Abrimos de lunes a viernes, de 9:00 a 18:00.
ana › humano
bot › 🙋 Te paso con una persona. Envía /bot para volver conmigo.
bot → agente › 🔔 El ticket #1 necesita una persona. Responde con /reply 1 <texto> y ciérralo con /done 1.
bot → agente › 💬 #1: humano
ana › mi factura está mal
bot → agente › 💬 #1: mi factura está mal
ana › :as agente
• you are now "agente" (agente)
agente › /reply 1 Hola, soy Laura. Reviso tu factura.
bot → ana › 👩‍💼 Hola, soy Laura. Reviso tu factura.
agente › /done 1
bot → ana › 🤖 Ya estoy de vuelta. Pregúntame el "horario" o envía "humano".
bot › ✅ Ticket #1 cerrado.
agente › :as ana
• you are now "ana" (ana)
ana › humano
bot › 🙋 Te paso con una persona. Envía /bot para volver conmigo.
bot → agente › 🔔 El ticket #2 necesita una persona. Responde con /reply 2 <texto> y ciérralo con /done 2.
bot → agente › 💬 #2: humano
ana › /bot
bot › 🤖 Ya estoy de vuelta. Pregúntame el "horario" o envía "humano".
ana › horario
bot › 🕘 Abrimos de lunes a viernes, de 9:00 a 18:00.
```

## Ejecútalo en WhatsApp o Telegram

Pon en `AGENTS` los ids de los agentes (envía `/id` desde el teléfono de cada
agente para verlos), arranca con `node bot.js` y escanea el QR desde
**WhatsApp → Dispositivos vinculados**:

```bash
AGENTS=573001234567@s.whatsapp.net node bot.js
```

En Telegram los ids son números (`AGENTS=123456789`); instala
`@botmesh/telegram` y cambia el provider como en
[O conectar Telegram](/es/guide/inicio#o-conectar-telegram).

## Siguientes pasos

- [Handoff humano y listas de acceso](/es/guide/handoff): persistencia, eventos y blacklists
- [Bot de grupo](./bot-de-grupo): comandos que solo algunos usuarios pueden usar
- [Integraciones](/es/guide/integraciones): handoff a una bandeja real como Chatwoot (aún no en npm)
