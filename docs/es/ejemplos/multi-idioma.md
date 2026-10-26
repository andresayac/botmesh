# Bot multi-idioma

Construye un bot para pedir café que responde a cada usuario en español o en
inglés: deduce el idioma del primer mensaje, lo recuerda y deja cambiarlo
con `/lang`.

**Nivel:** Intermedio · **Etiquetas:** WhatsApp, Telegram, i18n

**Funcionalidades:**
[locales y `ctx.t()`](/es/guide/i18n) ·
[resolución del idioma y `detect`](/es/guide/i18n#como-se-resuelve-el-idioma) ·
[`ctx.setLang()`](/es/guide/i18n#cambiar-de-idioma) ·
[formas de plural](/es/guide/i18n#mensajes) ·
[textos integrados traducidos](/es/guide/i18n#mensajes-internos) ·
[hooks `before`](/es/guide/hooks) ·
[conversaciones async](/es/guide/flujos#mas-alla-del-dsl)

## Requisitos

- Node.js 22.12 o superior y una carpeta vacía con `"type": "module"` en su
  `package.json` ([Inicio rápido](/es/guide/inicio#_1-instalar)).
- Mientras botmesh esté en prerelease, añade a cada paquete `@botmesh/*` el
  dist-tag de la [nota de prerelease](/es/guide/inicio#requisitos).

```bash
npm install @botmesh/core @botmesh/baileys
```

## El bot completo

```js
// bot.js
import { Bot, defineBot, isMainModule, slashCommandsPlugin } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

// 1. Un árbol de mensajes por idioma (en un bot más grande: locales/es.json, locales/en.json)
const es = {
  greeting: '👋 ¡Hola {name}! Envía "pedido" para un café, "cuenta" para ver cuántos llevas, o /lang en.',
  order: { size: '¿De qué tamaño?', small: 'Pequeño', large: 'Grande', done: '☕ ¡Un café {size}, en camino!' },
  cups: { zero: 'Todavía no has pedido.', one: 'Has pedido {count} café.', other: 'Has pedido {count} cafés.' },
  lang: { changed: '🇪🇸 Desde ahora te respondo en español.', usage: 'Usa /lang es o /lang en.' },
  fallback: 'Envía "hola", "pedido" o "cuenta".',
}
const en = {
  greeting: '👋 Hello {name}! Send "order" for a coffee, "stats" for your count, or /lang es.',
  order: { size: 'Which size?', small: 'Small', large: 'Large', done: '☕ One {size} coffee, coming up!' },
  cups: { zero: 'You have not ordered yet.', one: 'You have ordered {count} coffee.', other: 'You have ordered {count} coffees.' },
  lang: { changed: '🇬🇧 From now on I will answer in English.', usage: 'Use /lang es or /lang en.' },
  fallback: 'Send "hi", "order" or "stats".',
}

const createBot = defineBot((provider) => {
  // 2. Atiende dos idiomas; deduce el inglés por la primera palabra del mensaje
  const bot = new Bot({
    provider,
    i18n: {
      defaultLocale: 'es',
      locales: ['es', 'en'],
      detect: (ctx) => (/^(hi|hello|order|stats)\b/i.test(ctx.body) ? 'en' : undefined),
    },
  })
  bot.locale('es', es)
  bot.locale('en', en)

  // 3. Recuerda el idioma detectado, para que los mensajes siguientes lo mantengan
  bot.before('message', async (ctx, next) => {
    if (ctx.langSource === 'detector') await ctx.setLang(ctx.lang)
    await next()
  })

  // Los textos integrados (/help, /cancel, timeouts...) también siguen a ctx.lang
  bot.plug(slashCommandsPlugin)

  // 4. Cambio a petición: se guarda en el perfil del usuario (ctx.user)
  bot.command('lang', async (ctx, [code]) => {
    if (code !== 'es' && code !== 'en') return ctx.reply(ctx.t('lang.usage'))
    await ctx.setLang(code)
    await ctx.reply(ctx.t('lang.changed'))
  })

  bot.when(['hola', 'hi', 'hello'], (ctx) => ctx.reply(ctx.t('greeting', { name: ctx.pushName ?? '' })))

  // 5. Una conversación en el idioma del usuario: c.t() sigue al último mensaje
  bot.conversation(
    'pedido',
    async (c, ctx) => {
      const size = await c.choose(c.t('order.size'), { small: c.t('order.small'), large: c.t('order.large') })
      await ctx.user.set('cups', ((await ctx.user.get('cups')) ?? 0) + 1)
      await c.say(c.t('order.done', { size: c.t(`order.${size}`).toLowerCase() }))
    },
    { trigger: ['pedido', 'order'] },
  )

  // 6. Formas de plural: el número elige zero / one / other
  bot.when(['cuenta', 'stats'], async (ctx) => ctx.reply(ctx.t('cups', { count: (await ctx.user.get('cups')) ?? 0 })))

  bot.onMessage((ctx) => ctx.reply(ctx.t('fallback')))

  return bot
})

export default createBot

// `node bot.js` se conecta a WhatsApp; `npx botmesh dev bot.js` se salta este bloque
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'bot-cafe' }))
  bot.on('ready', () => console.log('✅ Conectado'))
  await bot.start()
}
```

## Cómo funciona

1. **Árboles de mensajes.** `bot.locale(código, mensajes)` registra un árbol
   por idioma. Las claves se anidan (`ctx.t('order.size')`) y los
   marcadores `{name}` se rellenan con el segundo argumento. En un bot más
   grande, guarda cada árbol en su archivo e impórtalo:
   `import es from './locales/es.json' with { type: 'json' }`.
2. **Qué idioma.** En cada mensaje el bot elige el primer idioma que atiende
   entre: la elección guardada del usuario, el idioma que informa su cliente
   (Telegram lo envía, WhatsApp no), tu función `detect` y por último
   `defaultLocale`. `locales: ['es', 'en']` lo limita a los idiomas que has
   traducido. `ctx.langSource` dice cuál ganó.
3. **Recordar lo detectado.** `detect` solo mira el mensaje actual, así que el
   hook `before('message')` guarda el idioma detectado con `ctx.setLang()`. Los
   mensajes siguientes lo mantienen, también los que `detect` no reconoce
   (`/cancel` y `1` en la transcripción).
4. **Cambiar.** `/lang en` llama a `ctx.setLang('en')`, que se guarda en el
   perfil del usuario ([`ctx.user`](/es/guide/datos-usuario)) con la clave `lang`.
5. **Conversaciones.** `c.t()` traduce con el idioma del último mensaje, así
   que las etiquetas del menú salen del mismo árbol. El `.choose()` del DSL
   recibe etiquetas fijas; cuando el menú debe traducirse, constrúyelo con
   `c.choose()` en una conversación.
6. **Plurales.** `cups` tiene las formas `zero`, `one` y `other`; `count`
   elige una con `Intl.PluralRules`.

Los textos que escribe el framework por ti (`/help`, `/cancel`, timeouts,
mensajes de reintento) vienen en español e inglés y también siguen a
`ctx.lang`: compara `/cancel` en la transcripción.

## Pruébalo

```bash
npx botmesh dev bot.js --user ana --name Ana
```

```text
ana › hola
bot › 👋 ¡Hola Ana! Envía "pedido" para un café, "cuenta" para ver cuántos llevas, o /lang en.
ana › cuenta
bot › Todavía no has pedido.
ana › pedido
bot › ¿De qué tamaño?

      1) Pequeño
      2) Grande
ana › 2
bot › ☕ ¡Un café grande, en camino!
ana › cuenta
bot › Has pedido 1 café.
ana › hi
bot › 👋 Hello Ana! Send "order" for a coffee, "stats" for your count, or /lang es.
ana › order
bot › Which size?

      1) Small
      2) Large
ana › /cancel
bot › ✅ Conversation cancelled.
ana › order
bot › Which size?

      1) Small
      2) Large
ana › 1
bot › ☕ One small coffee, coming up!
ana › stats
bot › You have ordered 2 coffees.
ana › /lang es
bot › 🇪🇸 Desde ahora te respondo en español.
ana › cuenta
bot › Has pedido 2 cafés.
ana › /lang fr
bot › Usa /lang es o /lang en.
```

## Ejecútalo en WhatsApp o Telegram

`node bot.js` muestra un código QR: escanéalo desde **WhatsApp → Dispositivos
vinculados**. En Telegram, instala `@botmesh/telegram` y cambia el provider
como en [O conectar Telegram](/es/guide/inicio#o-conectar-telegram): el bot
también lee el idioma de la app de Telegram de cada usuario, antes de `detect`.

## Siguientes pasos

- [Internacionalización (i18n)](/es/guide/i18n): fallbacks, variantes regionales y las claves integradas
- [Seguimiento de pedidos](./seguimiento-pedidos): más datos por usuario con `ctx.user`
- [Bot de grupo](./bot-de-grupo): conversaciones por participante en grupos
