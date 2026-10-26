# Soporte con IA y escalado a humano

Un asistente de un proveedor de internet que resuelve lo que puede y, cuando no debe seguir, pasa el chat a una persona con un resumen escrito para el agente.

**Nivel:** Avanzado · **Etiquetas:** IA, Herramientas, Handoff, WhatsApp, Telegram

**Funcionalidades:** [herramientas de IA (tool calling)](/es/guide/ai-herramientas) ·
[handoff humano (`ctx.handoff`, `bot.resume`)](/es/guide/handoff#handoff-humano) ·
[comandos de escape durante el handoff](/es/guide/handoff#que-pasa-mientras-el-chat-esta-en-handoff) ·
[eventos `'message'` y `'handoff'`](/es/guide/handoff#handoff-humano) ·
[enviar a otro chat (`bot.send`)](/es/guide/handoff#handoff-humano) ·
[validación de argumentos con `enum`](/es/guide/ai-herramientas#esquemas)

## Requisitos

- Node.js 22.12 o superior.
- Una API key de Anthropic en la variable de entorno `ANTHROPIC_API_KEY` (u
  otro modelo con tool calling, ver [más abajo](#otros-proveedores-de-modelos)).
- `AGENTS_CHAT_ID`, el chat donde tus agentes reciben los resúmenes (por
  ejemplo el id de un grupo de WhatsApp). Es obligatoria en WhatsApp y
  Telegram; el simulador usa un chat llamado `agentes`.

```bash
npm install @botmesh/core @botmesh/ai @anthropic-ai/sdk @botmesh/baileys
```

Mientras los paquetes estén en prerelease, añade el dist-tag que indica
[Inicio rápido](/es/guide/inicio#requisitos).

## El bot

```js
// bot.js
import { Bot, defineBot, isMainModule } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'
import { aiPlugin } from '@botmesh/ai'

// Donde los agentes reciben los resúmenes: un grupo o el chat de un agente ('agentes' en el simulador).
const AGENTS_CHAT = process.env.AGENTS_CHAT_ID ?? 'agentes'

const PERSONA = [
  'Eres el asistente de soporte de Skyline Internet, un proveedor de internet para hogares.',
  'Ayuda con problemas de conexión, planes y facturas, en mensajes cortos.',
  'Llama a escalar_a_humano cuando el cliente pida una persona, esté molesto o necesite algo que no puedes hacer:',
  'reembolsos, cambios de contrato o visitas de un técnico. Nunca prometas reembolsos ni visitas por tu cuenta.',
].join(' ')

const createBot = defineBot((provider) => {
  // Mientras un chat está en handoff, solo el comando /bot sigue llegando al bot.
  const bot = new Bot({ provider, lang: 'es', handoff: { allowCommands: ['bot'] } })

  // Sin bloquear: un aviso que falla queda en el log, nunca frena el handoff ni tumba el bot.
  const avisarAgentes = (texto) =>
    bot.send(AGENTS_CHAT, texto).catch((err) => bot.logger.warn({ err }, 'no se pudo avisar a los agentes'))

  const tools = {
    escalar_a_humano: {
      description: 'Pasa el chat a un agente humano, con un resumen que el agente pueda usar sin leer el chat.',
      schema: {
        type: 'object',
        properties: {
          motivo: { type: 'string', enum: ['pide_persona', 'reembolso', 'tecnico', 'cliente_molesto', 'otro'] },
          resumen: { type: 'string', description: 'Dos o tres líneas: el problema, qué se probó y qué quiere el cliente.' },
        },
        required: ['motivo', 'resumen'],
        additionalProperties: false,
      },
      handler: async ({ motivo, resumen }, { ctx }) => {
        await ctx.handoff({ reason: motivo, meta: { resumen } }) // primero: el bot deja de responder en este chat
        await avisarAgentes(`🆘 Caso nuevo de ${ctx.from} (${motivo})\n${resumen}`)
        return { escalado: true }
      },
    },
  }

  bot.plug(aiPlugin({
    provider: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-sonnet-5-5',
    persona: PERSONA,
    tools,
  }))

  // Un chat en handoff sigue emitiendo 'message': se reenvía a los agentes.
  bot.on('message', (ctx) => {
    if (bot.isHandedOff(ctx.from)) void avisarAgentes(`💬 ${ctx.from}: ${ctx.body}`)
  })

  // Devuelve el chat al bot. Tu bandeja de entrada puede llamar a bot.resume(chatId) al cerrar el caso.
  bot.command('bot', async (ctx) => {
    await bot.resume(ctx.from, { reason: 'vuelta al bot' })
    await ctx.reply('🤖 El asistente ha vuelto. ¿En qué te ayudo?')
  })

  return bot
})

export default createBot

// `node bot.js` conecta con WhatsApp; `npx botmesh dev bot.js` se salta este bloque.
if (isMainModule(import.meta)) {
  if (!process.env.AGENTS_CHAT_ID) throw new Error('Pon en AGENTS_CHAT_ID el chat donde tus agentes reciben los casos')
  const bot = await createBot(new BaileysProvider({ session: 'soporte-bot' }))
  bot.on('handoff', ({ chatId, reason }) => console.log(`👤 ${chatId} pasó a una persona (${reason})`))
  await bot.start()
}
```

## Cómo funciona

- **El modelo decide cuándo escalar.** `escalar_a_humano` es una herramienta
  normal: la persona dice cuándo llamarla, y el `enum` limita `motivo` a un
  conjunto cerrado por el que puedes enrutar (colas, prioridades).
- **El resumen es un argumento de la herramienta.** El modelo lo escribe al
  decidir escalar, así el agente recibe "problema, qué se probó, qué quiere el
  cliente" sin una llamada extra al modelo.
- **Primero el handoff, después el aviso.** La herramienta llama a
  `ctx.handoff()` antes de avisar a los agentes, y `avisarAgentes()` captura
  sus propios errores: si no se puede llegar al chat de los agentes, el
  cliente pasa igualmente a una persona y el fallo va al log en vez de tumbar
  el proceso.
- **`ctx.handoff()` pausa el bot en ese chat.** Los mensajes se siguen
  guardando, los hooks corren y el evento `'message'` se emite (el ejemplo los
  reenvía a los agentes, empezando por el mensaje que provocó el escalado),
  pero ningún handler, flujo ni la IA responde. El estado sobrevive a los
  reinicios con un store persistente.
- **Recuperar el bot.** `handoff.allowCommands: ['bot']` deja pasar `/bot`
  durante el handoff; en producción tu bandeja de entrada llama a
  `bot.resume(chatId)` cuando el agente cierra el caso. Los agentes responden
  al cliente con `bot.send(chatId, texto)`.
- **Aquí no hay confirmación.** Escalar no tiene efectos para el cliente, así
  que la herramienta no lleva `confirm: true`; resérvalo para reembolsos o
  reservas.

## Pruébalo

```bash
npx botmesh dev bot.js --env-file .env   # .env tiene la línea ANTHROPIC_API_KEY=sk-ant-...
```

Una ejecución del código de arriba en el simulador de terminal, donde el chat
del cliente es `user`. El modelo sigue un guion en el test que ejecuta esta
página (`packages/ai/tests/docs-examples-ai.test.ts`); el handoff, el reenvío a
`agentes` y `/bot` son los reales. Las líneas `bot → agentes` son lo que recibe
el chat de los agentes.

```text
user › no tengo internet desde ayer
bot › ¡Lo siento! Desenchufa el router 30 segundos y vuelve a enchufarlo. ¿Se arregló?
user › ya lo hice dos veces. Quiero un técnico y un reembolso
bot → agentes › 🆘 Caso nuevo de user (tecnico)
                Sin internet desde ayer; reinició el router dos veces sin cambios. Pide la visita de un técnico y un reembolso por los días sin servicio.
bot › He pasado tu caso a nuestro equipo: una persona te escribirá por aquí en breve.
bot → agentes › 💬 user: ya lo hice dos veces. Quiero un técnico y un reembolso
user › ¿hola?
bot → agentes › 💬 user: ¿hola?
user › /bot
bot › 🤖 El asistente ha vuelto. ¿En qué te ayudo?
```

## Otros proveedores de modelos

::: details Cambiar a OpenAI, Gemini o un modelo local de Ollama
El tool calling funciona con todos los proveedores; en Ollama elige un modelo
etiquetado como *tools*.

OpenAI (`npm install openai`, key en `OPENAI_API_KEY`):

```js
aiPlugin({ provider: 'openai', apiKey: process.env.OPENAI_API_KEY, model: 'gpt-5-mini', persona: PERSONA, tools })
```

Gemini (`npm install @google/genai`, key en `GEMINI_API_KEY`):

```js
aiPlugin({ provider: 'gemini', apiKey: process.env.GEMINI_API_KEY, model: 'gemini-3.8-flash', persona: PERSONA, tools })
```

Ollama en tu máquina (sin paquete ni key; antes ejecuta `ollama pull qwen3`):

```js
aiPlugin({ provider: 'ollama', model: 'qwen3', persona: PERSONA, tools })
```
:::

## Ejecutarlo en WhatsApp o Telegram

`node bot.js` muestra un código QR: escanéalo con WhatsApp (**Dispositivos
vinculados**) y pon en `AGENTS_CHAT_ID` el grupo donde están tus agentes. Para
Telegram, instala `@botmesh/telegram`, arranca la fábrica con
`new TelegramProvider({ token: process.env.TELEGRAM_TOKEN ?? '' })` y usa el id
numérico del grupo de agentes.

## Siguientes pasos

- [Handoff humano y listas de acceso](/es/guide/handoff): todo lo que hace la compuerta de handoff
- [Asistente de citas con IA](./ia-herramientas-citas): herramientas con confirmación y `dedupe`
- [Índice de ejemplos](./index)
