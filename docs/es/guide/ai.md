# Plugin de IA

`@botmesh/ai` responde a tus usuarios con un modelo de lenguaje. Un solo
`bot.plug(aiPlugin(...))` te da:

- un **autoresponder** para cada mensaje de texto que tus comandos, triggers y
  flows no manejaron, con historial por chat;
- **`ctx.tools.ai`**, un cliente que llamas desde tus propios handlers, flows y
  conversaciones;
- opcionalmente, [herramientas](/es/guide/ai-herramientas),
  [memoria a largo plazo y RAG](/es/guide/ai-memoria-rag) y
  [streaming](/es/guide/streaming#con-botmesh-ai).

Funciona con Anthropic, OpenAI, Gemini, Ollama (local o en la nube) y nueve
servicios compatibles con OpenAI, en todos los canales.

::: tip Paquete separado
A diferencia de `slashCommandsPlugin` (incluido en el core), `@botmesh/ai` es
un paquete propio, así que un bot sin IA no arrastra dependencias de IA. Los
SDK de cada proveedor son opcionales y solo se cargan si se usan.
:::

## Quickstart (autoresponder)

Instala el plugin y el SDK de tu proveedor (aquí Anthropic, el de por defecto):

```bash
pnpm add @botmesh/ai @anthropic-ai/sdk
```

Mientras los paquetes estén en prerelease, añade el dist-tag que indica
[Inicio](/es/guide/inicio).

```ts
import { Bot } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'
import { aiPlugin } from '@botmesh/ai'

const bot = new Bot({ provider: new BaileysProvider({ session: 'mi-bot' }), lang: 'es' })

// Persona acotada al negocio (ver "Política de IA de WhatsApp" abajo).
const persona = [
  'Eres el asistente de atención al cliente de Panadería La Espiga.',
  'Solo respondes sobre sus productos, precios, horarios (lun-sáb 7:00-20:00), pedidos y encargos.',
  'Si te piden algo ajeno a la panadería, di con amabilidad que solo puedes ayudar con eso',
  'y ofrece pasar la conversación a una persona. Responde breve y en español; no inventes datos.',
].join(' ')

bot.plug(aiPlugin({
  provider: 'anthropic',
  apiKey: process.env.ANTHROPIC_API_KEY,
  persona,
}))

await bot.start()
```

Esto registra:

- Un autoresponder catch-all (`bot.onMessage`) que contesta cualquier mensaje
  de **texto** que ningún comando, trigger o conversación haya consumido.
  Guarda en el store del bot una ventana de historial por chat (20 mensajes por
  defecto, `context.maxMessages`).
- Un comando `/reset` que borra el historial de IA del chat y cancela su
  conversación activa (se desactiva con `resetCommand: false`).

Tus handlers siempre van primero: el autoresponder solo ve lo que sobra.
`lang: 'es'` hace que los textos que escribe el plugin (errores, confirmaciones)
salgan en español (ver [Idioma de las respuestas
integradas](#idioma-de-las-respuestas-integradas)).

## Política de IA de WhatsApp (desde el 15-01-2026)

::: warning Los asistentes de IA de propósito general no están permitidos en la WhatsApp Business Platform
Desde el **15 de enero de 2026**, los términos de Meta para la WhatsApp
Business Platform (sección *AI Providers*) **prohíben los asistentes de IA de
propósito general**: chatbots abiertos estilo ChatGPT cuya funcionalidad
principal es la propia IA. Sigue estando **permitido** usar IA **al servicio
del negocio** (atención al cliente, ventas, reservas, seguimiento de pedidos).
:::

Qué significa para `aiPlugin`:

- Escribe una `persona` **acotada a tu negocio** (qué vendes, horarios,
  políticas) que rechace con amabilidad lo que no tenga que ver con él, como
  en el [quickstart](#quickstart-autoresponder).
- Ofrece una salida hacia una persona ([handoff](/es/guide/handoff)) y no
  presentes el bot como un asistente "para todo".
- La regla viene de los términos de la Cloud API oficial (`@botmesh/meta`).
  Baileys es un cliente no oficial de WhatsApp Web y también está sujeto a los
  términos de WhatsApp.

Es una guía práctica, no asesoría legal: revisa los
[términos vigentes](https://www.whatsapp.com/legal/business-solution-terms)
antes de salir a producción.

## Elegir proveedor

| `provider` | Instalar | API key | Modelo por defecto | Notas |
|---|---|---|---|---|
| `anthropic` (por defecto) | `@anthropic-ai/sdk` | `apiKey` o `ANTHROPIC_API_KEY` | `claude-opus-5-5` | [Pensamiento](#pensamiento-anthropic) y `effort` |
| `openai` | `openai` | `apiKey` o `OPENAI_API_KEY` | ninguno: fija `model` | También Azure OpenAI y servidores compatibles con OpenAI (`baseUrl`) |
| `gemini` | `@google/genai` | `apiKey`, `GEMINI_API_KEY` o `GOOGLE_API_KEY` | `gemini-3.8-flash` | Vertex AI vía `instance` |
| `ollama` | nada (`fetch` directo) | ninguna (local); `apiKey` para la API en la nube o un proxy con autenticación | ninguno: fija `model` | Servidor local o modelos en la nube de Ollama |
| `deepseek`, `qwen`, `glm`, `kimi`, `groq`, `openrouter`, `mistral`, `grok`, `together` | `openai` | la variable de cada preset ([tabla](#presets)) | según preset | Endpoints compatibles con OpenAI |

Todos los proveedores admiten herramientas (en Ollama y los presets, si el
modelo las admite) y streaming.

::: info Los modelos por defecto no entran en semver
Cada proveedor retira modelos a su ritmo, así que los modelos por defecto siguen a
los actuales y pueden cambiar en una versión menor. Fija `model` si la elección te
importa (coste, latencia, estilo de respuesta).
:::

### Anthropic (por defecto)

```ts
bot.plug(aiPlugin({
  provider: 'anthropic',                     // opcional, es el de por defecto
  apiKey: process.env.ANTHROPIC_API_KEY,     // o deja que el SDK lea ANTHROPIC_API_KEY
  model: 'claude-sonnet-5-5',                // por defecto: claude-opus-5-5
}))
```

`baseUrl` apunta el SDK a un gateway o proxy. Para chats de alto volumen, un
modelo más pequeño (`claude-sonnet-5-5`, `claude-haiku-5-5`) es más barato y
rápido.

### OpenAI

```ts
bot.plug(aiPlugin({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-5.1',   // obligatorio: OpenAI no trae modelo por defecto
}))
```

`baseUrl` apunta a cualquier servidor compatible con OpenAI (vLLM, LM Studio,
un gateway) o a Azure OpenAI. El tope de tokens de salida se envía como
`max_completion_tokens` a OpenAI y a Azure OpenAI (`api.openai.com`,
`*.openai.azure.com`, `*.cognitiveservices.azure.com` o
`*.services.ai.azure.com` bajo `/openai`), y como `max_tokens` a cualquier otro
`baseUrl`, que es lo que esos servidores esperan. `maxTokensField` fuerza la
elección, por ejemplo para un proxy delante de OpenAI:

```ts
aiPlugin({ provider: 'openai', baseUrl: 'https://mi-proxy.example/v1', model: 'gpt-5.1', maxTokensField: 'max_completion_tokens' })
```

### Gemini

Instala `@google/genai`. Google declaró obsoleto el SDK anterior,
`@google/generative-ai`; se sigue usando si falta `@google/genai`, con un
`DeprecationWarning` la primera vez. `baseUrl` pasa a ser el
`httpOptions.baseUrl` del SDK.

```ts
bot.plug(aiPlugin({
  provider: 'gemini',
  apiKey: process.env.GEMINI_API_KEY,  // o define GEMINI_API_KEY / GOOGLE_API_KEY y omítela
  // model: 'gemini-3.8-flash',        // por defecto
}))
```

Para Vertex AI, o cualquier opción del cliente que `aiPlugin` no expone, crea
el proveedor tú mismo y pásalo como `instance`:

```ts
import { GoogleGenAI } from '@google/genai'
import { GeminiProvider, aiPlugin, fromGoogleGenAI } from '@botmesh/ai'

const ai = new GoogleGenAI({ vertexai: true, project: 'mi-proyecto', location: 'global' })
bot.plug(aiPlugin({ instance: new GeminiProvider(fromGoogleGenAI(ai), { model: 'gemini-3.8-flash' }) }))
```

### Ollama (local o en la nube)

[Ollama](https://ollama.com) ejecuta modelos abiertos en tu propia máquina. Sin
SDK y sin API key: el plugin habla con su API HTTP mediante `fetch`.

```bash
ollama pull llama3.1      # una vez
ollama serve              # si la app de escritorio no lo tiene ya en marcha
```

```ts
bot.plug(aiPlugin({
  provider: 'ollama',
  model: 'llama3.1',                   // obligatorio: Ollama no trae modelo por defecto
  // baseUrl: 'http://localhost:11434', // por defecto; cámbialo si el servidor está en otro host
}))
```

- **Las herramientas** necesitan un modelo entrenado para ellas (Llama 3.1+,
  Qwen 3, Mistral y los demás marcados *tools* en la biblioteca de Ollama).
- **Sin tope de salida por defecto**: `maxTokens` se envía como
  `options.num_predict` solo si lo fijas, para que un modelo que piensa no se
  corte a mitad del razonamiento.
- **Modelos en la nube a través de tu Ollama local**: inicia sesión una vez
  (`ollama signin`) y usa el nombre de un modelo en la nube (los que terminan
  en `-cloud`, como `gpt-oss:120b-cloud`) con la misma configuración. Ollama
  reenvía la petición a su nube; tu bot sigue hablando con `localhost`.
- **La API en la nube de Ollama directamente** (sin servidor local), o un
  Ollama detrás de un proxy con autenticación: pon `apiKey` y se envía como
  `Authorization: Bearer <clave>` (nunca va al log ni a un mensaje de error):

  ```ts
  bot.plug(aiPlugin({
    provider: 'ollama',
    baseUrl: 'https://ollama.com',
    model: 'gpt-oss:120b',
    apiKey: process.env.OLLAMA_API_KEY,
    persona,
  }))
  ```

### Presets

DeepSeek, Qwen, GLM, Kimi, Groq, OpenRouter, Mistral, Grok y Together son
compatibles con OpenAI: el plugin los alcanza con el SDK `openai` y su propia
URL base, así que `openai` es el único paquete que hay que instalar. Cada
preset trae un modelo por defecto y lee su clave de su variable de entorno
habitual:

```ts
bot.plug(aiPlugin({ provider: 'deepseek' }))  // DEEPSEEK_API_KEY, modelo deepseek-chat
bot.plug(aiPlugin({ provider: 'groq', model: 'llama-3.3-70b-versatile' }))
```

| Preset | Variable de entorno | Modelo por defecto |
|---|---|---|
| `deepseek` | `DEEPSEEK_API_KEY` | `deepseek-chat` |
| `qwen` | `DASHSCOPE_API_KEY` | `qwen-plus` |
| `glm` | `ZHIPUAI_API_KEY` | `glm-5.3` |
| `kimi` | `MOONSHOT_API_KEY` | `moonshot-v1-8k` |
| `groq` | `GROQ_API_KEY` | `llama-3.3-70b-versatile` |
| `openrouter` | `OPENROUTER_API_KEY` | `openrouter/auto` |
| `mistral` | `MISTRAL_API_KEY` | `mistral-small-latest` |
| `grok` | `XAI_API_KEY` | `grok-4.7` |
| `together` | `TOGETHER_API_KEY` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` |

`apiKey`, `model` y `baseUrl` sobrescriben los valores del preset.

### Versiones de SDK soportadas

Los SDK son dependencias peer opcionales; instala solo el que necesite tu
proveedor.

| SDK | Versiones aceptadas | Probadas |
|---|---|---|
| `@anthropic-ai/sdk` | `^0.68.0 \|\| ^1.0.0` | 0.68.0 y 1.x |
| `openai` | `^6.48.0 \|\| ^7.0.0` | 6.48.0 y 7.x |
| `@google/genai` | `^2.0.0` | 2.0.0 y 2.x |
| `@google/generative-ai` (obsoleto) | `^0.21.0` a `^0.24.0` | 0.24 |

Los tests usan cada SDK en los dos extremos de su rango contra una imitación local
de la API HTTP: respuestas simples, llamadas a herramientas con su resultado y
streaming.

## Usar la IA desde tu código: `ctx.tools.ai`

El plugin también hace `bot.provide('ai', client)`, así que `ctx.tools.ai`
está disponible en cualquier handler, flow o conversación. Desactiva el
autoresponder (`autoReply: false`) si solo quieres esto:

```ts
bot.plug(aiPlugin({
  provider: 'anthropic',
  apiKey: process.env.ANTHROPIC_API_KEY,
  autoReply: false,
}))

bot.conversation('reclamo', async (c, ctx) => {
  await ctx.reply('📝 Cuéntanos qué pasó con tu pedido:')
  const texto = await c.waitText()
  const resumen = await ctx.tools.ai.ask(
    `Resume en 3 líneas este reclamo de un cliente para el equipo de soporte: ${texto}`,
  )
  await ctx.reply(`✅ Registramos tu reclamo:\n${resumen}`)
})
```

`ctx.tools.ai` es un `AIClient`:

| Método | Qué hace |
|---|---|
| `ask(prompt, opts?)` | Pregunta suelta, **sin** historial del chat. Usa la `persona`, `model`, `maxTokens`, `effort` y [herramientas](/es/guide/ai-herramientas) del plugin. Resuelve con el texto. |
| `replyInChat(chatKey, text, opts?)` | Responde dentro del historial de un chat (lo lee y guarda el turno), como el autoresponder. Usa `chatKeyOf(ctx)` como clave; `opts` acepta `{ userId, isGroup }` para la [memoria](/es/guide/ai-memoria-rag) y `{ ctx, confirm, signal }` para las herramientas. |
| `replyInChatDetailed(chatKey, text, opts?)` | Igual, y además devuelve las citas y los hechos que usó el turno. |
| `streamReplyInChat(chatKey, text, opts?)` | El gemelo en streaming de `replyInChat`, para pasárselo a [`ctx.stream()`](/es/guide/streaming). |
| `runTools(input, opts?)` | Ejecuta el [bucle de herramientas](/es/guide/ai-herramientas) y devuelve su resultado completo. |
| `generate({ messages, system?, model?, maxTokens?, effort?, signal? })` | Control total: mensajes explícitos y overrides por llamada. Resuelve con `{ text, model, stopReason?, usage? }`. |
| `stream(input)` | Como `generate`, como un `AsyncIterable<string>` de fragmentos de texto. |
| `memory()`, `memoryFacts()`, `remember()`, `forget()`, `extractMemory()`, `idle()` | La API de [memoria a largo plazo](/es/guide/ai-memoria-rag#leer-y-escribir-la-memoria). |
| `clearToolHistory(chatKey)` | Olvida las [ejecuciones de herramientas con efectos](/es/guide/ai-herramientas#efectos-secundarios-repetidos) recordadas para un chat. |

**Tipado (TypeScript).** Importar `@botmesh/ai` amplía la interfaz
`DefaultTools` del core, así que `ctx.tools.ai` (y `bot.injectTools.ai` fuera
de los handlers) es un `AIClient` sin casts. El tipo no comprueba que el plugin
esté instalado: sin `bot.plug(aiPlugin(...))`, o después de desenchufarlo,
`ctx.tools.ai` es `undefined` en tiempo de ejecución.

## Pensamiento (Anthropic)

Los modelos Claude piensan antes de responder. `@botmesh/ai` elige la petición
adecuada para el modelo que configures (`thinking: 'auto'`, el valor por defecto):

| Modelo | Qué se envía |
|---|---|
| Claude Opus / Sonnet 4.6 o posteriores, Haiku 5 o posteriores, Fable, Mythos, ids desconocidos | `thinking: { type: 'adaptive' }` (+ `effort` si lo fijas) |
| Claude Haiku 4.5, Sonnet 4.5, Opus 4.5 y anteriores | sin `thinking` (y sin `effort`, salvo en Opus 4.5) |

```ts
aiPlugin({ provider: 'anthropic', model: 'claude-haiku-4-5', thinking: { budgetTokens: 2048 } })
```

- `'adaptive'` envía siempre pensamiento adaptativo; `'off'` no envía nunca el
  parámetro (los modelos que siempre piensan, como Claude Opus 5.5, lo siguen
  haciendo: baja `effort` en su lugar).
- `{ budgetTokens }` (un entero positivo; cualquier otro valor lanza un
  `RangeError` al construir la configuración) activa el pensamiento con
  presupuesto (`budget_tokens`, elevado al mínimo de 1024) en los modelos sin
  pensamiento adaptativo (Haiku 4.5, Sonnet 4.5, Opus 4.5 y anteriores). Los
  modelos adaptativos reciben pensamiento adaptativo: Opus / Sonnet 4.6 aún
  aceptan presupuestos pero los marcan como obsoletos, y Opus 4.7+, Sonnet 5+,
  Haiku 5+, Fable y Mythos los rechazan. Si `maxTokens` no deja sitio para la
  respuesta, pasa a ser `budgetTokens + maxTokens`.
- Si aun así la API rechaza la petición con un 400 que menciona `thinking` (o
  `effort`), la llamada se reintenta una vez sin ese parámetro y el modelo
  queda recordado, así que las siguientes llamadas ya no lo envían.
  `anthropicModelSupport(model)` expone las reglas.

## Herramientas, memoria, RAG y streaming

Cada uno tiene su guía; así se ven en la configuración del plugin.

**[Herramientas](/es/guide/ai-herramientas)**: el modelo llama a tus funciones
(buscar en el catálogo, registrar un pedido), con validación de argumentos,
timeouts, confirmación humana para las herramientas `confirm: true` y eventos
de auditoría.

```ts
bot.plug(aiPlugin({
  provider: 'openai',
  model: 'gpt-5-mini',
  tools: {
    buscar_producto: {
      description: 'Busca productos del catálogo por texto',
      schema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
      handler: async ({ q }: { q: string }) => db.products.search(q),
    },
  },
}))
```

**[Memoria y RAG](/es/guide/ai-memoria-rag)**: `memory` recuerda hechos de cada
usuario entre conversaciones (se guardan en `ctx.user`); `rag` responde a
partir de tus documentos con citas numeradas, con cualquier retriever, como
`createRag()` del paquete experimental `@botmesh/rag`.

```ts
import { createRag } from '@botmesh/rag'

bot.plug(aiPlugin({
  provider: 'openai',
  model: 'gpt-5-mini',
  memory: { autoExtract: true, ttl: '90d' },
  rag: { retriever: createRag({ documents: ['./docs/faq.md'] }), appendSources: true },
}))
```

**[Streaming](/es/guide/streaming#con-botmesh-ai)**: `stream: true` envía la
respuesta del autoresponder mientras se genera: borradores nativos en
Telegram, ediciones en vivo en Discord y trozos por frases con
"escribiendo…" en WhatsApp. Los turnos con herramientas no se transmiten.

## Formato por canal

Los modelos escriben Markdown (`**negrita**`, `# título`, `[enlace](url)`,
`- elemento`), pero la mayoría de las apps de chat no lo muestran. El
autoresponder convierte cada respuesta (también en streaming) al formato del
chat, `ctx.textFormat`: el `textFormatFor(chatId)` del provider cuando sirve
varios canales y, si no, su `capabilities.textFormat`.

| `textFormat` | Providers | Resultado |
|---|---|---|
| `'whatsapp'` | `baileys`, `meta`, evolution, wppconnect, gupshup; chats `whatsapp:` de twilio; contactos de WhatsApp en highlevel | `*negrita*`, `_cursiva_`, `~tachado~`, viñetas `•`, títulos en negrita, enlaces como `texto (url)` |
| `'plain'` | `telegram` (se envía sin `parse_mode`), messenger, instagram, tiktok; chats SMS de twilio; contactos de SMS, Email, FB, IG, Live chat y GMB en highlevel | sin marcas |
| `'markdown'` | discord | sin cambios |
| sin declarar | el resto (email) | sin cambios |

Nunca se tocan los bloques ni los spans de código, ni las palabras con
`snake_case` o un `2 * 3`. El historial guarda el texto original del modelo.
`format: 'whatsapp'` (o cualquier formato) fija uno; `format: false` envía el
texto tal cual. `formatMarkdown(text, format)` y
`formatMarkdownStream(source, format)` se exportan para tus propios handlers.
Con `'html'` solo las URLs `http(s)`, `mailto:` y `tel:` se convierten en enlaces
`<a href>`: cualquier otra (un enlace `javascript:` que podría colar una
inyección de prompt) queda como texto.

## Notas de voz

El autoresponder solo contesta mensajes de texto. Con el plugin experimental
[`@botmesh/voice`](/es/guide/voz), las notas de voz se transcriben antes de
enrutarse (usa `autoTranscribe: { asText: true }` para que la IA las
conteste) y `autoReplyWithVoice` puede devolver la respuesta como audio.

## Idioma de las respuestas integradas

Los textos que el plugin escribe por ti (las respuestas de error y de rechazo,
la pregunta de confirmación de herramientas y sus botones Sí/No, la línea de
fuentes) siguen el idioma del chat, `ctx.lang`. Vienen en inglés y en español;
el inglés es el de por defecto. Un bot solo en español fija `lang: 'es'` en el
`Bot`:

```ts
import { Bot } from '@botmesh/core'

const bot = new Bot({ provider, lang: 'es' })
```

Cambia cualquier texto con `bot.locale()` bajo las claves `ai.` (`ai.error`,
`ai.refusal`, `ai.tools.confirm`…, listadas en `AI_MESSAGES`), o fija
`errorMessage`, `refusalMessage` y `maxStepsMessage` en el plugin. Ver
[i18n](/es/guide/i18n).

## `/reset` y `slashCommandsPlugin`

`aiPlugin` registra su propio `/reset`: limpia el contexto de IA del chat
**y** cancela la conversación activa. El registro de comandos es "último
`plug()` gana", así que si también usas `slashCommandsPlugin` (que trae su
propio `/reset` para cancelar conversaciones), **instala `aiPlugin` después**
para que su `/reset` prevalezca:

```ts
bot.plug(slashCommandsPlugin, { greeting: '🤖 ¡Hola!' })
bot.plug(aiPlugin({ apiKey: process.env.ANTHROPIC_API_KEY })) // su /reset gana
```

## Coste y latencia

Cada turno del autoresponder es una llamada de pago al modelo (más, con
herramientas). Para gastar y esperar menos:

- **Responde lo obvio sin IA.** Los comandos, los triggers de `bot.when()` y
  los flows van antes que el autoresponder; las preguntas frecuentes, menús y
  saludos que resuelvas ahí nunca llegan al modelo.
- **Elige el modelo según la tarea.** Para atención al cliente suele bastar un
  modelo pequeño; dale a la extracción de memoria en segundo plano uno más
  barato (`memory: { autoExtract: { model: '...' } }`).
- **Limita la salida.** `maxTokens` acota cada respuesta (incluye los tokens de
  pensamiento de los modelos de razonamiento); en Anthropic, `effort: 'low'`
  piensa menos.
- **Envía menos historial.** Cada turno reenvía la ventana del chat: baja
  `context.maxMessages` para intercambios cortos. Con RAG, menos pasajes y más
  pequeños (`topK`, `chunkSize`) acortan el prompt.
- **Acota el bucle de herramientas.** Cada paso es una llamada al modelo:
  mantén `maxSteps` bajo y describe bien las herramientas para que el modelo
  acierte a la primera.
- **No hables de más en grupos.** `groupMode: 'mentions'` en el `Bot` hace que
  solo responda en grupos cuando lo mencionan.
- **Que se sienta más rápido.** `stream: true` muestra la respuesta mientras
  se escribe; `humanizeTyping` (activo por defecto) muestra "escribiendo…"
  mientras tanto.
- **Protege tu cuota.** El [rate limiting](/es/guide/rate-limiting) limita
  cuántos mensajes puede colar un chat, y `timeoutMs` acota cada llamada.
- **Mide.** Con [trazas](/es/guide/trazas#spans-de-ia), cada llamada al modelo
  es un span con su modelo y su consumo de tokens.

## Errores y solución de problemas

`aiPlugin` **nunca tumba el proceso** por un proveedor mal configurado (SDK sin
instalar, proveedor desconocido, API key ausente): `install` es síncrono y
resuelve el proveedor de forma perezosa. Al arrancar, un warmup registra el
problema como error, y desde ahí cada mensaje recibe la respuesta
`errorMessage` en lugar de una contestación.

Una configuración que nunca puede funcionar falla al construirla: `aiPlugin()`
lanza un `RangeError` / `TypeError` que nombra la opción ante un timeout que no
es un número finito de ms (un `NaN` de `Number(process.env.X)` saltaría a 1 ms),
un `maxTokens` que no es un entero positivo, un `context.maxMessages` negativo o
`NaN`, límites de `memory` inválidos, un `toolConfirm.timeout` que no se puede
leer o una herramienta sin `handler`.

`bot.stop()` aborta todas las llamadas al modelo en curso: las respuestas
automáticas, la extracción de memoria en segundo plano y las llamadas que hacen
tus handlers con `ctx.tools.ai`, que rechazan con un `AbortError`. Un proveedor
lento nunca mantiene vivo el proceso. Una llamada que supera `timeoutMs`
rechaza con `AITimeoutError`.

| Lo que ves | Por qué | Solución |
|---|---|---|
| Log de error `ai provider failed to resolve`: `This AI provider needs the package "openai", which is not installed` | Falta el SDK del proveedor | Ejecuta el `pnpm add` que indica el mensaje |
| Aviso al instalar: `ai provider "openai" has no default model` | `openai` u `ollama` sin `model` | Fija `model` |
| Todos los mensajes reciben "⚠️ Ahora no puedo responder, intenta luego." (o su versión en inglés) | Falló la llamada al proveedor (clave errónea, cuota, red, timeout) | Busca `ai autoreply failed` en el log: lleva el error del proveedor |
| `Ollama answered HTTP 404` | El modelo no está descargado | `ollama pull <modelo>` |
| `fetch failed` / `ECONNREFUSED` con Ollama | No hay servidor Ollama en `baseUrl` | Arráncalo (`ollama serve`) o corrige `baseUrl` |
| Aviso `ai autoreply: the model returned an empty answer` o `ai tool call cut off by the output token limit` | La respuesta agotó `maxTokens` (a menudo pensando) | Sube `maxTokens` o baja `effort` |
| El bot ignora imágenes, audios o stickers | El autoresponder solo contesta texto | Manéjalos con `bot.when(IMAGE, ...)`, o transcribe la voz con [`@botmesh/voice`](/es/guide/voz) |
| El bot no contesta un mensaje | Lo consumió otro handler, comando o conversación, o `groupMode` filtró un mensaje de grupo | Es lo esperado: el autoresponder es el último catch-all |
| `/reset` cancela el flow pero la IA conserva su historial | `slashCommandsPlugin` se enchufó después de `aiPlugin` | Enchufa `aiPlugin` el último |

## Config completa de `aiPlugin(config)`

| Campo | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `provider` | `'anthropic' \| 'openai' \| 'ollama' \| 'gemini' \| 'deepseek' \| 'qwen' \| 'glm' \| 'kimi' \| 'groq' \| 'openrouter' \| 'mistral' \| 'grok' \| 'together'` | `'anthropic'` | Proveedor a resolver. |
| `model` | `string` | según proveedor | Modelo a usar (obligatorio en `openai` y `ollama`). |
| `apiKey` | `string` | variable de entorno | API key. Si se omite, cada proveedor lee su variable de entorno habitual. Con `ollama` (sin variable de entorno) se envía como `Authorization: Bearer` solo si la pasas. |
| `baseUrl` | `string` | según proveedor | Override del endpoint (`baseURL` del SDK en anthropic/openai/presets, `httpOptions.baseUrl` en gemini, el host de Ollama). |
| `instance` | `AIProvider` | — | Proveedor ya construido (`MockAIProvider` en tests, un `GeminiProvider` para Vertex AI, el tuyo): se salta la resolución de `provider`/`apiKey`/`model` y la carga del SDK. |
| `persona` | `string` | — | System prompt. |
| `maxTokens` | `number` | `4096` (anthropic), `1024` (openai, presets, gemini), ninguno (ollama) | Límite de tokens de salida; en modelos de razonamiento incluye los de pensamiento. Ollama lo recibe como `options.num_predict`, solo si lo fijas. |
| `effort` | `'low' \| 'medium' \| 'high' \| 'xhigh' \| 'max'` | — | Esfuerzo de razonamiento (solo Anthropic; no se envía a modelos que lo rechazan, como Claude Haiku 4.5 / Sonnet 4.5). |
| `thinking` | `'auto' \| 'adaptive' \| 'off' \| { budgetTokens }` | `'auto'` | Pensamiento extendido de Anthropic, ver [Pensamiento](#pensamiento-anthropic). |
| `timeoutMs` | `number` | `60000` | Timeout de cada llamada al modelo. Sin streaming, plazo total: la petición se aborta y rechaza con `AITimeoutError`, para que un proveedor colgado no bloquee la cola del chat. Con streaming, timeout de inactividad que se reinicia con cada fragmento, así que una respuesta larga nunca se corta. `0` lo desactiva (no recomendado). |
| `maxTokensField` | `'max_tokens' \| 'max_completion_tokens'` | según `baseUrl` | Proveedores compatibles con OpenAI: el campo del tope de tokens de salida (ver [OpenAI](#openai)). |
| `context.maxMessages` | `number` | `20` | Ventana de historial guardada por chat (siempre empieza por un turno del usuario; las respuestas vacías no se guardan). |
| `autoReply` | `boolean` | `true` | Registra el autoresponder catch-all. |
| `resetCommand` | `boolean` | `true` | Registra `/reset`. |
| `errorMessage` | `string` | `ai.error` (es: `'⚠️ Ahora no puedo responder, intenta luego.'`) | Respuesta si el proveedor falla o el modelo no responde nada. |
| `refusalMessage` | `string` | `ai.refusal` (es: `'No puedo ayudar con eso.'`) | Respuesta cuando el proveedor rehúsa (`stopReason === 'refusal'`: rechazo de Anthropic, `refusal` de OpenAI, bloqueo de seguridad de Gemini). |
| `humanizeTyping` | `boolean` | `true` | Muestra "escribiendo…" (`ctx.typing()`) mientras se genera la respuesta; la respuesta se salta entonces el `BotConfig.typing`, así que el indicador sale una sola vez. |
| `tools` | `Record<string, AITool>` | — | Funciones que el modelo puede llamar (ver [Herramientas de IA](/es/guide/ai-herramientas)). |
| `maxSteps` | `number` | `5` | Máximo de llamadas al modelo por turno en el bucle de herramientas. |
| `toolTimeoutMs` | `number` | `15000` | Timeout por defecto de cada herramienta (`0` lo desactiva). |
| `maxStepsMessage` | `string` | `ai.tools.maxSteps` (es: `'No pude completar la solicitud. Intenta de nuevo con más detalle.'`) | Respuesta cuando el bucle llega a `maxSteps`. |
| `toolConfirm` | `{ yes?, no?, timeout?, buttons?, answeredNotice?, expiredNotice?, systemNote? }` | `{ timeout: '2m', buttons: true }` | Diálogo de confirmación de las herramientas `confirm: true` (ver [Confirmación humana](/es/guide/ai-herramientas#confirmacion-humana)). |
| `onToolEvent` | `(event: AIToolEvent) => void` | — | Auditoría de cada evento del bucle (también se emite como `bot.on('ai.tool')`). |
| `format` | `'auto' \| 'whatsapp' \| 'markdown' \| 'html' \| 'plain' \| false` | `'auto'` | Convierte el Markdown del modelo al formato del canal (ver [Formato por canal](#formato-por-canal)). |
| `memory` | `boolean \| AIMemoryConfig` | — | Memoria a largo plazo por usuario (ver [Memoria y RAG](/es/guide/ai-memoria-rag)). |
| `rag` | `AIRetriever \| AIRagConfig` | — | Respuestas basadas en tus documentos (ver [Memoria y RAG](/es/guide/ai-memoria-rag#rag)). |
| `stream` | `boolean \| AIStreamConfig` | apagado | Transmite el autoresponder con `ctx.stream()` (ver [Streaming](/es/guide/streaming#con-botmesh-ai)). |

Los textos por defecto son los ingleses; un chat en español recibe los
integrados en español (ver [Idioma de las respuestas
integradas](#idioma-de-las-respuestas-integradas)).

## Testing

`MockAIProvider` (de `@botmesh/ai/testing`) implementa `AIProvider` con
respuestas fijas o programables y sin red. Enchúfalo al plugin real con
`instance`:

```ts
import { aiPlugin } from '@botmesh/ai'
import { MockAIProvider } from '@botmesh/ai/testing'
import { createTestBot } from '@botmesh/core/testing'

const { bot, chat } = await createTestBot()
bot.plug(aiPlugin({ instance: new MockAIProvider({ reply: 'Abrimos a las 7.' }) }))

await chat.send('¿a qué hora abren?')
await chat.expectReply('Abrimos a las 7.')
```

Sin bot, `AIClient` recibe el proveedor y un `ContextManager` sobre cualquier
`ConvStore` (el store del bot es uno):

```ts
import { AIClient, ContextManager, type ConvStore, type AIMessage } from '@botmesh/ai'
import { MockAIProvider } from '@botmesh/ai/testing'

const memory = new Map<string, AIMessage[]>()
const store: ConvStore = {
  async getConversation(k) { return memory.get(k) },
  async setConversation(k, m) { memory.set(k, m) },
  async clearConversation(k) { memory.delete(k) },
}

const client = new AIClient(new MockAIProvider({ reply: 'respuesta simulada' }), new ContextManager(store))

const respuesta = await client.ask('¿qué hora es?')
// respuesta === 'respuesta simulada'
```

`reply` también puede ser una función de la petición que devuelva
`{ toolCalls }` para simular llamadas a herramientas (ver
[Testing en la guía de herramientas](/es/guide/ai-herramientas#testing)), y
`mock.calls` registra cada petición que envió el cliente.

El paquete tiene tres entradas:

| Entrada | Contenido | Semver |
|---|---|---|
| `@botmesh/ai` | `aiPlugin`, `AIClient`, los proveedores, herramientas, tipos de memoria y RAG, `formatMarkdown` | sí |
| `@botmesh/ai/testing` | `MockAIProvider` y `validateArgs` (comprueba los argumentos de una herramienta contra su esquema, como el bucle de herramientas) | sí |
| `@botmesh/ai/internal` | Los helpers del plugin y los nombres de los tipos de los SDK | no |

Un `AIProvider` propio que haga streaming debe respetar `GenerateInput.onStreamEnd`:
llamarlo una vez, tras el último fragmento, solo si el stream termina con
normalidad (no ante un error, un aborto o un `break` temprano), con un
`AIStreamEndInfo` (`stopReason`, `usage` si se conoce). Comprueba
`signal.aborted` antes de llamarlo: si no, un cliente que ignora la señal
terminaría "con normalidad" tras un aborto.

## Limitaciones

- El historial es una ventana fija de mensajes (`context.maxMessages`); los
  turnos antiguos se descartan, no se resumen.
- Una persona por plugin: un bot que necesite varias las elige en sus propios
  handlers con `ctx.tools.ai.generate({ system, messages })`.
- El autoresponder solo contesta texto (ver [Notas de voz](#notas-de-voz)).

## Siguientes pasos

- [Herramientas de IA](/es/guide/ai-herramientas) — deja que el modelo llame a funciones de tu bot
- [Memoria y RAG](/es/guide/ai-memoria-rag) — hechos por usuario y respuestas con tus documentos
- [Respuestas en streaming](/es/guide/streaming) — `ctx.stream()` por canal
- [Voz](/es/guide/voz) — transcribe notas de voz y responde con audio
- [Handoff](/es/guide/handoff) — pasa el chat a una persona
- [Plugins](/es/guide/plugins) — cómo funciona `bot.plug()` en general
