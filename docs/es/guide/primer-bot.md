# Tu primer bot

Esta página amplía el bot de [Inicio rápido](./inicio) hasta uno que maneja
comandos, media, una encuesta y un flujo de varios pasos con validación.
Funciona sin cambios en el simulador de la terminal y en WhatsApp.

## El bot completo

```js
// bot.js
import { Bot, defineBot, flow, isMainModule, slashCommandsPlugin } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

const createBot = defineBot((provider) => {
  // 1. El bot: motor agnóstico de transporte + el provider que recibes
  const bot = new Bot({ provider, lang: 'es' })

  // 2. Comandos slash integrados
  bot.plug(slashCommandsPlugin, {
    greeting: '🤖 ¡Hola! Prueba: hola, foto, encuesta, registro. Comandos: /help /reset /cancel /id /ping',
  })

  // 3. Respuestas simples
  bot.when(['hola', 'buenas'], (ctx) => ctx.reply(`👋 ¡Hola ${ctx.pushName ?? 'de nuevo'}! Envía "registro" para probar un flujo.`))

  // 4. Media y encuestas
  bot.when('foto', (ctx) => ctx.photo('https://picsum.photos/400/300', '📸 Aquí tienes una foto'))
  bot.when('encuesta', (ctx) => ctx.poll('¿Color favorito?', ['Rojo', 'Verde', 'Azul']))

  // 5. Un flujo de varios pasos con validación y un menú
  bot.use(
    flow('registro')
      .say('📝 *Vamos a registrarte*')
      .ask('¿Cómo te llamas?', 'name')
      .ask('¿Cuál es tu email?', 'email', {
        validate: (body) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body) ? true : '❌ Eso no es un email, inténtalo de nuevo'),
      })
      .choose('¿Quieres recibir nuestro boletín?', { si: 'Sí, por favor', no: 'No, gracias' }, 'newsletter')
      .say((_ctx, c) =>
        `✅ ¡Listo!\n👤 ${c.state.name}\n📧 ${c.state.email}\n📰 Boletín: ${c.state.newsletter}`,
      )
      .timeout('5m'),
  )

  // 6. Catch-all: solo se ejecuta si nada más manejó el mensaje
  bot.onMessage((ctx) => ctx.reply('🤔 No te entendí. Envía /help para ver los comandos.'))

  return bot
})

export default createBot

// 7. Arranque: `node bot.js` conecta con WhatsApp; `npx botmesh dev bot.js` se salta este bloque
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'my-bot' }))
  bot.on('qr', () => console.log('📱 Escanea el QR en WhatsApp → Dispositivos vinculados'))
  bot.on('ready', () => console.log('✅ Bot listo'))
  await bot.start()
}
```

## Pruébalo

```bash
npx botmesh dev bot.js     # en la terminal, sin teléfono
node bot.js                # en WhatsApp: escanea el QR y escribe desde otro teléfono
```

```text
user › registro
bot › 📝 *Vamos a registrarte*
bot › ¿Cómo te llamas?
user › Ana
bot › ¿Cuál es tu email?
user › nope
bot › ❌ Eso no es un email, inténtalo de nuevo
user › ana@example.com
bot › ¿Quieres recibir nuestro boletín?

      1) Sí, por favor
      2) No, gracias
user › 1
bot › ✅ ¡Listo!
      👤 Ana
      📧 ana@example.com
      📰 Boletín: si
```

Envía `/reset` en mitad del flujo para salir: los comandos siempre ganan a una
conversación activa.

## Qué hace cada parte

### 1. El bot y su provider

`new Bot({ provider })` conecta el motor agnóstico de transporte con un
transporte. Las opciones del transporte van en el provider:
`session: 'my-bot'` guarda la sesión de WhatsApp en `./sessions/my-bot/`, así
que los siguientes arranques reconectan sin QR. `defineBot` e `isMainModule`
permiten que el simulador inyecte su propio provider en lugar de
`BaileysProvider` (ver [Simulador en la terminal](./simulador)).

`lang: 'es'` pone en español los textos que el framework escribe por ti
(respuestas de los comandos slash, "responde con texto", timeouts). Sin esa
opción salen en inglés. [Internacionalización](./i18n) explica cómo atender
varios idiomas.

### 2. Comandos slash

`slashCommandsPlugin` instala `/start`, `/help`, `/reset`, `/cancel`, `/id` y
`/ping`. `greeting` sustituye el texto de `/start` y `/help`, así que lista tus
comandos en él; sin `greeting` ambos responden con la lista de comandos
integrada. Los comandos ganan a una conversación activa, así que `/reset` o
`/cancel` siempre sacan de un flujo.

### 3. Respuestas simples

`bot.when(trigger, handler)` compara el mensaje **completo**, normalizado
(minúsculas, sin tildes, espacios colapsados): `'hola'` coincide con "hola" y
"Hóla ", no con "hola amigo". Una lista coincide con cualquiera de sus
entradas. Usa `{ pattern: 'hola', match: 'contains' }` para buscar una
subcadena, o una regex. `ctx.pushName` es el nombre visible del remitente
cuando el transporte lo informa. Todas las formas de trigger están en
[Triggers especiales](./triggers).

### 4. Media y encuestas

Todos los métodos de envío de `ctx` aceptan una URL, una ruta local o un
`Buffer`:

```js
await ctx.photo('https://example.com/gato.jpg', 'pie de foto')
await ctx.video('./clip.mp4')
await ctx.file('./factura.pdf')
await ctx.voice('./nota.mp3')                       // nota de voz (Baileys la convierte con ffmpeg)
await ctx.sticker('./logo.png', { pack: 'Mi bot', author: 'yo' })   // Baileys necesita `sharp`
await ctx.location(4.711, -74.0721, 'Bogotá')
await ctx.contact('+573001234567', 'Soporte')
await ctx.poll('¿Color favorito?', ['Rojo', 'Verde', 'Azul'])
await ctx.react('👍')
```

Lo que cada transporte admite de forma nativa, y cómo se degrada el resto,
está en [Mensajes y media](./mensajes) y [Canales](./canales).

### 5. Flujos

`flow('registro')` compila a una conversación real. `.ask(text, key)` envía
`text`, espera la respuesta y la guarda en `c.state[key]`; `validate` devuelve
`true` o el texto que se envía antes de volver a preguntar. `.choose()` envía
un menú numerado y guarda la **clave** elegida (el usuario puede responder con
el número o con la etiqueta). La forma función de `.say((ctx, c) => ...)` lee
todo lo capturado hasta ese momento, y `.timeout('5m')` termina una
conversación abandonada. El flujo empieza cuando un mensaje coincide con su
trigger (`registro`). Más en [Flujos conversacionales](./flujos).

### 6. Catch-all

`bot.onMessage()` se ejecuta solo cuando nada más (un comando, una
conversación activa, un handler `when` o el trigger de un flujo) consumió el
mensaje.

### 7. Arranque

`bot.on('qr')` se dispara cuando el provider necesita que te autentiques (un
QR en Baileys); `bot.on('ready')`, cuando el transporte ya está conectado.
Después de `await bot.start()` el bot puede enviar; antes, los envíos se
rechazan con `BotNotRunningError`.

## Siguientes pasos

- [Conceptos básicos](./conceptos): cómo se enruta un mensaje, `ctx`, ids y opciones
- [Flujos conversacionales](./flujos): ramas, reintentos, flujos persistentes
- [Testing](./testing): comprueba este flujo en un test unitario con `createTestBot`
- [Ejemplos](/es/ejemplos/): más recetas
