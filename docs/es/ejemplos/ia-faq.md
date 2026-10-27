# Asistente de preguntas frecuentes con IA y límites

Un asistente de tienda que responde con un LLM, no se sale del tema, rechaza lo demás y nunca manda al modelo una respuesta fija.

**Nivel:** Principiante · **Etiquetas:** IA, WhatsApp, Telegram, Límites

**Funcionalidades:** [autoresponder de IA](/es/guide/ai#quickstart-autoresponder) ·
[persona acotada al negocio](/es/guide/ai#politica-de-ia-de-whatsapp-desde-el-15-01-2026) ·
[triggers de texto y de función](/es/guide/triggers) ·
[comandos slash](/es/guide/primer-bot#_2-comandos-slash) ·
[`/reset` del historial de IA](/es/guide/ai#reset-y-slashcommandsplugin) ·
[coste y latencia](/es/guide/ai#coste-y-latencia) ·
[simulador de terminal](/es/guide/simulador)

## Requisitos

- Node.js 22.12 o superior.
- Una API key de Anthropic en la variable de entorno `ANTHROPIC_API_KEY` (u
  otro proveedor de modelos, ver [más abajo](#otros-proveedores-de-modelos)).
  Nunca escribas la key en el código.

```bash
npm install @botmesh/core @botmesh/ai @anthropic-ai/sdk @botmesh/baileys
```

## El bot

```js
// bot.js
import { Bot, defineBot, isMainModule, slashCommandsPlugin } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'
import { aiPlugin } from '@botmesh/ai'

// La persona es el límite principal: un negocio, de qué hablar y qué rechazar.
const PERSONA = [
  'Eres el asistente de Bicicletas Northwind, una tienda de bicicletas con taller de reparación.',
  'Responde solo sobre nuestras bicicletas, accesorios, reparaciones, horario (lun-sáb 9:00-19:00) y pedidos.',
  'Si la pregunta es de otro tema, di en una frase que solo puedes ayudar con Bicicletas Northwind',
  'y sugiere escribir "asesor" para hablar con una persona.',
  'Nunca inventes precios, existencias ni políticas: si no lo sabes, dilo. Responde en tres frases cortas como mucho.',
].join(' ')

const createBot = defineBot((provider) => {
  const bot = new Bot({ provider, lang: 'es' })

  bot.plug(slashCommandsPlugin, {
    greeting: '🚲 ¡Hola! Soy el asistente de Bicicletas Northwind. Pregúntame por bicis, reparaciones u horario.',
  })

  // Las respuestas fijas nunca llegan al modelo: inmediatas, gratis y siempre correctas.
  bot.when(['horario', 'horarios'], (ctx) => ctx.reply('🕘 Abrimos de lunes a sábado, de 9:00 a 19:00.'))
  bot.when(['asesor', 'humano'], (ctx) => ctx.reply('👤 Llámanos al +1 555 0100 o escribe a ayuda@northwind.example.'))

  // Un límite determinista: los mensajes muy largos no se envían al modelo.
  bot.when(
    (ctx) => ctx.body.length > 500,
    (ctx) => ctx.reply('✂️ Ese mensaje es muy largo. Haz una pregunta corta cada vez, por favor.'),
  )

  // Todo lo demás va al modelo. Va el último, así su /reset también borra el historial de IA.
  bot.plug(aiPlugin({
    provider: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-haiku-5-5',     // un modelo pequeño basta para preguntas frecuentes
    persona: PERSONA,
    maxTokens: 300,                // respuestas cortas: más baratas y rápidas
    context: { maxMessages: 10 },  // historial que se envía con cada pregunta
  }))

  return bot
})

export default createBot

// `node bot.js` conecta con WhatsApp; `npx botmesh dev bot.js` se salta este bloque.
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'faq-bot' }))
  bot.on('ready', () => console.log('✅ Conectado'))
  await bot.start()
}
```

## Cómo funciona

- **Orden de los handlers.** Los comandos, los triggers de `bot.when()` y los
  flujos siempre corren antes que la IA. `aiPlugin` registra un autoresponder
  catch-all que solo ve los mensajes de texto que nadie más atendió, así que
  "horario" y "asesor" los responde tu código, no el modelo.
- **La persona es el límite.** Nombra un negocio, enumera de qué puede hablar
  el bot y dice cómo rechazar lo demás. Desde enero de 2026 WhatsApp solo
  permite IA al servicio de un negocio, nunca como asistente de propósito
  general (ver [Política de IA de WhatsApp](/es/guide/ai#politica-de-ia-de-whatsapp-desde-el-15-01-2026)).
- **Un límite determinista.** Un trigger de función responde él mismo a los
  mensajes de más de 500 caracteres, así un texto pegado nunca se convierte en
  una llamada de pago al modelo. Cualquier regla que puedas comprobar en código
  se añade igual.
- **Coste y latencia.** `model`, `maxTokens` y `context.maxMessages` mantienen
  pequeña cada respuesta. `timeoutMs` (60 s por defecto) acota cada llamada; si
  una llamada falla, el bot responde el texto integrado "⚠️ No puedo responder
  en este momento…" en lugar de caerse.
- **`/reset`.** `aiPlugin` añade su propio `/reset`, que borra el historial de
  IA del chat. Se instala después de `slashCommandsPlugin`, así que su `/reset`
  gana.

## Pruébalo

```bash
npx botmesh dev bot.js --env-file .env   # .env tiene la línea ANTHROPIC_API_KEY=sk-ant-...
```

Esta es una ejecución del código de arriba en el simulador de terminal. Las
respuestas de la IA vienen de un modelo con guion en el test que ejecuta esta
página (`packages/ai/tests/docs-examples-ai.test.ts`); un modelo real las
redacta de otra forma.

```text
user › /start
bot › 🚲 ¡Hola! Soy el asistente de Bicicletas Northwind. Pregúntame por bicis, reparaciones u horario.
user › horario
bot › 🕘 Abrimos de lunes a sábado, de 9:00 a 19:00.
user › ¿reparan bicicletas eléctricas?
bot › Sí, nuestro taller también repara bicicletas eléctricas: motor, batería y frenos. Tráela de lunes a sábado, de 9:00 a 19:00.
user › escríbeme un poema sobre el mar
bot › Lo siento, solo puedo ayudarte con Bicicletas Northwind. Escribe "asesor" para hablar con una persona.
user › asesor
bot › 👤 Llámanos al +1 555 0100 o escribe a ayuda@northwind.example.
```

## Otros proveedores de modelos

::: details Cambiar a OpenAI, Gemini o un modelo local de Ollama
Instala el SDK del proveedor y cambia las opciones de `aiPlugin`; el resto del
bot queda igual.

OpenAI (`npm install openai`, key en `OPENAI_API_KEY`):

```js
aiPlugin({ provider: 'openai', apiKey: process.env.OPENAI_API_KEY, model: 'gpt-5-mini', persona: PERSONA })
```

Gemini (`npm install @google/genai`, key en `GEMINI_API_KEY`):

```js
aiPlugin({ provider: 'gemini', apiKey: process.env.GEMINI_API_KEY, model: 'gemini-3.8-flash', persona: PERSONA })
```

Ollama en tu máquina (sin paquete ni key; antes ejecuta `ollama pull llama3.1`):

```js
aiPlugin({ provider: 'ollama', model: 'llama3.1', persona: PERSONA })
```

La lista completa (y los presets compatibles con OpenAI) está en
[Elegir proveedor](/es/guide/ai#elegir-proveedor).
:::

## Ejecutarlo en WhatsApp o Telegram

`node bot.js` muestra un código QR: escanéalo con WhatsApp (**Dispositivos
vinculados**) y escribe a ese número desde otro teléfono. Para Telegram,
instala `@botmesh/telegram` y arranca la fábrica con
`new TelegramProvider({ token: process.env.TELEGRAM_TOKEN ?? '' })` (ver
[O conectar Telegram](/es/guide/inicio#o-conectar-telegram)).

## Siguientes pasos

- [IA con herramientas](./ia-herramientas-citas): deja que el modelo reserve citas, con confirmación humana
- [Guía del plugin de IA](/es/guide/ai): todas las opciones de `aiPlugin`
- [Índice de ejemplos](./index)
