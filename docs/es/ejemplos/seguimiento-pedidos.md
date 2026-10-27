# Seguimiento de pedidos

Construye un bot que consulta pedidos, recuerda cuáles sigue cada usuario y
le ofrece el último la próxima vez, incluso después de un reinicio.

**Nivel:** Intermedio · **Etiquetas:** WhatsApp, Datos de usuario, Conversaciones

**Funcionalidades:**
[datos de usuario (`ctx.user`)](/es/guide/datos-usuario) ·
[namespaces](/es/guide/datos-usuario#api) ·
[conversaciones async](/es/guide/flujos#mas-alla-del-dsl) ·
[validación y `maxAttempts`](/es/guide/flujos#ask) ·
[`MemoryStore` con archivo](/es/guide/store#memorystore) ·
[comandos slash](/es/guide/plugins#incluido-slashcommands)

## Requisitos

- Node.js 22.12 o superior y una carpeta vacía con `"type": "module"` en su
  `package.json` ([Inicio rápido](/es/guide/inicio#_1-instalar)).

```bash
npm install @botmesh/core @botmesh/baileys
```

## El bot completo

```js
// bot.js
import { Bot, defineBot, isMainModule, MemoryStore, slashCommandsPlugin } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

// Sustituye a la API de pedidos de tu tienda
const ORDERS = {
  A100: { item: 'Zapatillas azules', status: '🚚 En camino', eta: 'el jueves' },
  B200: { item: 'Chaqueta impermeable', status: '📦 Preparando el envío', eta: 'la semana que viene' },
  C300: { item: 'Calcetines de lana', status: '✅ Entregado', eta: 'ya lo tienes' },
}
const findOrder = (code) => ORDERS[code.trim().toUpperCase()]

const createBot = defineBot((provider) => {
  // Un store guardado en un archivo: los perfiles sobreviven a un reinicio (en producción, SQLite o Redis)
  const bot = new Bot({ provider, lang: 'es', store: new MemoryStore({ file: './pedidos.json' }) })

  bot.plug(slashCommandsPlugin, {
    greeting: '📦 Envía "seguir" para seguir un pedido o "mis pedidos" para verlos. /forget borra tus datos.',
  })

  // 1. Una conversación que lee y escribe el perfil del usuario (ctx.user)
  bot.conversation(
    'seguir',
    async (c, ctx) => {
      const orders = ctx.user.ns('orders') // un namespace solo para esta función
      const last = await orders.get('last')

      // 2. Memoria por usuario: ofrece el último pedido en vez de preguntar otra vez
      let code
      if (last && (await c.choose(`¿Sigo el pedido ${last}?`, { yes: `Sí, ${last}`, other: 'Otro pedido' })) === 'yes') {
        code = last
      } else {
        const answer = await c.ask('¿Cuál es tu número de pedido? (p. ej. A100)', {
          validate: (body) => (findOrder(body) ? true : '🔎 No encuentro ese pedido. Revisa el número y prueba otra vez.'),
          maxAttempts: 3,
        })
        code = answer.trim().toUpperCase()
      }

      // 3. Recuérdalo: el último pedido y todos los que sigue este usuario
      const followed = (await orders.get('followed')) ?? []
      await orders.update({ last: code, followed: followed.includes(code) ? followed : [...followed, code] })

      const order = findOrder(code)
      await c.say(`${order.status}\n${code} · ${order.item}\nLlega: ${order.eta}`)
    },
    { trigger: ['seguir', 'dónde está mi pedido'] },
  )

  bot.when('mis pedidos', async (ctx) => {
    const followed = (await ctx.user.ns('orders').get('followed')) ?? []
    if (followed.length === 0) return ctx.reply('Todavía no sigues ningún pedido. Envía "seguir".')
    await ctx.reply(followed.map((code) => `• ${code}: ${findOrder(code).status}`).join('\n'))
  })

  // 4. El usuario puede borrar lo que el bot recuerda de él
  bot.command('forget', async (ctx) => {
    await ctx.user.ns('orders').clear()
    await ctx.reply('🧹 Hecho, olvidé tus pedidos.')
  })

  bot.onMessage((ctx) => ctx.reply('Envía "seguir", "mis pedidos" o /help.'))

  return bot
})

export default createBot

// `node bot.js` se conecta a WhatsApp; `npx botmesh dev bot.js` se salta este bloque
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'bot-pedidos' }))
  bot.on('ready', () => console.log('✅ Conectado'))
  await bot.start()
  // Ctrl+C: para el bot para que el store escriba pedidos.json antes de salir
  process.once('SIGINT', async () => {
    await bot.stop()
    process.exit(0)
  })
}
```

## Cómo funciona

1. **Una conversación como función.** `bot.conversation(nombre, fn, { trigger })`
   es la forma async de un flujo: `if`s y variables normales deciden qué
   preguntar. Su `ctx` es el contexto completo del mensaje, así que `ctx.user`
   funciona directamente.
2. **Memoria por usuario.** `ctx.user` es un perfil por remitente, el mismo en
   su chat privado y en todos los grupos. `ns('orders')` separa las claves de
   esta función del resto del perfil, y `/forget` borra solo esas.
3. **Estado de la conversación.** `code` y `last` solo viven mientras dura la
   conversación; lo que debe sobrevivirla va a `ctx.user`.
   `orders.update({ last, followed })` escribe las dos claves en una llamada.
4. **Validación.** `validate` rechaza números de pedido desconocidos con una
   pista, y `maxAttempts: 3` termina la conversación tras tres respuestas inválidas.
5. **Sobrevivir a reinicios.** `MemoryStore({ file })` guarda perfiles y
   checkpoints en `pedidos.json` cada minuto y al parar el bot, y los carga al
   arrancar. Nada para el bot por sí solo con Ctrl+C, así que el bloque de
   arranque llama a `bot.stop()` con `SIGINT`: sin él, se pierden los cambios
   del último minuto. Usa [SQLite o Redis](/es/guide/store) cuando varios procesos
   comparten los datos.

Fuera de un handler (un webhook de tu tienda, una tarea programada) el mismo
perfil es `bot.user(userId)`; por ejemplo,
`await bot.user(userId).ns('orders').get('followed')` para saber a quién avisar
cuando sale un pedido.

## Pruébalo

```bash
npx botmesh dev bot.js --user ana
```

`:as bob` cambia a otro usuario (en su propio chat privado) y `:reset`
reinicia el bot desde la factory:

```text
ana › mis pedidos
bot › Todavía no sigues ningún pedido. Envía "seguir".
ana › seguir
bot › ¿Cuál es tu número de pedido? (p. ej. A100)
ana › Z999
bot › 🔎 No encuentro ese pedido. Revisa el número y prueba otra vez.
ana › a100
bot › 🚚 En camino
      A100 · Zapatillas azules
      Llega: el jueves
ana › seguir
bot › ¿Sigo el pedido A100?

      1) Sí, A100
      2) Otro pedido
ana › 2
bot › ¿Cuál es tu número de pedido? (p. ej. A100)
ana › b200
bot › 📦 Preparando el envío
      B200 · Chaqueta impermeable
      Llega: la semana que viene
ana › :reset
• ↺ fresh bot — conversations and in-memory state cleared
ana › seguir
bot › ¿Sigo el pedido B200?

      1) Sí, B200
      2) Otro pedido
ana › 1
bot › 📦 Preparando el envío
      B200 · Chaqueta impermeable
      Llega: la semana que viene
ana › mis pedidos
bot › • A100: 🚚 En camino
      • B200: 📦 Preparando el envío
ana › :as bob
• you are now "bob" (bob)
bob › mis pedidos
bot › Todavía no sigues ningún pedido. Envía "seguir".
bob › :as ana
• you are now "ana" (ana)
ana › /forget
bot › 🧹 Hecho, olvidé tus pedidos.
ana › mis pedidos
bot › Todavía no sigues ningún pedido. Envía "seguir".
```

## Ejecútalo en WhatsApp o Telegram

`node bot.js` muestra un código QR: escanéalo desde **WhatsApp → Dispositivos
vinculados**. Para Telegram, instala `@botmesh/telegram` y cambia el provider
del bloque de arranque por
`new TelegramProvider({ token: process.env.TELEGRAM_TOKEN ?? '' })`, como en
[O conectar Telegram](/es/guide/inicio#o-conectar-telegram).

## Siguientes pasos

- [Datos persistentes por usuario](/es/guide/datos-usuario): paths, TTL y privacidad (exportación y borrado)
- [Bot multi-idioma](./multi-idioma): el idioma del usuario también se guarda en `ctx.user`
- [Reserva de citas](./reserva-citas): un flujo persistente sobre SQLite
