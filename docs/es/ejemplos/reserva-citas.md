# Reserva de citas

Construye un bot de reservas que pide nombre, día y hora, valida cada
respuesta, confirma antes de guardar y retoma la reserva donde se quedó tras
un reinicio.

**Nivel:** Intermedio · **Etiquetas:** WhatsApp, Formularios, Persistencia, SQLite

**Funcionalidades:**
[flujos persistentes](/es/guide/store#flujos-persistentes) ·
[validación y `maxAttempts`](/es/guide/flujos#ask) ·
[formularios](/es/guide/formularios) ·
[menús con `choose`](/es/guide/flujos#metodos-del-dsl) ·
[store SQLite](/es/guide/store#sqlitestore) ·
[datos de usuario (`ctx.user`)](/es/guide/datos-usuario) ·
[comandos slash](/es/guide/plugins#incluido-slashcommands)

## Requisitos

- Node.js 22.12 o superior y una carpeta vacía con `"type": "module"` en su
  `package.json` ([Inicio rápido](/es/guide/inicio#_1-instalar)).
- Mientras botmesh esté en prerelease, añade a cada paquete `@botmesh/*` el
  dist-tag de la [nota de prerelease](/es/guide/inicio#requisitos).

```bash
npm install @botmesh/core @botmesh/baileys @botmesh/sqlite-store better-sqlite3
```

`better-sqlite3` es un módulo nativo: con pnpm, aprueba su script de build
([Instalar better-sqlite3](/es/guide/store#instalar-better-sqlite3)).

## El bot completo

```js
// bot.js
import { Bot, defineBot, flow, isMainModule, slashCommandsPlugin, userOf } from '@botmesh/core'
import { SQLiteStore } from '@botmesh/sqlite-store'
import { BaileysProvider } from '@botmesh/baileys'

const today = () => new Date().toISOString().slice(0, 10)

const createBot = defineBot((provider) => {
  // 1. Un archivo SQLite guarda los flujos a medias y los datos de usuario entre reinicios
  const bot = new Bot({ provider, lang: 'es', store: new SQLiteStore({ file: './citas.db' }) })

  bot.plug(slashCommandsPlugin, {
    greeting: '💈 ¡Hola! Envía "reservar" para pedir cita o "mi cita" para verla. /cancel detiene una reserva.',
  })

  // 2. El flujo de reserva: persistente, validado y con confirmación
  bot.use(
    flow('reservar')
      .persistent()
      .timeout('10m')
      .ask('📅 Vamos a reservar tu cita. ¿A nombre de quién?', 'name', {
        validate: (body) => (body.trim().length >= 2 ? true : '✋ Escribe al menos 2 letras.'),
        maxAttempts: 3,
      })
      // 3. Un formulario: campos tipados, validados uno a uno (un WhatsApp Flow nativo en la Cloud API)
      .form(
        {
          id: 'slot',
          fields: [
            { type: 'date', name: 'day', label: 'Día', prompt: '¿Qué día? (p. ej. 14/03/2030)', min: today(), error: '❌ Elige un día a partir de hoy.' },
            { type: 'select', name: 'time', label: 'Hora', prompt: '¿A qué hora?', options: ['09:00', '11:30', '16:00'] },
          ],
        },
        { flatten: true, maxAttempts: 3 },
      )
      // 4. Confirmación antes de guardar nada
      .say((_ctx, c) => `📝 ${c.state.name}, el ${c.state.day} a las ${c.state.time}.`)
      .choose('¿La reservo?', { yes: 'Sí, resérvala', no: 'No, cancela' }, 'confirm')
      .do(async (ctx, c) => {
        if (c.state.confirm === 'no') return c.end('👌 Cancelado, no se reservó nada.')
        // 5. Guarda la cita en el perfil del usuario (en el mismo archivo SQLite)
        await userOf(ctx).set('appointment', { name: c.state.name, day: c.state.day, time: c.state.time })
      })
      .say('✅ ¡Reservada! Envía "mi cita" para verla.'),
  )

  bot.when('mi cita', async (ctx) => {
    const appointment = await ctx.user.get('appointment')
    await ctx.reply(
      appointment
        ? `📅 ${appointment.name}: el ${appointment.day} a las ${appointment.time}`
        : 'Todavía no tienes cita. Envía "reservar".',
    )
  })

  bot.onMessage((ctx) => ctx.reply('Envía "reservar", "mi cita" o /help.'))

  return bot
})

export default createBot

// `node bot.js` se conecta a WhatsApp; `npx botmesh dev bot.js` se salta este bloque
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'bot-citas' }))
  bot.on('ready', () => console.log('✅ Conectado'))
  await bot.start()
}
```

## Cómo funciona

1. **El store.** `SQLiteStore` guarda chats, checkpoints de flujos y datos de
   usuario en `citas.db`. Sin él, el bot usa un store en memoria y lo olvida
   todo al reiniciar.
2. **Un flujo persistente.** `.persistent()` guarda un checkpoint al empezar
   el flujo y después de cada paso. Tras un reinicio, el siguiente mensaje del
   usuario despierta el flujo y se repite la pregunta pendiente: ese mensaje no
   cuenta como respuesta. `.timeout('10m')` cierra una reserva que nadie termina.
3. **Validación.** `validate` devuelve `true` o el texto que se envía antes de
   volver a preguntar. `maxAttempts: 3` cuenta todas las respuestas, también la
   primera; tras la tercera respuesta inválida la conversación termina con el
   mensaje integrado de "demasiados intentos".
4. **Un formulario.** `.form()` recoge campos tipados: `date` acepta
   `AAAA-MM-DD` y `DD/MM/AAAA` y comprueba `min`, y `select` muestra un menú
   numerado y guarda la opción elegida. `flatten: true` copia cada respuesta
   a `c.state.day` y `c.state.time`. En la Cloud API de WhatsApp el mismo
   formulario puede salir como un único WhatsApp Flow nativo; en el resto de
   canales se pregunta campo a campo. Un reinicio a mitad del formulario lo
   vuelve a preguntar desde el primer campo, porque el formulario es un solo paso.
5. **Confirmación.** `.choose()` guarda la clave elegida (`yes` o `no`). En el
   paso `.do()`, `c.end(texto)` detiene el flujo con un último mensaje, así que
   no se guarda nada si el usuario dice que no.
6. **Guardar la cita.** En los pasos de un flujo `ctx` es un mensaje de runtime
   sin helpers, así que `userOf(ctx)` da el mismo perfil que los handlers
   leen como `ctx.user`. `mi cita` lo lee, también después de un reinicio.

`min: today()` se calcula al arrancar el bot. Si el bot corre durante días,
vuelve a comprobar la fecha en un paso `.do()` o reinícialo cada día.

## Pruébalo

```bash
npx botmesh dev bot.js
```

`:reset` en el simulador construye un bot nuevo desde la factory, que es lo
que hace un reinicio: el nuevo `SQLiteStore` abre el mismo archivo y el flujo
se retoma.

```text
user › mi cita
bot › Todavía no tienes cita. Envía "reservar".
user › reservar
bot › 📅 Vamos a reservar tu cita. ¿A nombre de quién?
user › A
bot › ✋ Escribe al menos 2 letras.
user › Ana Gómez
bot › ¿Qué día? (p. ej. 14/03/2030)
user › :reset
• ↺ fresh bot — conversations and in-memory state cleared
user › ¿hola?
bot › ¿Qué día? (p. ej. 14/03/2030)
user › 2020-01-01
bot › ❌ Elige un día a partir de hoy.
user › 14/03/2030
bot › ¿A qué hora?

      1) 09:00
      2) 11:30
      3) 16:00
user › 7
bot › ❌ Elige una opción de la lista (número u opción).
user › 2
bot › 📝 Ana Gómez, el 2030-03-14 a las 11:30.
bot › ¿La reservo?

      1) Sí, resérvala
      2) No, cancela
user › 1
bot › ✅ ¡Reservada! Envía "mi cita" para verla.
user › mi cita
bot › 📅 Ana Gómez: el 2030-03-14 a las 11:30
```

## Ejecútalo en WhatsApp o Telegram

`node bot.js` muestra un código QR: escanéalo desde **WhatsApp → Dispositivos
vinculados**. Para Telegram, instala `@botmesh/telegram` y cambia el provider
del bloque de arranque por
`new TelegramProvider({ token: process.env.TELEGRAM_TOKEN ?? '' })`, como en
[O conectar Telegram](/es/guide/inicio#o-conectar-telegram).

## Siguientes pasos

- [Formularios (WhatsApp Flows)](/es/guide/formularios): todos los tipos de campo y el formulario nativo en la Cloud API
- [Store persistente](/es/guide/store): Redis, Postgres y qué guarda cada tabla
- [Handoff humano](./handoff-humano): que una persona atienda un chat
