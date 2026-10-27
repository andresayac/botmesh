# Respuestas de IA en streaming en Telegram

Un asistente de cocina en Telegram cuyas respuestas aparecen mientras el modelo las escribe, ajustado para coste y latencia.

**Nivel:** Intermedio · **Etiquetas:** IA, Streaming, Telegram, Rendimiento

**Funcionalidades:** [autoresponder en streaming (`stream`)](/es/guide/streaming#con-botmesh-ai) ·
[estrategias por canal: borradores, ediciones, trozos](/es/guide/streaming#estrategias-por-canal) ·
["escribiendo…" mientras genera](/es/guide/ai#config-completa-de-aiplugin-config) ·
[provider de Telegram](/es/guide/inicio#o-conectar-telegram) ·
[coste y latencia](/es/guide/ai#coste-y-latencia) ·
[probar streams con `MockProvider`](/es/guide/streaming#testing)

## Requisitos

- Node.js 22.12 o superior.
- Un token de bot de Telegram de [@BotFather](https://t.me/BotFather) en
  `TELEGRAM_TOKEN`.
- Una API key de Anthropic en `ANTHROPIC_API_KEY` (u otro proveedor de
  modelos, ver [más abajo](#otros-proveedores-de-modelos)).

```bash
npm install @botmesh/core @botmesh/ai @anthropic-ai/sdk @botmesh/telegram
```

## El bot

```js
// bot.js
import { Bot, defineBot, isMainModule, slashCommandsPlugin } from '@botmesh/core'
import { TelegramProvider } from '@botmesh/telegram'
import { aiPlugin } from '@botmesh/ai'

const createBot = defineBot((provider) => {
  const bot = new Bot({ provider, lang: 'es' })

  bot.plug(slashCommandsPlugin, {
    greeting: '🍳 ¡Hola! Soy el asistente de cocina de Pantry. Pídeme una receta o un truco de cocina.',
  })

  bot.plug(aiPlugin({
    provider: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-haiku-5-5',      // modelo pequeño: las primeras palabras llegan antes y cada token cuesta menos
    persona: 'Eres el asistente de cocina de la app de recetas Pantry. Habla solo de cocina. Usa párrafos cortos.',
    maxTokens: 800,                 // limita la longitud (y la factura) de cada respuesta
    timeoutMs: 20_000,              // con streaming: el silencio máximo permitido entre dos trozos
    context: { maxMessages: 6 },    // menos historial por llamada: un prompt más corto y barato
    stream: { cursor: ' ▌', canStop: true },
  }))

  return bot
})

export default createBot

// `node --env-file=.env bot.js` conecta con Telegram; `npx botmesh dev bot.js` se salta este bloque.
if (isMainModule(import.meta)) {
  const bot = await createBot(new TelegramProvider({ token: process.env.TELEGRAM_TOKEN ?? '' }))
  bot.on('ready', () => console.log('✅ Conectado. Escribe a tu bot en Telegram.'))
  await bot.start()
}
```

## Cómo funciona

- **Una opción.** `stream` hace que el autoresponder envíe la respuesta con
  [`ctx.stream()`](/es/guide/streaming) mientras el modelo la genera. El mismo
  código elige la mejor estrategia para cada canal:

  | Canal | Qué ve el usuario |
  | --- | --- |
  | Chat privado de Telegram | Un borrador nativo que crece en su sitio (`sendMessageDraft`) y después el mensaje final |
  | Grupo de Telegram, Discord | Un mensaje que se edita según llega el texto |
  | WhatsApp, Messenger, Instagram, el simulador | Mensajes del tamaño de una frase con "escribiendo…" entre ellos |

- **`cursor`** se muestra al final del texto mientras se escribe y nunca en el
  mensaje final. **`canStop`** añade al borrador el botón de parar de
  Telegram: pulsarlo aborta la petición al modelo, así dejas de pagarla.
- **Escribiendo.** `humanizeTyping` (activo por defecto) muestra
  "escribiendo…" hasta que llegan las primeras palabras.
- **Las herramientas desactivan el streaming.** Un turno que puede llamar a
  [herramientas](/es/guide/ai-herramientas) necesita la respuesta completa
  antes, así que con `tools` configuradas la respuesta va en un solo mensaje.

## Consejos de coste y latencia

| Ajuste | Efecto |
| --- | --- |
| `model` | La palanca más grande. Un modelo pequeño (`claude-haiku-5-5`, `gpt-5-mini`, `gemini-3.8-flash`) responde antes y cuesta una fracción de uno grande. |
| `maxTokens` | Limita cada respuesta. Incluye los tokens de pensamiento de los modelos de razonamiento: si es muy bajo, la respuesta sale vacía. |
| `timeoutMs` | Sin streaming, el tiempo total de una llamada; con streaming, la pausa máxima entre trozos, así una respuesta larga nunca se corta mientras siga fluyendo. |
| `context.maxMessages` | Cada turno reenvía la ventana de historial: menos mensajes, prompt más corto. |
| `effort` (Anthropic) | `'low'` piensa menos: más rápido y barato en preguntas sencillas. |
| `stream` | No baja el coste, pero las primeras palabras se ven en un segundo en vez de al final de toda la respuesta. |

Responde lo obvio sin el modelo (comandos, triggers de `bot.when()`, flujos) y
mira [Coste y latencia](/es/guide/ai#coste-y-latencia) para el resto.

## Pruébalo

```bash
npx botmesh dev bot.js --env-file .env   # .env tiene la línea ANTHROPIC_API_KEY=sk-ant-...
```

El simulador no tiene borradores ni ediciones, así que muestra la estrategia
de "trozos" que usa WhatsApp: la respuesta llega en mensajes del tamaño de una
frase. Esta ejecución sigue un guion en el test que ejecuta esta página
(`packages/ai/tests/docs-examples-ai.test.ts`), que además ejecuta el bot sobre
un provider simulado parecido a Telegram y comprueba que allí la respuesta
llega como un borrador que crece.

```text
user › ¿cómo hago una sopa de tomate rápida?
bot › Sofríe una cebolla picada y dos dientes de ajo en aceite de oliva durante cinco minutos. Añade una lata de 400 g de tomate triturado, una taza de caldo, sal y una pizca de azúcar, y cuece 15 minutos.
bot › Tritúralo hasta que quede fino y termina con albahaca fresca y un chorrito de nata. Sírvela caliente con pan tostado.
```

## Otros proveedores de modelos

::: details Cambiar a OpenAI, Gemini o un modelo local de Ollama
Todos los proveedores hacen streaming. Deja las demás opciones como están.

OpenAI (`npm install openai`, key en `OPENAI_API_KEY`):

```js
aiPlugin({ provider: 'openai', apiKey: process.env.OPENAI_API_KEY, model: 'gpt-5-mini', stream: true })
```

Gemini (`npm install @google/genai`, key en `GEMINI_API_KEY`):

```js
aiPlugin({ provider: 'gemini', apiKey: process.env.GEMINI_API_KEY, model: 'gemini-3.8-flash', stream: true })
```

Ollama en tu máquina (sin paquete ni key; antes ejecuta `ollama pull llama3.1`):
el primer token llega sin pasar por la red, y no hay límite de salida salvo
que pongas `maxTokens`.

```js
aiPlugin({ provider: 'ollama', model: 'llama3.1', stream: true })
```
:::

## Ejecutarlo en Telegram o WhatsApp

Pon el token y la key en un archivo `.env` junto a `bot.js`
(`TELEGRAM_TOKEN=...` y `ANTHROPIC_API_KEY=...`), ejecuta
`node --env-file=.env bot.js` y escribe a tu bot en Telegram. Para WhatsApp,
instala `@botmesh/baileys` y arranca la fábrica con
`new BaileysProvider({ session: 'pantry-bot' })`: el mismo código envía la
respuesta en trozos con "escribiendo…".

## Siguientes pasos

- [Respuestas en streaming](/es/guide/streaming): `ctx.stream()` en tus propios handlers y todas las opciones
- [Asistente de preguntas frecuentes con IA](./ia-faq): la persona y los límites de un asistente de negocio
- [Índice de ejemplos](./index)
