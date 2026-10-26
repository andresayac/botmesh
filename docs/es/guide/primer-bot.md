# Tu primer bot

Vamos a crear un bot completo con comandos, media y un flujo conversacional.

## El bot completo

```ts
import { Bot, flow, slashCommandsPlugin } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

// 1. Crear el bot — las opciones de transporte viven en el provider
const bot = new Bot({
  provider: new BaileysProvider({
    session: 'demo-bot',
    sessionsDir: './sessions',
    qr: { terminal: true, small: true },
    markOnlineOnConnect: false,
    ignoreNewsletters: true,
    ignoreBroadcasts: true,
  }),
  lang: 'es',
})

// 2. Eventos de conexión
bot.on('ready', () => console.log('✅ ¡Bot listo!'))
bot.on('qr', () => console.log('📱 Escanea el QR con tu WhatsApp'))

// 3. Comandos slash integrados (/start, /help, /reset, /cancel, /id, /ping)
bot.plug(slashCommandsPlugin, {
  // Se muestra en /start y /help (sin él: la lista de comandos integrada)
  greeting: [
    '🤖 ¡Hola! Soy un bot.',
    'Comandos: /help /reset /cancel /id /ping',
    'O envía: hola, foto, sticker, registrar',
  ].join('\n'),
})

// 4. Respuestas simples
bot.when('hola', async (ctx) => {
  await ctx.reply('👋 ¡Hola! Envía "registrar" para probar el flujo de registro.')
})

bot.when('info', async (ctx) => {
  await ctx.reply('ℹ️ Soy un bot hecho con @botmesh/core v2')
})

// 5. Media
bot.when('foto', async (ctx) => {
  await ctx.photo('https://picsum.photos/400/300', '📸 Aquí tienes una foto')
})

bot.when('sticker', async (ctx) => {
  await ctx.sticker('https://picsum.photos/512/512', {
    pack: 'Mi Bot',
    author: 'yo',
  })
})

// 6. Flujo de registro
const register = flow('registrar')
  .say('📝 *Vamos a registrarte*')
  .ask('¿Cuál es tu nombre?', 'name')
  .ask('¿Cuál es tu email?', 'email', {
    validate: (body) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body) ? true : '❌ Email inválido, intenta de nuevo',
  })
  .say((_ctx, c) => `✅ ¡Registro completo!\n👤 ${c.state.name}\n📧 ${c.state.email}`)

bot.use(register)

// 7. Catch-all
bot.onMessage(async (ctx) => {
  await ctx.reply('🤔 No te entendí. Envía /help para ver los comandos.')
})

// 8. Iniciar
await bot.start()
```

## Qué hace cada parte

### 1. Crear el bot

`new Bot({ provider })` conecta el motor agnóstico de transporte a un
transporte concreto. `session` es una opción **del provider**: el login de
WhatsApp se guarda en `./sessions/demo-bot/`. Si cierras y vuelves a abrir,
**no necesitas escanear el QR de nuevo**.

`lang: 'es'` pone en español los textos que el framework escribe por ti
(respuestas de los comandos slash, "escribe tu respuesta como texto", los
timeouts...). Sin esta opción salen en inglés. Consulta
[Internacionalización](./i18n) para atender varios idiomas.

### 2. Eventos de conexión

Eventos que se disparan cuando el bot se conecta o muestra el QR.

### 3. Comandos slash

Instala `/start`, `/help`, `/reset`, `/cancel`, `/id`, `/ping` — 6 comandos
gratis. `greeting` sustituye el texto de `/start` y `/help`, así que lista los
comandos en él (sin `greeting` responden con una lista de comandos integrada).
Los textos que escribe el framework (respuestas de los comandos, timeouts,
validaciones) salen en español gracias a `lang: 'es'` (sin esa opción, en
inglés); para otro idioma mira
[Internacionalización](./i18n). Los comandos siempre ganan sobre una conversación activa, así que
`/reset` (o `/cancel`) siempre puede escapar de un flujo atascado.

### 4. Respuestas simples

`bot.when(trigger, handler)` compara por **igualdad normalizada por
defecto** (minúsculas, sin acentos, espacios colapsados) — `'hola'`
coincide solo con un "hola"/"Hóla " exacto, no con "hola amigo". Usa
`{ pattern: 'hola', match: 'contains' }` si quieres coincidencia por
subcadena.

### 5. Media

```ts
await ctx.photo(url, 'caption')
await ctx.sticker(url, { pack, author })
await ctx.voice(url)
await ctx.location(lat, lng, name)
await ctx.contact(phone, name)
await ctx.poll(question, options)
```

### 6. Flujos

Conversaciones multi-paso. `flow('registrar')` compila a una conversación
real: `.ask(text, key)` envía `text`, espera la respuesta, y la guarda en
`c.state[key]`. La forma función de `.say((ctx, c) => ...)` puede leer todo
lo capturado hasta ahora vía `c.state`.

### 7. Catch-all

`bot.onMessage()` se ejecuta solo cuando nada más (un comando, una
conversación activa, o un matcher `when`/flow) ya consumió el mensaje.

## Ejecutar

```bash
node bot.js
```

Escanea el QR y prueba enviando: `hola`, `foto`, `sticker`, `registrar`.

## Siguientes pasos

- [Conceptos básicos](./conceptos) — entiende cómo funciona internamente
- [Flujos conversacionales](./flujos) — conversaciones complejas
- [Ejemplos](/es/ejemplos/mensajes) — más recetas
