# Bot de grupo

Construye un bot para chats de grupo: un quiz que cada miembro juega por su
cuenta, un marcador compartido, normas que solo los administradores pueden
cambiar y un saludo cuando alguien menciona al bot.

**Nivel:** Intermedio · **Etiquetas:** WhatsApp, Telegram, Grupos

**Funcionalidades:**
[conversaciones por participante](/es/guide/conceptos#las-conversaciones-de-grupo-son-por-participante) ·
[`scope('group')`](/es/guide/flujos#metodos-del-dsl) ·
[menciones (`ctx.mentions`)](/es/guide/mensajes#el-messagecontext-completo) ·
[`groupMode`](/es/guide/configuracion#enrutado-y-conversaciones) ·
[comandos con argumentos](/es/guide/conceptos#when-respuestas-simples) ·
[triggers de función y `contains`](/es/guide/conceptos#when-respuestas-simples)

## Requisitos

- Node.js 22.12 o superior y una carpeta vacía con `"type": "module"` en su
  `package.json` ([Inicio rápido](/es/guide/inicio#_1-instalar)).

```bash
npm install @botmesh/core @botmesh/baileys
```

## El bot completo

```js
// bot.js
import { Bot, defineBot, flow, isMainModule, slashCommandsPlugin } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

// Administradores del bot: sus ids de usuario, tal como los muestra /id (WhatsApp: 573001234567@s.whatsapp.net)
const ADMINS = (process.env.ADMINS ?? 'ana').split(',')

const createBot = defineBot((provider) => {
  // 1. Los valores por defecto que importan en grupos: se enruta todo mensaje del grupo
  //    (groupMode: 'all') y cada participante tiene su propia conversación (conversationScope: 'participant')
  const bot = new Bot({ provider, lang: 'es' })
  const rules = new Map() // id del grupo → texto de las normas
  const scores = new Map() // id del grupo → Map(nombre → puntos)
  const isAdmin = (ctx) => ADMINS.includes(ctx.sender)
  const nameOf = (ctx) => ctx.pushName ?? ctx.sender
  bot.plug(slashCommandsPlugin) // /id, /help, /cancel...

  // 2. Un quiz por participante: dos personas pueden jugar a la vez
  bot.use(
    flow({ pattern: 'quiz', match: 'contains' })
      .scope('group')
      .ask((ctx) => `🧠 ${nameOf(ctx)}, ¿2 + 2?`, 'q1')
      .ask((ctx) => `🌍 ${nameOf(ctx)}, ¿capital de Francia?`, 'q2')
      .say((ctx, c) => {
        const points = (c.state.q1.trim() === '4' ? 1 : 0) + (['paris', 'parís'].includes(c.state.q2.trim().toLowerCase()) ? 1 : 0)
        const board = scores.get(ctx.from) ?? new Map()
        board.set(nameOf(ctx), (board.get(nameOf(ctx)) ?? 0) + points)
        scores.set(ctx.from, board)
        return `🏁 ${nameOf(ctx)}: ${points}/2`
      }),
  )

  // 3. Comandos para todos
  bot.command('rules', (ctx) => ctx.reply(rules.get(ctx.from) ?? 'Todavía no hay normas.'))
  bot.command('scores', (ctx) => {
    const board = [...(scores.get(ctx.from) ?? [])].sort((a, b) => b[1] - a[1])
    return ctx.reply(board.length ? board.map(([name, points]) => `${name}: ${points}`).join('\n') : 'Aún no hay puntos. Envía "quiz".')
  })

  // 4. Comandos solo para administradores
  bot.command('setrules', async (ctx, args) => {
    if (!isAdmin(ctx)) return ctx.reply('⛔ Solo los administradores pueden cambiar las normas.')
    rules.set(ctx.from, `📜 ${args.join(' ')}`)
    await ctx.reply('✅ Normas actualizadas.')
  })
  bot.command('resetscores', async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply('⛔ Solo los administradores pueden reiniciar los puntos.')
    scores.delete(ctx.from)
    await ctx.reply('🧹 Puntos borrados.')
  })

  // 5. En privado, explica; en un grupo, responde solo cuando alguien menciona al bot
  bot.onMessage((ctx) => {
    if (!ctx.isGroup) return ctx.reply('Añádeme a un grupo y envía "quiz" allí.')
    if (provider.selfId != null && ctx.mentions.includes(provider.selfId)) {
      return ctx.reply(`👋 ¡Hola ${nameOf(ctx)}! Envía "quiz" para jugar, /scores o /rules.`)
    }
  })

  return bot
})

export default createBot

// `node bot.js` se conecta a WhatsApp; `npx botmesh dev bot.js` se salta este bloque
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'bot-grupo' }))
  bot.on('ready', () => console.log('✅ Conectado'))
  await bot.start()
}
```

## Cómo funciona

1. **Valores por defecto en grupos.** Todo mensaje del grupo llega al bot, y
   en un grupo cada participante tiene su propia conversación. `ctx.from` es el
   grupo (el chat) y `ctx.sender`, la persona que escribió.
2. **Un quiz por persona.** Ana y Bob pueden ir por la mitad del quiz a la vez:
   cada respuesta va a la conversación de quien la envía. `.scope('group')`
   deja el quiz fuera de los chats privados. `{ pattern: 'quiz', match: 'contains' }`
   también lo arranca desde `@bot quiz`, y el id del flujo (`quiz`) sale de ese
   patrón. Los puntos se guardan por grupo en un `Map`.
3. **Comandos para todos.** `/rules` y `/scores` responden con los datos del
   grupo en el que se envían.
4. **Comandos solo para administradores.** El bot compara `ctx.sender` con
   `ADMINS`. Son los administradores del bot, no los del grupo: botmesh no lee
   la lista de administradores de un grupo, así que guarda la tuya en la
   configuración. `/id` (de `slashCommandsPlugin`) muestra el id del chat en
   el que se envía: en privado con el bot es tu id de usuario; en un grupo, el
   id del grupo.
5. **Menciones.** `ctx.mentions` lista los usuarios que menciona un mensaje, y
   `provider.selfId` es el id del propio bot una vez conectado. El catch-all
   las comprueba y solo ve lo que ningún otro handler tomó, así que `@bot quiz`
   sigue arrancando el quiz.
6. **Silencio en grupos.** En un grupo el catch-all solo responde a una
   mención, así que el bot no contesta a cada mensaje del grupo; en privado
   explica cómo usarlo.

## Pruébalo

```bash
npx botmesh dev bot.js --user ana --name Ana --group equipo
```

`:as bob Bob` cambia a otro miembro del mismo grupo; al bot se le menciona
como `@bot`.

```text
ana @ equipo › hola a todos
ana @ equipo › @bot hola
bot › 👋 ¡Hola Ana! Envía "quiz" para jugar, /scores o /rules.
ana @ equipo › quiz
bot › 🧠 Ana, ¿2 + 2?
ana @ equipo › :as bob Bob
• you are now "bob" (Bob) in group "equipo"
bob @ equipo › quiz
bot › 🧠 Bob, ¿2 + 2?
bob @ equipo › 4
bot › 🌍 Bob, ¿capital de Francia?
bob @ equipo › :as ana Ana
• you are now "ana" (Ana) in group "equipo"
ana @ equipo › 4
bot › 🌍 Ana, ¿capital de Francia?
ana @ equipo › París
bot › 🏁 Ana: 2/2
ana @ equipo › :as bob Bob
• you are now "bob" (Bob) in group "equipo"
bob @ equipo › Roma
bot › 🏁 Bob: 1/2
bob @ equipo › /scores
bot › Ana: 2
      Bob: 1
bob @ equipo › /setrules Sed amables
bot › ⛔ Solo los administradores pueden cambiar las normas.
bob @ equipo › :as ana Ana
• you are now "ana" (Ana) in group "equipo"
ana @ equipo › /setrules Sed amables. Nada de spam.
bot › ✅ Normas actualizadas.
ana @ equipo › /rules
bot › 📜 Sed amables. Nada de spam.
```

## Variante: solo cuando lo mencionan

Para que el bot ignore todo mensaje de grupo que no lo mencione, usa
`groupMode` (`'commands'` deja pasar solo comandos):

```js
const bot = new Bot({ provider, lang: 'es', groupMode: 'mentions' })
```

El filtro se aplica a **todos** los mensajes del grupo, también a las
respuestas de una conversación en curso, así que en este modo un jugador
tiene que mencionar al bot en cada respuesta, y la mención forma parte del
texto de la respuesta. Los comandos también necesitan la mención
(`/rules @bot`; en Telegram, `/rules@TuBot` cuenta como una):

```text
ana @ equipo › quiz
ana @ equipo › @bot quiz
bot › 🧠 Ana, ¿2 + 2?
ana @ equipo › 4
ana @ equipo › @bot 4
bot › 🌍 Ana, ¿capital de Francia?
ana @ equipo › /rules
ana @ equipo › /rules @bot
bot › Todavía no hay normas.
```

Por eso este ejemplo deja el `groupMode: 'all'` por defecto y guarda silencio
con un catch-all que solo responde en privado.

## Ejecútalo en WhatsApp o Telegram

Pon tu id en `ADMINS` (envía `/id` al bot en privado para verlo), arranca el bot con
`node bot.js`, escanea el QR desde **WhatsApp → Dispositivos vinculados** y
añade el número del bot a un grupo. En Telegram, instala `@botmesh/telegram`,
cambia el provider como en [O conectar Telegram](/es/guide/inicio#o-conectar-telegram)
y añade el bot a un grupo. Con el modo de privacidad por defecto de BotFather,
un bot de Telegram solo recibe en grupos los comandos, las menciones y las
respuestas a sus propios mensajes; desactívalo (`/setprivacy`) para que le
lleguen las respuestas del quiz.

## Siguientes pasos

- [Conceptos básicos](/es/guide/conceptos#las-conversaciones-de-grupo-son-por-participante): `conversationScope: 'chat'` para una sola conversación compartida por grupo
- [Handoff humano](./handoff-humano): pausar el bot en un chat
- [WhatsApp y Telegram a la vez](./whatsapp-y-telegram): cómo son los ids de grupo en cada canal
