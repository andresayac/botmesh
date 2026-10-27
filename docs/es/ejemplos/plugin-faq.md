# Crear un plugin: FAQ con herramientas

Construye un plugin de preguntas frecuentes reutilizable que responde a
palabras clave, comparte sus contadores con el resto del bot como herramienta
y limpia lo suyo cuando lo desconectas.

**Nivel:** Avanzado · **Etiquetas:** Plugins, Inyección de dependencias, WhatsApp, Telegram

**Funcionalidades:**
[Plugins](/es/guide/plugins) (`definePlugin`, `install`/`uninstall`, `ctx.onDispose`, unplug) ·
[Inyección de dependencias](/es/guide/di) (`provide`, `ctx.tools`) ·
[Comandos slash](/es/guide/plugins#incluido-slashcommands) ·
[Comandos y triggers](/es/guide/conceptos) ·
[Simulador en la terminal](/es/guide/simulador)

## Requisitos previos

Node.js 22.12 o superior y un proyecto ESM (`"type": "module"`), como en
[Inicio rápido](/es/guide/inicio#requisitos).

```bash
npm install @botmesh/core @botmesh/baileys
```

## El bot completo

```js
// bot.js
import { Bot, defineBot, definePlugin, isMainModule, slashCommandsPlugin } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

// 1. El plugin: responde preguntas frecuentes y cuenta cuáles pregunta la gente
export const faqPlugin = definePlugin({
  name: 'faq',
  version: '1.0.0',
  description: 'FAQ por palabras clave con contadores',
  install(ctx, config = {}) {
    const answers = config.answers ?? {}
    const hits = new Map(Object.keys(answers).map((topic) => [topic, 0]))

    // 2. Una herramienta: cualquier handler o plugin la lee como ctx.tools.faq
    ctx.bot.provide('faq', {
      topics: () => [...hits.keys()],
      stats: () => Object.fromEntries(hits),
    })

    // 3. Lo registrado con ctx.bot se quita solo al desconectar el plugin
    ctx.bot.command('faq', (c) => c.reply(`❓ Pregúntame por: ${[...hits.keys()].join(', ')}`))
    for (const [topic, answer] of Object.entries(answers)) {
      ctx.bot.when(topic, async (c) => {
        hits.set(topic, hits.get(topic) + 1)
        await c.reply(answer)
      })
    }

    // 4. Lo demás lo deshaces tú: un temporizador y la herramienta publicada
    const report = setInterval(() => ctx.logger.info({ hits: Object.fromEntries(hits) }, 'faq stats'), config.reportEvery ?? 3_600_000)
    report.unref()
    ctx.onDispose(() => clearInterval(report))
    ctx.onDispose(() => delete ctx.tools.faq)
  },
  // 5. Corre primero al desconectar el plugin
  uninstall(ctx) {
    ctx.logger.info('faq plugin removed')
  },
})

const createBot = defineBot((provider) => {
  const bot = new Bot({ provider, lang: 'es' })
  bot.plug(slashCommandsPlugin)

  // 6. Usar el plugin: plug() devuelve la función que lo desconecta
  const unplugFaq = bot.plug(faqPlugin, {
    answers: {
      horario: '🕘 Abrimos de lunes a sábado, de 9:00 a 18:00.',
      envios: '🚚 Los pedidos llegan en 2 o 3 días hábiles.',
      devoluciones: '↩️ Puedes devolver cualquier producto en 30 días.',
    },
  })

  // 7. Leer la herramienta del plugin desde tus propios handlers
  bot.command('faqstats', (ctx) => {
    const faq = ctx.tools.faq
    if (!faq) return ctx.reply('La FAQ está desactivada.')
    const lines = Object.entries(faq.stats()).map(([topic, n]) => `• ${topic}: ${n}`)
    return ctx.reply(`📊 Consultas de la FAQ\n${lines.join('\n')}`)
  })
  // Un interruptor de administración (protege estos comandos en un bot real)
  bot.command('faqoff', (ctx) => {
    unplugFaq()
    return ctx.reply('🔌 Plugin de FAQ desconectado.')
  })

  bot.onMessage((ctx) => ctx.reply('Envía /faq para ver qué puedo responder.'))
  return bot
})

export default createBot

if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'faq-bot' }))
  bot.on('ready', () => bot.logger.info('connected'))
  await bot.start()
}
```

## Cómo funciona

### 1. `definePlugin` e `install`

`definePlugin(spec)` solo tipa el spec: un `name`, una `version` y un
`install(ctx, config)` que lo registra todo. `install` debe ser
**síncrono** (el bot no lo espera). `config` es el segundo argumento de
`bot.plug()`, así que un mismo plugin sirve a varios bots con respuestas
distintas.

### 2. Compartir una herramienta con `provide`

`ctx.bot.provide('faq', valor)` guarda `valor` en el registro de herramientas
del bot. Cualquier handler, hook o plugin lo lee como `ctx.tools.faq`: el
comando `/faqstats` del propio bot (paso 7) usa los contadores del plugin sin
importar nada de él. Mira [Inyección de dependencias](/es/guide/di).

### 3. Lo que el unplug deshace por ti

Lo registrado **a través de `ctx.bot`** (`command`, `when`, `onMessage`,
hooks, flujos, plugins anidados) queda anotado y se quita al desconectar el
plugin. Por eso `horario` deja de responder después de `/faqoff`.

### 4. Lo que deshaces tú: `ctx.onDispose`

El unplug no sabe nada de tus temporizadores, conexiones ni de las
herramientas que publicaste con `provide()`. Registra su limpieza con
`ctx.onDispose(fn)`. Aquí detiene el log de estadísticas de cada hora y borra
`ctx.tools.faq`, para que `/faqstats` sepa que el plugin ya no está.
`report.unref()` evita que el temporizador mantenga vivo el proceso.

### 5. `uninstall`

`uninstall(ctx)` corre primero al desconectar, antes del rollback automático
y de los callbacks de `onDispose`: el sitio para volcar o registrar un estado
final.

### 6. Conectar y desconectar

`bot.plug(plugin, config)` devuelve la función de desconexión (no el bot, así
que las llamadas no se encadenan). Llamarla dos veces no hace nada. Conectar
un segundo plugin llamado `faq` lanza un error, salvo que el spec ponga
`multiple: true`.

## Transcripción de ejemplo

Capturada con `npx botmesh dev bot.js`:

```text
user › /faq
bot › ❓ Pregúntame por: horario, envios, devoluciones
user › horario
bot › 🕘 Abrimos de lunes a sábado, de 9:00 a 18:00.
user › Envíos
bot › 🚚 Los pedidos llegan en 2 o 3 días hábiles.
user › horario
bot › 🕘 Abrimos de lunes a sábado, de 9:00 a 18:00.
user › /faqstats
bot › 📊 Consultas de la FAQ
      • horario: 2
      • envios: 1
      • devoluciones: 0
user › /faqoff
bot › 🔌 Plugin de FAQ desconectado.
user › horario
bot › Envía /faq para ver qué puedo responder.
user › /faqstats
bot › La FAQ está desactivada.
```

`Envíos` coincide con `envios`: los triggers de texto comparan el mensaje
completo, normalizado (mayúsculas, tildes y espacios de más).

## Ejecutarlo en WhatsApp o Telegram

`node bot.js` se conecta a WhatsApp: escanea el QR con el teléfono que hará de
bot. Para Telegram, instala `@botmesh/telegram` y pasa
`new TelegramProvider({ token: process.env.TELEGRAM_TOKEN })` en su lugar; el
plugin no cambia. Mira [Canales](/es/guide/canales).

## Siguientes pasos

- [Plugins](/es/guide/plugins): `requires`, `multiple` y la referencia completa de `ctx`
- [Probar tu bot](./probar-tu-bot): cubre el plugin con `createTestBot`
- [Ejemplo: rate limiter](./rate-limiter): un plugin sobre un hook `before('message')`
