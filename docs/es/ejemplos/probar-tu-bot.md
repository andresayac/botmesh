# Probar tu bot: Vitest y transcripciones doradas

Cubre un bot con tests de verdad: conduce conversaciones con `createTestBot`,
comprueba cada respuesta y fija el intercambio completo como transcripción
dorada, para que un cambio posterior no lo rompa sin que te enteres.

**Nivel:** Avanzado · **Etiquetas:** Testing, Vitest, Transcripciones doradas, Flujos

**Funcionalidades:**
[Testing](/es/guide/testing) (`createTestBot`, `MockProvider`, `expectReply`, `expectNoReply`) ·
[Transcripciones doradas](/es/guide/transcripciones) (`redactTranscript`, `serializeTranscript`, `assertTranscript`) ·
[Flujos](/es/guide/flujos) (`.ask` con `validate`, `.timeout`) ·
[Comandos slash](/es/guide/plugins#incluido-slashcommands) ·
[Simulador en la terminal](/es/guide/simulador) (`defineBot`)

## Requisitos previos

Node.js 22.12 o superior y un proyecto ESM (`"type": "module"`), como en
[Inicio rápido](/es/guide/inicio#requisitos).

```bash
npm install @botmesh/core @botmesh/baileys
npm install -D vitest
```

El proyecto:

```text
pizza-bot/
├── bot.js
├── package.json             "type": "module", "scripts": { "test": "vitest run" }
└── tests/
    ├── bot.test.js
    └── golden/pedido.json   lo escribe la primera ejecución; luego se commitea
```

## El bot que se prueba

```js
// bot.js
import { Bot, defineBot, flow, isMainModule, slashCommandsPlugin } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

const PRICES = { margarita: 9, pepperoni: 11 }

// 1. Todo lo que hace el bot, registrado sobre cualquier Bot: la app y los tests lo comparten
export function setupBot(bot) {
  bot.plug(slashCommandsPlugin)
  bot.when(['hola', 'buenas'], (ctx) => ctx.reply('🍕 ¡Bienvenido a Pizza Bot! Envía "pedido" para empezar.'))
  bot.use(
    flow('pedido')
      .ask('¿Qué pizza? margarita ($9) o pepperoni ($11)', 'pizza', {
        validate: (body) => (Object.hasOwn(PRICES, body.trim().toLowerCase()) ? true : '❌ Tenemos margarita y pepperoni.'),
      })
      .ask('¿Cuántas? (1-9)', 'qty', {
        validate: (body) => (/^[1-9]$/.test(body.trim()) ? true : '❌ Envía un número del 1 al 9.'),
      })
      .say((_ctx, c) => {
        const pizza = c.state.pizza.trim().toLowerCase()
        const qty = Number(c.state.qty)
        return `✅ ${qty} × ${pizza}: $${qty * PRICES[pizza]}. ¡Gracias!`
      })
      .timeout('10m'),
  )
  bot.onMessage((ctx) => ctx.reply('Envía "pedido" para comprar una pizza.'))
  return bot
}

// 2. La fábrica para `npx botmesh dev`, `node bot.js` y la reproducción de transcripciones
const createBot = defineBot((provider) => setupBot(new Bot({ provider, lang: 'es' })))
export default createBot

if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'pizza-bot' }))
  await bot.start()
}
```

## El archivo de tests completo

```js
// tests/bot.test.js
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { afterEach, expect, test } from 'vitest'
import { assertTranscript, createTestBot, parseTranscript, redactTranscript, serializeTranscript } from '@botmesh/core/testing'
import createBot, { setupBot } from '../bot.js'

const GOLDEN = new URL('./golden/pedido.json', import.meta.url)

// 1. Un bot nuevo por test, sobre un MockProvider: sin teléfono ni red
let running
async function startBot() {
  const t = await createTestBot({ lang: 'es' })
  setupBot(t.bot)
  running = t.bot
  return t
}
afterEach(async () => {
  await running?.stop()
})

test('saluda y apunta al flujo de pedido', async () => {
  const { chat } = await startBot()
  await chat.send('hola')
  await chat.expectReply('🍕 ¡Bienvenido a Pizza Bot! Envía "pedido" para empezar.')
  await chat.send('¿qué?')
  await chat.expectReply('Envía "pedido" para comprar una pizza.')
})

// 2. Una conversación entera, con un error de validación
test('pide dos pepperoni', async () => {
  const { chat } = await startBot()
  await chat.send('pedido')
  await chat.expectReply('¿Qué pizza? margarita ($9) o pepperoni ($11)')
  await chat.send('Pepperoni')
  await chat.expectReply('¿Cuántas? (1-9)')
  await chat.send('muchas')
  await chat.expectReply('❌ Envía un número del 1 al 9.')
  await chat.send('2')
  await chat.expectReply('✅ 2 × pepperoni: $22. ¡Gracias!')
  await chat.expectNoReply()

  // 3. Guardarla como transcripción dorada la primera vez (o con UPDATE_GOLDEN=1)
  if (!existsSync(GOLDEN) || process.env.UPDATE_GOLDEN) {
    mkdirSync(new URL('./golden/', import.meta.url), { recursive: true })
    writeFileSync(GOLDEN, serializeTranscript(redactTranscript(chat.transcript({ name: 'pedido' }))))
  }
})

// 4. Los comandos siempre ganan a una conversación activa
test('/cancel sale del flujo', async () => {
  const { chat } = await startBot()
  await chat.send('pedido')
  await chat.expectReply('¿Qué pizza?')
  await chat.send('/cancel')
  await chat.expectReply(/cancelada/)
  await chat.send('2')
  await chat.expectReply('Envía "pedido" para comprar una pizza.')
  expect(chat.replies()).toHaveLength(3)
})

// 5. Reproducir la transcripción dorada contra la fábrica real: cualquier respuesta distinta falla con un diff
test('la conversación de pedido coincide con su transcripción dorada', async () => {
  const golden = parseTranscript(readFileSync(GOLDEN, 'utf8'))
  await assertTranscript(golden, createBot)
})
```

Ejecútalo:

```bash
npx vitest run
```

La primera ejecución pasa y escribe `tests/golden/pedido.json`. Commitea ese
archivo: a partir de ahí el último test lo reproduce contra `createBot` en
cada ejecución.

## Cómo funciona

### 1. Una función de setup, dos puntos de entrada

`setupBot(bot)` registra todo sobre el `Bot` que reciba. La fábrica
(`createBot`) la envuelve para `npx botmesh dev` y `node bot.js`, y los tests
la llaman sobre el bot que construye `createTestBot()`. Los tests y el bot
real nunca se separan.

### 2. Conversaciones con `createTestBot`

`createTestBot({ lang: 'es' })` arranca un `Bot` sobre un `MockProvider`: sin
teléfono ni red. `chat.send()` es un mensaje del usuario;
`chat.expectReply()` espera una respuesta que contenga el texto (o cumpla una
RegExp) y falla con un `TestKitError` legible que lista lo que el bot sí
envió. `chat.expectNoReply()` comprueba que el bot se queda callado. Para cada
bot en `afterEach`, así ningún temporizador sobrevive al test.

### 3. Grabar la transcripción dorada

`chat.transcript()` devuelve el intercambio en el formato de transcripción
dorada. `redactTranscript()` cambia ids y nombres visibles por marcadores
(`<user:1>`, `<name:1>`), y también los teléfonos o emails que escribió el
usuario, así que el archivo se puede commitear. `serializeTranscript()`
escribe JSON estable y fácil de comparar. Pon `UPDATE_GOLDEN=1` para volver a
grabarla después de un cambio intencionado.

### 4. Los comandos ganan

`/cancel` viene de `slashCommandsPlugin`. Los comandos siempre ganan a una
conversación activa, así que el usuario siempre puede salir de un flujo; el
test comprueba que el flujo terminó de verdad porque `2` llega al catch-all.

### 5. Reproducirla

`assertTranscript(golden, createBot)` construye un bot nuevo con la fábrica,
reproduce cada turno de entrada y compara cada respuesta. Una respuesta
cambiada, ausente o de más lanza un `TranscriptMismatchError` con un informe
de esperado frente a obtenido. Para respuestas que cambian en cada ejecución
(fechas, ids), pasa máscaras:
`assertTranscript(golden, createBot, { masks: [REPLAY_MASKS.isoDate] })`.

### El archivo dorado

El comienzo de `tests/golden/pedido.json` tras la primera ejecución:

```json
{
  "format": "botmesh/transcript",
  "version": 1,
  "source": "recorder",
  "name": "pedido",
  "turns": [
    {
      "dir": "in",
      "chatId": "<user:1>",
      "senderId": "<user:1>",
      "type": "text",
      "text": "pedido",
      "displayName": "<name:1>"
    },
    {
      "dir": "out",
      "chatId": "<user:1>",
      "kind": "text",
      "text": "¿Qué pizza? margarita ($9) o pepperoni ($11)",
      "content": {
        "kind": "text",
        "text": "¿Qué pizza? margarita ($9) o pepperoni ($11)"
      }
    }
  ],
  "redacted": true
}
```

## Transcripción de ejemplo

El mismo bot a mano, capturado con `npx botmesh dev bot.js`:

```text
user › hola
bot › 🍕 ¡Bienvenido a Pizza Bot! Envía "pedido" para empezar.
user › pedido
bot › ¿Qué pizza? margarita ($9) o pepperoni ($11)
user › hawaiana
bot › ❌ Tenemos margarita y pepperoni.
user › Pepperoni
bot › ¿Cuántas? (1-9)
user › muchas
bot › ❌ Envía un número del 1 al 9.
user › 2
bot › ✅ 2 × pepperoni: $22. ¡Gracias!
user › /ping
bot › pong 🏓
```

## Ejecutarlo en WhatsApp o Telegram

`node bot.js` se conecta a WhatsApp: escanea el QR con el teléfono que hará de
bot. Para Telegram, instala `@botmesh/telegram` y pasa
`new TelegramProvider({ token: process.env.TELEGRAM_TOKEN })` a `createBot`.
Los tests no cambian: nunca tocan un canal real.

## Siguientes pasos

- [Testing](/es/guide/testing): varios usuarios y grupos, matchers de Vitest y el kit de caos
- [Transcripciones doradas](/es/guide/transcripciones): grabar desde producción, reglas de redacción y opciones de reproducción
- [Crear un plugin](./plugin-faq): un plugin que puedes cubrir con las mismas herramientas
