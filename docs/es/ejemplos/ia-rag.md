# IA que responde con tus propias preguntas frecuentes (RAG)

Un bot de soporte que responde a partir de un FAQ en Markdown que escribes tú, cita la sección que usó y lo dice cuando el FAQ no tiene la respuesta.

**Nivel:** Intermedio · **Etiquetas:** IA, RAG, WhatsApp, Telegram

**Funcionalidades:** [RAG con cualquier retriever](/es/guide/ai-memoria-rag#rag) ·
[citas con `appendSources`](/es/guide/ai-memoria-rag#rag) ·
[`warmup()` del retriever al arrancar](/es/guide/ai-memoria-rag#rag) ·
[autoresponder de IA](/es/guide/ai#quickstart-autoresponder) ·
[coste y latencia](/es/guide/ai#coste-y-latencia)

## Requisitos

- Node.js 22.12 o superior.
- Una API key de Anthropic en la variable de entorno `ANTHROPIC_API_KEY` (u
  otro proveedor de modelos, ver [más abajo](#otros-proveedores-de-modelos)).

```bash
npm install @botmesh/core @botmesh/ai @anthropic-ai/sdk @botmesh/baileys
```

Mientras los paquetes estén en prerelease, añade el dist-tag que indica
[Inicio rápido](/es/guide/inicio#requisitos).

## Tu FAQ

Guárdalo como `faq.md` junto a `bot.js`. Cada sección `## ` es un pasaje que
el modelo puede citar.

```md
<!-- faq.md -->
# Preguntas frecuentes de Lámparas Lumen

## Envíos
Enviamos a todo el país. Los pedidos llegan en 2-3 días hábiles; el envío exprés llega al día hábil siguiente.

## Devoluciones
Puedes devolver cualquier lámpara en los 30 días siguientes a la entrega, sin usar y en su caja. El reembolso tarda 5 días hábiles.

## Pagos
Aceptamos tarjetas de crédito y débito, PayPal y transferencia bancaria.

## Garantía
Todas las lámparas tienen 2 años de garantía contra defectos de fabricación.
```

## El bot

```js
// bot.js
import { readFile } from 'node:fs/promises'
import { Bot, defineBot, isMainModule } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'
import { aiPlugin } from '@botmesh/ai'

const STOP_WORDS = new Set(['que', 'los', 'las', 'del', 'con', 'para', 'por', 'una', 'cuanto', 'puedo', 'tarda', 'hay', 'sus'])
// Minúsculas y sin tildes, así "envío" y "envio" coinciden.
const words = (text) =>
  new Set(
    (text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').match(/[a-z0-9]{3,}/g) ?? [])
      .filter((w) => !STOP_WORDS.has(w)),
  )

/**
 * Un retriever pequeño sobre un archivo Markdown: un pasaje por sección `## `, ordenado
 * por las palabras que comparte con la pregunta. El plugin solo necesita
 * `retrieve(query)`, así que una base de datos vectorial o una API de búsqueda encajan igual.
 */
function markdownRetriever(file) {
  let sections
  const load = async () => {
    sections ??= (await readFile(file, 'utf8'))
      .split(/^## /m)
      .slice(1)
      .map((part) => {
        const [title, ...body] = part.trim().split('\n')
        const text = body.join('\n').trim()
        return { title, text, words: words(`${title} ${text}`) }
      })
    return sections
  }
  return {
    warmup: async () => { await load() }, // aiPlugin lo llama al arrancar
    async retrieve(query, { topK = 2 } = {}) {
      const asked = words(query)
      return (await load())
        .map((s) => ({ ...s, score: [...asked].filter((w) => s.words.has(w)).length }))
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .map((s) => ({ text: s.text, citation: `faq.md › ${s.title}`, score: s.score }))
    },
  }
}

const PERSONA = [
  'Eres el asistente de soporte de Lámparas Lumen, una tienda online de lámparas.',
  'Responde solo con la información del contexto. Si no tiene la respuesta,',
  'di que no lo sabes y sugiere escribir a ayuda@lumen.example. Responde en una o dos frases.',
].join(' ')

const RAG = {
  retriever: markdownRetriever(new URL('./faq.md', import.meta.url)),
  topK: 2,              // menos pasajes, prompt más corto
  appendSources: true,  // añade "Fuentes: [1] faq.md › Envíos" a la respuesta
}

const createBot = defineBot((provider) => {
  const bot = new Bot({ provider, lang: 'es' })

  bot.plug(aiPlugin({
    provider: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-haiku-5-5',
    persona: PERSONA,
    maxTokens: 300,
    rag: RAG,
  }))

  return bot
})

export default createBot

// `node bot.js` conecta con WhatsApp; `npx botmesh dev bot.js` se salta este bloque.
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'faq-rag-bot' }))
  bot.on('ready', () => console.log('✅ Conectado'))
  await bot.start()
}
```

## Cómo funciona

- **Recuperación en cada turno.** Antes de cada respuesta el plugin llama a
  `retrieve(pregunta)` y añade los pasajes al prompt de sistema como un bloque
  numerado, con instrucciones para responder a partir de ellos, citarlos como
  `[n]` y tratarlos como datos, no como instrucciones.
- **Citas.** Con `appendSources: true` la respuesta termina con las fuentes
  que citó el modelo. Si nada coincide, no se envía ningún pasaje y la persona
  hace que el modelo diga que no lo sabe en vez de adivinar.
- **Nunca rompe una respuesta.** Si el retriever lanza un error o tarda más de
  `timeoutMs` (10 s por defecto), el turno sigue sin contexto.
- **Arranque.** `warmup()` lee el archivo al arrancar el bot, así la primera
  pregunta no lo espera.
- **Bases de conocimiento más grandes.** Cambia `markdownRetriever` por una
  llamada a tu base de datos vectorial o a tu API de búsqueda: sirve cualquier
  objeto con `retrieve(query)` que resuelva pasajes `{ text, citation?, score? }`.

::: info Retriever listo para usar: `@botmesh/rag`
El paquete `@botmesh/rag` tiene loaders
(Markdown, texto, JSON, PDF), troceado, embeddings (local, OpenAI u Ollama) y un
índice persistente: `rag: { retriever: createRag({ documents: ['./faq.md'] }), appendSources: true }`.
Está en npm desde la beta (`npm install @botmesh/rag@beta`); ver
[`@botmesh/rag`](/es/guide/ai-memoria-rag#botmesh-rag).
:::

## Pruébalo

```bash
npx botmesh dev bot.js --env-file .env   # .env tiene la línea ANTHROPIC_API_KEY=sk-ant-...
```

Una ejecución del código de arriba en el simulador de terminal, con `faq.md` al
lado. El modelo sigue un guion en el test que ejecuta esta página
(`packages/ai/tests/docs-examples-ai.test.ts`), que además comprueba que al
modelo le llegó la sección correcta del FAQ; la recuperación y la línea de
fuentes son las reales.

```text
user › ¿cuánto tarda el envío?
bot › Los pedidos llegan en 2-3 días hábiles, o al día hábil siguiente con envío exprés [1].

      Fuentes: [1] faq.md › Envíos
user › ¿venden ventiladores de escritorio?
bot › Lo siento, no lo sé. Escribe a ayuda@lumen.example, por favor.
user › ¿puedo devolver una lámpara a las dos semanas?
bot › Sí: puedes devolver una lámpara en los 30 días siguientes a la entrega, sin usar y en su caja [1].

      Fuentes: [1] faq.md › Devoluciones
```

## Otros proveedores de modelos

::: details Cambiar a OpenAI, Gemini o un modelo local de Ollama
Solo cambian las opciones del proveedor; `rag` queda igual.

OpenAI (`npm install openai`, key en `OPENAI_API_KEY`):

```js
aiPlugin({ provider: 'openai', apiKey: process.env.OPENAI_API_KEY, model: 'gpt-5-mini', persona: PERSONA, rag: RAG })
```

Gemini (`npm install @google/genai`, key en `GEMINI_API_KEY`):

```js
aiPlugin({ provider: 'gemini', apiKey: process.env.GEMINI_API_KEY, model: 'gemini-3.8-flash', persona: PERSONA, rag: RAG })
```

Ollama en tu máquina (sin paquete ni key; antes ejecuta `ollama pull llama3.1`):

```js
aiPlugin({ provider: 'ollama', model: 'llama3.1', persona: PERSONA, rag: RAG })
```
:::

## Ejecutarlo en WhatsApp o Telegram

`node bot.js` muestra un código QR: escanéalo con WhatsApp (**Dispositivos
vinculados**). Para Telegram, instala `@botmesh/telegram` y arranca la fábrica
con `new TelegramProvider({ token: process.env.TELEGRAM_TOKEN ?? '' })`.

## Siguientes pasos

- [Guía de memoria y RAG](/es/guide/ai-memoria-rag): todas las opciones de `rag`, y la memoria por usuario
- [Enrutador con IA](./ia-enrutador): los pagos a un flujo determinista y lo demás a la IA
- [Índice de ejemplos](./index)
