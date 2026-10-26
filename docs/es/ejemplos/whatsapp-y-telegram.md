# WhatsApp y Telegram a la vez

Ejecuta un bot en dos canales desde el mismo archivo: una factory, dos
providers, dos instancias de `Bot` en un proceso y una base de datos SQLite.

**Nivel:** Intermedio · **Etiquetas:** WhatsApp, Telegram, Multicanal, SQLite

**Funcionalidades:**
[la factory del bot (`defineBot`)](/es/guide/simulador#_1-el-patron-factory-definebot) ·
[canales](/es/guide/canales) ·
[ids de chat y remitente](/es/guide/conceptos#ids-de-chat-y-remitente) ·
[identidad por transporte](/es/guide/mensajes#identidad-por-transporte) ·
[espacio de nombres del almacenamiento](/es/guide/configuracion#identidad-y-espacio-de-nombres) ·
[store SQLite](/es/guide/store#sqlitestore) ·
[datos de usuario (`ctx.user`)](/es/guide/datos-usuario)

## Requisitos

- Node.js 22.12 o superior y una carpeta vacía con `"type": "module"` en su
  `package.json` ([Inicio rápido](/es/guide/inicio#_1-instalar)).
- Mientras botmesh esté en prerelease, añade a cada paquete `@botmesh/*` el
  dist-tag de la [nota de prerelease](/es/guide/inicio#requisitos).
- Un token de bot de Telegram de [@BotFather](https://t.me/BotFather) y un
  teléfono con WhatsApp para el número del bot.

```bash
npm install @botmesh/core @botmesh/baileys @botmesh/telegram @botmesh/sqlite-store better-sqlite3
```

## El bot completo

```js
// bot.js
import { Bot, defineBot, flow, isMainModule, slashCommandsPlugin, userOf } from '@botmesh/core'
import { SQLiteStore } from '@botmesh/sqlite-store'
import { BaileysProvider } from '@botmesh/baileys'
import { TelegramProvider } from '@botmesh/telegram'

// 1. Una sola factory, llamada una vez por canal: cada llamada construye su propio Bot
const createBot = defineBot((provider) => {
  const bot = new Bot({
    provider,
    lang: 'es',
    // 2. Un solo archivo de base de datos para todos los canales. Cada bot tiene su propia
    //    instancia del store y separa sus filas: el namespace incluye el id del provider
    store: new SQLiteStore({ file: './bot.db' }),
  })

  bot.plug(slashCommandsPlugin, { greeting: '👋 Envía "quien soy", "registro" o /id.' })

  // 3. Los ids son strings opacos que elige cada canal: muéstralos y guárdalos, nunca los analices
  bot.when('quien soy', async (ctx) => {
    const { name, visits = 0 } = await ctx.user.all()
    await ctx.user.set('visits', visits + 1)
    await ctx.reply(`📡 ${provider.id} · chat ${ctx.from} · usuario ${ctx.sender}\n👤 ${name ?? 'sin nombre'} · visita ${visits + 1}`)
  })

  // 4. Flujos, comandos y datos de usuario funcionan igual en todos los canales
  bot.use(
    flow('registro')
      .ask('¿Cómo te llamas?', 'name')
      .do(async (ctx, c) => {
        await userOf(ctx).set('name', c.state.name)
      })
      .say((_ctx, c) => `✅ Guardado, ${c.state.name}.`),
  )

  bot.onMessage((ctx) => ctx.reply('Envía "quien soy", "registro" o /help.'))

  return bot
})

export default createBot

// 5. En producción: la misma factory, dos providers, dos bots en un proceso
if (isMainModule(import.meta)) {
  const whatsapp = await createBot(new BaileysProvider({ session: 'bot-multi' }))
  const telegram = await createBot(new TelegramProvider({ token: process.env.TELEGRAM_TOKEN ?? '' }))
  whatsapp.on('ready', () => console.log('✅ WhatsApp conectado'))
  telegram.on('ready', () => console.log('✅ Telegram conectado'))
  await Promise.all([whatsapp.start(), telegram.start()])

  process.once('SIGINT', async () => {
    await Promise.all([whatsapp.stop(), telegram.stop()])
    process.exit(0)
  })
}
```

## Cómo funciona

1. **Una factory, varios bots.** `defineBot` devuelve una función que construye
   un bot alrededor del provider que recibe. El bloque de arranque la llama
   dos veces, una por canal, así que los dos bots tienen los mismos handlers,
   flujos y comandos. El simulador la llama una vez con su propio provider.
2. **Un solo archivo de base de datos.** Cada bot tiene su propia instancia de
   `SQLiteStore` sobre el mismo `bot.db`. No pases una misma instancia de store
   a dos bots: `bot.stop()` cierra su store y el otro bot se quedaría sin él.
   Todo lo que escribe un bot va en el espacio de nombres de su id de bot, que
   por defecto es el id del provider (`baileys`, `telegram`), así que los dos
   bots nunca leen las filas del otro. Define `session`, `botId` o `tenantId`
   en el `Bot` cuando ejecutes varios bots del mismo canal
   ([espacio de nombres](/es/guide/configuracion#identidad-y-espacio-de-nombres)).
3. **Los ids son opacos.** Cada canal elige su formato de id. Guárdalos y
   compáralos tal como llegan; nunca extraigas de ellos un número de teléfono.
4. **Los ids son estables.** El provider resuelve los alias antes de que tu
   código vea el mensaje: en WhatsApp la misma persona llega con el mismo
   `ctx.sender` aunque WhatsApp alterne entre su número de teléfono y su LID.
   Así `ctx.user`, las conversaciones y las listas de acceso siguen funcionando.
5. **Perfiles separados.** La misma persona en WhatsApp y en Telegram son dos
   usuarios con dos perfiles. Para unirlos, guarda tu propia relación (por
   ejemplo, un código que el usuario envía desde los dos canales).
6. **Parar.** Con `Ctrl+C` se paran los dos bots, lo que cierra sus conexiones
   y sus manejadores de la base de datos.

Lo que imprime `quien soy` para la misma persona en cada canal:

| Canal | Chat | `ctx.from` | `ctx.sender` |
| --- | --- | --- | --- |
| WhatsApp (`baileys`) | privado | `573001234567@s.whatsapp.net` | `573001234567@s.whatsapp.net` |
| WhatsApp (`baileys`) | grupo | `120363025555555555@g.us` | `573001234567@s.whatsapp.net` |
| Telegram (`telegram`) | privado | `123456789` | `123456789` |
| Telegram (`telegram`) | grupo | `-1001234567890` | `123456789` |

En un chat privado el chat es el usuario; en un grupo el chat es el grupo y
el remitente es el miembro que escribió.

## Pruébalo

El simulador ejecuta un solo bot con su provider en memoria (`mock`). La base
de datos es el mismo `bot.db`, así que `:reset` (un bot nuevo desde la
factory) sigue encontrando el perfil:

```bash
npx botmesh dev bot.js --user ana
```

```text
ana › quien soy
bot › 📡 mock · chat ana · usuario ana
      👤 sin nombre · visita 1
ana › registro
bot › ¿Cómo te llamas?
ana › Ana
bot › ✅ Guardado, Ana.
ana › quien soy
bot › 📡 mock · chat ana · usuario ana
      👤 Ana · visita 2
ana › :reset
• ↺ fresh bot — conversations and in-memory state cleared
ana › quien soy
bot › 📡 mock · chat ana · usuario ana
      👤 Ana · visita 3
```

## Ejecútalo en los dos canales

Pon el token en `.env` (`TELEGRAM_TOKEN=123456:ABC-tu-token`) y arranca:

```bash
node --env-file=.env bot.js
```

Escanea el QR desde **WhatsApp → Dispositivos vinculados** y escribe a tu bot
de Telegram. Envía `registro` en un canal y `quien soy` en el otro: el nombre
solo está en el primero.

## Siguientes pasos

- [Canales](/es/guide/canales): qué admite cada transporte, y la Cloud API (`@botmesh/meta`) como tercer provider
- [Varias réplicas](/es/guide/replicas): varios procesos para el mismo bot
- [Bot de grupo](./bot-de-grupo): para qué sirven los ids de grupo de arriba
