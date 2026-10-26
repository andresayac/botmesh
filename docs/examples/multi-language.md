# Multi-language bot

Build a coffee-ordering bot that answers each user in English or Spanish:
it guesses the language from the first message, remembers it, and lets the
user switch with `/lang`.

**Level:** Intermediate · **Tags:** WhatsApp, Telegram, i18n

**Features shown:**
[locales and `ctx.t()`](/guide/i18n) ·
[language resolution and `detect`](/guide/i18n#how-the-language-is-resolved) ·
[`ctx.setLang()`](/guide/i18n#switching-language) ·
[plural forms](/guide/i18n#messages) ·
[translated built-in texts](/guide/i18n#built-in-messages) ·
[`before` hooks](/guide/hooks) ·
[async conversations](/guide/flows#beyond-the-dsl)

## Prerequisites

- Node.js 22.12 or newer and an empty folder with `"type": "module"` in its
  `package.json` ([Getting started](/guide/getting-started#_1-install)).
- While botmesh is in prerelease, add the dist-tag from the
  [prerelease note](/guide/getting-started#requirements) to every `@botmesh/*` package.

```bash
npm install @botmesh/core @botmesh/baileys
```

## The complete bot

```js
// bot.js
import { Bot, defineBot, isMainModule, slashCommandsPlugin } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

// 1. One message tree per language (in a bigger bot: locales/en.json, locales/es.json)
const en = {
  greeting: '👋 Hello {name}! Send "order" for a coffee, "stats" for your count, or /lang es.',
  order: { size: 'Which size?', small: 'Small', large: 'Large', done: '☕ One {size} coffee, coming up!' },
  cups: { zero: 'You have not ordered yet.', one: 'You have ordered {count} coffee.', other: 'You have ordered {count} coffees.' },
  lang: { changed: '🇬🇧 From now on I will answer in English.', usage: 'Use /lang en or /lang es.' },
  fallback: 'Send "hi", "order" or "stats".',
}
const es = {
  greeting: '👋 ¡Hola {name}! Envía "pedido" para un café, "cuenta" para ver cuántos llevas, o /lang en.',
  order: { size: '¿De qué tamaño?', small: 'Pequeño', large: 'Grande', done: '☕ ¡Un café {size}, en camino!' },
  cups: { zero: 'Todavía no has pedido.', one: 'Has pedido {count} café.', other: 'Has pedido {count} cafés.' },
  lang: { changed: '🇪🇸 Desde ahora te respondo en español.', usage: 'Usa /lang en o /lang es.' },
  fallback: 'Envía "hola", "pedido" o "cuenta".',
}

const createBot = defineBot((provider) => {
  // 2. Serve two languages; guess Spanish from the first word of a message
  const bot = new Bot({
    provider,
    i18n: {
      defaultLocale: 'en',
      locales: ['en', 'es'],
      detect: (ctx) => (/^(hola|buenas|pedido|cuenta)\b/i.test(ctx.body) ? 'es' : undefined),
    },
  })
  bot.locale('en', en)
  bot.locale('es', es)

  // 3. Remember a detected language, so the next messages keep it
  bot.before('message', async (ctx, next) => {
    if (ctx.langSource === 'detector') await ctx.setLang(ctx.lang)
    await next()
  })

  // Built-in texts (/help, /cancel, timeouts...) follow ctx.lang too
  bot.plug(slashCommandsPlugin)

  // 4. Switch on demand: stored in the user's profile (ctx.user)
  bot.command('lang', async (ctx, [code]) => {
    if (code !== 'en' && code !== 'es') return ctx.reply(ctx.t('lang.usage'))
    await ctx.setLang(code)
    await ctx.reply(ctx.t('lang.changed'))
  })

  bot.when(['hi', 'hello', 'hola'], (ctx) => ctx.reply(ctx.t('greeting', { name: ctx.pushName ?? '' })))

  // 5. A conversation in the user's language: c.t() follows the latest message
  bot.conversation(
    'order',
    async (c, ctx) => {
      const size = await c.choose(c.t('order.size'), { small: c.t('order.small'), large: c.t('order.large') })
      await ctx.user.set('cups', ((await ctx.user.get('cups')) ?? 0) + 1)
      await c.say(c.t('order.done', { size: c.t(`order.${size}`).toLowerCase() }))
    },
    { trigger: ['order', 'pedido'] },
  )

  // 6. Plural forms: the count picks zero / one / other
  bot.when(['stats', 'cuenta'], async (ctx) => ctx.reply(ctx.t('cups', { count: (await ctx.user.get('cups')) ?? 0 })))

  bot.onMessage((ctx) => ctx.reply(ctx.t('fallback')))

  return bot
})

export default createBot

// `node bot.js` connects to WhatsApp; `npx botmesh dev bot.js` skips this block
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'coffee-bot' }))
  bot.on('ready', () => console.log('✅ Connected'))
  await bot.start()
}
```

## How it works

1. **Message trees.** `bot.locale(code, messages)` registers one tree per
   language. Keys nest (`ctx.t('order.size')`) and `{name}` placeholders are
   filled from the second argument. In a bigger bot, keep each tree in its own
   file and import it: `import en from './locales/en.json' with { type: 'json' }`.
2. **Which language.** For every message the bot picks the first language it
   serves from: the user's stored choice, the language their client reports
   (Telegram sends one, WhatsApp does not), your `detect` function, then
   `defaultLocale`. `locales: ['en', 'es']` limits it to the languages you
   translated. `ctx.langSource` says which one won.
3. **Remembering a guess.** `detect` only looks at the current message, so the
   `before('message')` hook stores a detected language with `ctx.setLang()`.
   The messages that follow keep it, even those `detect` does not recognise
   (`/cancel` and `1` in the transcript).
4. **Switching.** `/lang es` calls `ctx.setLang('es')`, saved in the user's
   profile ([`ctx.user`](/guide/user-data)) under the key `lang`.
5. **Conversations.** `c.t()` translates with the language of the latest
   message, so the menu labels come from the same tree. The DSL's
   `.choose()` takes fixed labels; build menus with `c.choose()` in a
   conversation when they must be translated.
6. **Plurals.** `cups` has `zero`, `one` and `other` forms; `count` picks
   one with `Intl.PluralRules`.

The texts the framework writes for you (`/help`, `/cancel`, timeouts, retry
messages) come in English and Spanish and follow `ctx.lang` too: compare
`/cancel` in the transcript.

## Try it

```bash
npx botmesh dev bot.js --user ana --name Ana
```

```text
ana › hi
bot › 👋 Hello Ana! Send "order" for a coffee, "stats" for your count, or /lang es.
ana › stats
bot › You have not ordered yet.
ana › order
bot › Which size?

      1) Small
      2) Large
ana › 2
bot › ☕ One large coffee, coming up!
ana › stats
bot › You have ordered 1 coffee.
ana › hola
bot › 👋 ¡Hola Ana! Envía "pedido" para un café, "cuenta" para ver cuántos llevas, o /lang en.
ana › pedido
bot › ¿De qué tamaño?

      1) Pequeño
      2) Grande
ana › /cancel
bot › ✅ Conversación cancelada.
ana › pedido
bot › ¿De qué tamaño?

      1) Pequeño
      2) Grande
ana › 1
bot › ☕ ¡Un café pequeño, en camino!
ana › cuenta
bot › Has pedido 2 cafés.
ana › /lang en
bot › 🇬🇧 From now on I will answer in English.
ana › stats
bot › You have ordered 2 coffees.
ana › /lang fr
bot › Use /lang en or /lang es.
```

## Run it on WhatsApp or Telegram

`node bot.js` shows a QR code: scan it from **WhatsApp → Linked devices**. On
Telegram, install `@botmesh/telegram` and swap the provider as in
[Or connect Telegram](/guide/getting-started#or-connect-telegram): the bot then
also reads the language of each user's Telegram app, before `detect`.

## Next steps

- [Internationalization (i18n)](/guide/i18n): fallbacks, regional variants and the built-in keys
- [Order tracking](./order-tracking): more per-user data with `ctx.user`
- [Group bot](./group-bot): per-participant conversations in groups
