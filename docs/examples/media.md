# Media Replies

Build a bot that answers with photos, documents, videos, voice notes,
stickers, locations and contacts, and reacts to the images users send.

**Level:** Beginner · **Tags:** WhatsApp, Telegram, Media

**Features shown:** [send photo, video, file, voice, sticker](/guide/messages#send-photo) ·
[send location](/guide/messages#send-location) ·
[send contact](/guide/messages#send-contact) ·
[receive media (`bot.onType`)](/guide/messages#receive-media) ·
[`loadMediaOf()`](/guide/messages#access-media-content) ·
[receive a location](/guide/messages#receive-a-location)

## Prerequisites

Node.js 22.12 or newer and a folder with `"type": "module"` (see
[Getting started](/guide/getting-started#requirements), which also explains
the prerelease tags). Then install:

```bash
npm install @botmesh/core @botmesh/baileys
```

## The complete bot

```js
// bot.js
import { Bot, defineBot, isMainModule, loadMediaOf, MediaTooLargeError } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

const createBot = defineBot((provider) => {
  const bot = new Bot({ provider })

  // Every source can be a URL, a local path or a Buffer.
  // The example.com URLs are placeholders: point them at your own files.
  bot.when('photo', (ctx) => ctx.photo('https://picsum.photos/400/300', '📸 A random photo'))
  bot.when('menu', (ctx) => ctx.file('https://example.com/menu.pdf', 'menu.pdf', '📄 Our menu'))
  bot.when('video', (ctx) => ctx.video('https://example.com/clip.mp4', '🎬 A short clip'))
  bot.when('voice', (ctx) => ctx.voice('https://example.com/note.ogg'))
  bot.when('sticker', (ctx) => ctx.sticker('https://picsum.photos/512/512.webp', { pack: 'My bot', author: 'me' }))
  bot.when('where', (ctx) => ctx.location(4.711, -74.0721, 'Bogotá, Colombia'))
  bot.when('contact', (ctx) => ctx.contact('+573001234567', 'Support'))

  // Inbound media: download the bytes only when you need them
  bot.onType('image', async (ctx) => {
    let media
    try {
      media = await loadMediaOf(ctx, { maxBytes: 5 * 1024 * 1024 })
    } catch (err) {
      if (err instanceof MediaTooLargeError) return ctx.reply('That image is too large (5 MB max).')
      throw err
    }
    if (!media) return ctx.reply('I could not download that image.')
    await ctx.react('😍')
    await ctx.reply(`🖼️ Got your ${media.mimetype} image${ctx.body ? `: "${ctx.body}"` : ''}`)
  })

  // A shared location arrives normalized on ctx.sharedLocation
  bot.onType('location', (ctx) => {
    const loc = ctx.sharedLocation
    return ctx.reply(loc ? `📍 You are at ${loc.latitude}, ${loc.longitude}` : 'I could not read that location')
  })

  bot.onMessage((ctx) => ctx.reply('Try: photo, menu, video, voice, sticker, where, contact, or send an image.'))

  return bot
})

export default createBot

// `node bot.js` connects to WhatsApp; `npx botmesh dev bot.js` skips this block
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'media-bot' }))
  bot.on('ready', () => console.log('✅ Connected. Send "photo" from another phone.'))
  await bot.start()
}
```

## Sample transcript

Captured with `npx botmesh dev bot.js`. The simulator prints media as
`[kind: source]` without downloading it, so the placeholder URLs work there.
`:media image ./cat.jpg My cat` sends `cat.jpg` from the folder you run the
command in (use any image you have):

```text
user › photo
bot › [image: https://picsum.photos/400/300]
      📸 A random photo
user › menu
bot › [document: menu.pdf · https://example.com/menu.pdf]
      📄 Our menu
user › video
bot › [video: https://example.com/clip.mp4]
      🎬 A short clip
user › voice
bot › [voice note: https://example.com/note.ogg]
user › sticker
bot › [sticker: https://picsum.photos/512/512.webp]
user › where
bot › [location: 4.711, -74.0721 · Bogotá, Colombia]
user › contact
bot › [contact: Support · +573001234567]
user › :media image ./cat.jpg My cat
bot › [reaction: 😍]
bot › 🖼️ Got your image/jpeg image: "My cat"
```

## How it works

- **One method per kind.** `ctx.photo`, `ctx.video`, `ctx.file`,
  `ctx.voice` and `ctx.sticker` take a URL, a local path or a `Buffer`;
  `ctx.file(source, filename, caption)` sets the name the user sees.
  `ctx.location(lat, lng, name?)` takes coordinates and
  `ctx.contact(phone, displayName?)` a phone number.
- **Transport details stay in the provider.** On WhatsApp a voice note is
  converted with ffmpeg and a sticker needs the optional `sharp` package.
  Telegram sends them as they are, so there a sticker URL must point at a
  `.webp` file (hence `512.webp`). What each channel supports is in the
  [capability matrix](/guide/channels#capability-matrix).
- **Inbound media is lazy.** The message only carries a reference;
  `loadMediaOf(ctx, { maxBytes })` downloads it once and returns
  `{ buffer, mimetype }`, or `undefined` if the download fails. A file over
  `maxBytes` throws `MediaTooLargeError`, which the handler turns into a
  reply. `ctx.body` is the caption.
- **Locations** arrive as `type: 'location'` with `ctx.sharedLocation`
  (`latitude`, `longitude`, `name?`); `ctx.location()` is the method that
  **sends** one. The simulator has no command to share a location; the
  docs test sends one with `MockProvider.incomingLocation()`.
- **Outside a handler**, `bot.send(chatId, { kind: 'image', media: { url }, caption })`
  sends the same contents, for example from a [scheduled task](./reminders).

## Run it on WhatsApp or Telegram

`node bot.js` prints a QR: scan it in WhatsApp → Linked devices. For
Telegram, install `@botmesh/telegram` and swap the provider as shown in
[Or connect Telegram](/guide/getting-started#or-connect-telegram); the
factory does not change.

## Next steps

- [Poll bot](./poll-bot): polls and reactions
- [Messages & media](/guide/messages): edits, typing indicators, every send method
- [Voice (STT/TTS)](/guide/voice): transcribe the voice notes users send
