# Flujo de registro

Construye una conversación de alta que pide nombre, email y edad, valida
cada respuesta, guarda el resultado y lo muestra cuando se pide.

**Nivel:** Principiante · **Etiquetas:** WhatsApp, Telegram, Flujos, Formularios

**Funciones que muestra:** [DSL `flow()`](/es/guide/flujos#flujo-basico) ·
[`.ask()` con `validate`](/es/guide/flujos#ask) ·
[acciones `.do()`](/es/guide/flujos#metodos-del-dsl) ·
[`c.state`](/es/guide/flujos#estado-tipado) ·
[`.timeout()`](/es/guide/flujos#metodos-del-dsl) ·
[`/cancel` sale de un flujo](/es/guide/plugins#incluido-slashcommands)

## Requisitos previos

Node.js 22.12 o superior y una carpeta con `"type": "module"` (ver
[Inicio rápido](/es/guide/inicio#requisitos)). Después instala:

```bash
npm install @botmesh/core @botmesh/baileys
```

## El bot completo

```js
// bot.js
import { Bot, defineBot, flow, isMainModule, slashCommandsPlugin } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

const createBot = defineBot((provider) => {
  const bot = new Bot({ provider, lang: 'es' })
  const usuarios = new Map() // reemplázalo por tu base de datos

  // /cancel y /reset salen de cualquier flujo
  bot.plug(slashCommandsPlugin)

  bot.use(
    flow('registro')
      .say('📝 *Vamos a registrarte*')
      .ask('¿Cómo te llamas?', 'name', {
        validate: (body) => (body.trim().length >= 2 ? true : '❌ Al menos 2 letras, por favor.'),
      })
      .ask('¿Cuál es tu email?', 'email', {
        validate: (body) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body) ? true : '❌ Email no válido. Inténtalo de nuevo.'),
      })
      .ask('¿Cuántos años tienes?', 'age', {
        validate: (body) => (/^\d+$/.test(body) && Number(body) >= 18 ? true : '❌ Debes tener 18 años o más (solo números).'),
      })
      .do((ctx, c) => {
        usuarios.set(ctx.sender, { name: c.state.name, email: c.state.email, age: Number(c.state.age) })
      })
      .say((_ctx, c) => ['✅ *¡Registro completo!*', '', `👤 ${c.state.name}`, `📧 ${c.state.email}`, `🎂 ${c.state.age}`].join('\n'))
      .timeout('5m'),
  )

  bot.when('perfil', (ctx) => {
    const usuario = usuarios.get(ctx.sender)
    return ctx.reply(usuario ? `👤 ${usuario.name} · 📧 ${usuario.email} · 🎂 ${usuario.age}` : 'Aún no estás registrado. Envía "registro".')
  })

  bot.onMessage((ctx) => ctx.reply('Envía "registro" para darte de alta o "perfil" para ver tus datos.'))

  return bot
})

export default createBot

// `node bot.js` conecta con WhatsApp; `npx botmesh dev bot.js` se salta este bloque
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'register-bot' }))
  bot.on('ready', () => console.log('✅ Conectado. Escribe "registro" desde otro teléfono.'))
  await bot.start()
}
```

## Transcripción de ejemplo

Capturada con `npx botmesh dev bot.js`:

```text
user › perfil
bot › Aún no estás registrado. Envía "registro".
user › registro
bot › 📝 *Vamos a registrarte*
bot › ¿Cómo te llamas?
user › A
bot › ❌ Al menos 2 letras, por favor.
user › Ana
bot › ¿Cuál es tu email?
user › ana@
bot › ❌ Email no válido. Inténtalo de nuevo.
user › ana@example.com
bot › ¿Cuántos años tienes?
user › 16
bot › ❌ Debes tener 18 años o más (solo números).
user › 30
bot › ✅ *¡Registro completo!*

      👤 Ana
      📧 ana@example.com
      🎂 30
user › perfil
bot › 👤 Ana · 📧 ana@example.com · 🎂 30
user › registro
bot › 📝 *Vamos a registrarte*
bot › ¿Cómo te llamas?
user › /cancel
bot › ✅ Conversación cancelada.
```

## Cómo funciona

- **`.ask(texto, clave, { validate })`** envía la pregunta, espera la
  respuesta y la guarda en `c.state[clave]`. `validate` devuelve `true` para
  aceptar, o el texto que se envía antes de volver a esperar.
- **`.do((ctx, c) => ...)`** ejecuta código sin enviar nada: aquí guarda al
  usuario bajo `ctx.sender`, su id estable en cualquier canal.
- **`.say((ctx, c) => ...)`** arma el resumen con todo lo capturado.
- **`.timeout('5m')`** cierra un flujo que el usuario abandonó; lo que se
  envía entonces se configura en `conversation.timeoutMessage` del bot.
- **Los comandos ganan.** `/cancel` (de `slashCommandsPlugin`) sale del
  flujo incluso mientras espera una respuesta.

## Variantes

Valida con un schema: `schema` acepta cualquier objeto compatible con zod y
el valor **parseado** llega a `c.state` (abajo, un `number`):

```js
import { z } from 'zod'

flow('registro')
  .ask('¿Cómo te llamas?', 'name', { schema: z.string().trim().min(2, '❌ Al menos 2 letras') })
  .ask('¿Cuántos años tienes?', 'age', { schema: z.coerce.number().int().min(18, '❌ Debes tener 18 años o más') })
  .say((_ctx, c) => `✅ ${c.state.name}, ${c.state.age} años`)
```

Para conservar los datos entre reinicios, guárdalos con
[datos de usuario persistentes](/es/guide/datos-usuario) en vez de un
`Map`. Para varios campos en un formulario nativo de la WhatsApp Cloud API,
ver [Formularios](/es/guide/formularios).

## Ejecutarlo en WhatsApp o Telegram

`node bot.js` muestra un QR: escanéalo en WhatsApp → Dispositivos
vinculados. Para Telegram, instala `@botmesh/telegram` y cambia el provider
como se muestra en [O conectar Telegram](/es/guide/inicio#o-conectar-telegram);
la factory no cambia.

## Siguientes pasos

- [Flujo de compra](./flujo-compra): menús, sub-flujos y `goto`
- [Flujos conversacionales](/es/guide/flujos): todo el DSL de flujos
- [Testing](/es/guide/testing): comprueba este flujo con `createTestBot`
