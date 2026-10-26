# Respuestas con media

Construye un bot que responde con fotos, documentos, videos, notas de voz,
stickers, ubicaciones y contactos, y que reacciona a las imágenes que le
envían.

**Nivel:** Principiante · **Etiquetas:** WhatsApp, Telegram, Media

**Funciones que muestra:** [enviar foto, video, archivo, voz, sticker](/es/guide/mensajes#enviar-foto) ·
[enviar ubicación](/es/guide/mensajes#enviar-ubicacion) ·
[enviar contacto](/es/guide/mensajes#enviar-contacto) ·
[recibir media (`bot.onType`)](/es/guide/mensajes#recibir-media) ·
[`loadMediaOf()`](/es/guide/mensajes#acceder-al-contenido-del-media) ·
[recibir una ubicación](/es/guide/mensajes#recibir-una-ubicacion)

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
import { Bot, defineBot, isMainModule, loadMediaOf, MediaTooLargeError } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

const createBot = defineBot((provider) => {
  const bot = new Bot({ provider, lang: 'es' })

  // Cada fuente puede ser una URL, una ruta local o un Buffer.
  // Las URLs de example.com son de relleno: apúntalas a tus propios archivos.
  bot.when('foto', (ctx) => ctx.photo('https://picsum.photos/400/300', '📸 Una foto al azar'))
  bot.when('carta', (ctx) => ctx.file('https://example.com/carta.pdf', 'carta.pdf', '📄 Nuestra carta'))
  bot.when('video', (ctx) => ctx.video('https://example.com/clip.mp4', '🎬 Un clip corto'))
  bot.when('voz', (ctx) => ctx.voice('https://example.com/nota.ogg'))
  bot.when('sticker', (ctx) => ctx.sticker('https://picsum.photos/512/512.webp', { pack: 'Mi bot', author: 'yo' }))
  bot.when('donde', (ctx) => ctx.location(4.711, -74.0721, 'Bogotá, Colombia'))
  bot.when('contacto', (ctx) => ctx.contact('+573001234567', 'Soporte'))

  // Media entrante: descarga los bytes solo cuando los necesitas
  bot.onType('image', async (ctx) => {
    let media
    try {
      media = await loadMediaOf(ctx, { maxBytes: 5 * 1024 * 1024 })
    } catch (err) {
      if (err instanceof MediaTooLargeError) return ctx.reply('Esa imagen es demasiado grande (máximo 5 MB).')
      throw err
    }
    if (!media) return ctx.reply('No pude descargar esa imagen.')
    await ctx.react('😍')
    await ctx.reply(`🖼️ Recibí tu imagen ${media.mimetype}${ctx.body ? `: "${ctx.body}"` : ''}`)
  })

  // Una ubicación compartida llega normalizada en ctx.sharedLocation
  bot.onType('location', (ctx) => {
    const loc = ctx.sharedLocation
    return ctx.reply(loc ? `📍 Estás en ${loc.latitude}, ${loc.longitude}` : 'No pude leer esa ubicación')
  })

  bot.onMessage((ctx) => ctx.reply('Prueba: foto, carta, video, voz, sticker, donde, contacto, o envía una imagen.'))

  return bot
})

export default createBot

// `node bot.js` conecta con WhatsApp; `npx botmesh dev bot.js` se salta este bloque
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'media-bot' }))
  bot.on('ready', () => console.log('✅ Conectado. Escribe "foto" desde otro teléfono.'))
  await bot.start()
}
```

## Transcripción de ejemplo

Capturada con `npx botmesh dev bot.js`. El simulador muestra la media como
`[tipo: fuente]` sin descargarla, así que ahí funcionan las URLs de relleno.
`:media image ./gato.jpg Mi gato` envía `gato.jpg` desde la carpeta donde
ejecutas el comando (usa cualquier imagen que tengas):

```text
user › foto
bot › [image: https://picsum.photos/400/300]
      📸 Una foto al azar
user › carta
bot › [document: carta.pdf · https://example.com/carta.pdf]
      📄 Nuestra carta
user › video
bot › [video: https://example.com/clip.mp4]
      🎬 Un clip corto
user › voz
bot › [voice note: https://example.com/nota.ogg]
user › sticker
bot › [sticker: https://picsum.photos/512/512.webp]
user › dónde
bot › [location: 4.711, -74.0721 · Bogotá, Colombia]
user › contacto
bot › [contact: Soporte · +573001234567]
user › :media image ./gato.jpg Mi gato
bot › [reaction: 😍]
bot › 🖼️ Recibí tu imagen image/jpeg: "Mi gato"
```

## Cómo funciona

- **Un método por tipo.** `ctx.photo`, `ctx.video`, `ctx.file`,
  `ctx.voice` y `ctx.sticker` aceptan una URL, una ruta local o un `Buffer`;
  `ctx.file(fuente, nombre, caption)` fija el nombre que ve el usuario.
  `ctx.location(lat, lng, nombre?)` recibe coordenadas y
  `ctx.contact(teléfono, nombreVisible?)` un número de teléfono.
- **Los detalles del transporte se quedan en el provider.** En WhatsApp una
  nota de voz se convierte con ffmpeg y un sticker necesita el paquete
  opcional `sharp`. Telegram los envía tal cual, así que allí la URL de un
  sticker debe apuntar a un archivo `.webp` (por eso `512.webp`). Lo que
  soporta cada canal está en la [matriz de capacidades](/es/guide/canales#matriz-de-capacidades).
- **La media entrante es perezosa.** El mensaje solo trae una referencia;
  `loadMediaOf(ctx, { maxBytes })` la descarga una vez y devuelve
  `{ buffer, mimetype }`, o `undefined` si la descarga falla. Un archivo que
  supera `maxBytes` lanza `MediaTooLargeError`, que el handler convierte en
  una respuesta. `ctx.body` es el caption.
- **Las ubicaciones** llegan como `type: 'location'` con
  `ctx.sharedLocation` (`latitude`, `longitude`, `name?`); `ctx.location()`
  es el método que **envía** una. El simulador no tiene un comando para
  compartir una ubicación; el test de la documentación la envía con
  `MockProvider.incomingLocation()`.
- **Fuera de un handler**,
  `bot.send(chatId, { kind: 'image', media: { url }, caption })` envía el
  mismo contenido, por ejemplo desde una [tarea programada](./recordatorios).

## Ejecutarlo en WhatsApp o Telegram

`node bot.js` muestra un QR: escanéalo en WhatsApp → Dispositivos
vinculados. Para Telegram, instala `@botmesh/telegram` y cambia el provider
como se muestra en [O conectar Telegram](/es/guide/inicio#o-conectar-telegram);
la factory no cambia.

## Siguientes pasos

- [Bot de encuestas](./bot-encuesta): encuestas y reacciones
- [Mensajes y media](/es/guide/mensajes): ediciones, indicador de escritura, todos los métodos de envío
- [Voz (STT/TTS)](/es/guide/voz): transcribe las notas de voz que envían los usuarios
