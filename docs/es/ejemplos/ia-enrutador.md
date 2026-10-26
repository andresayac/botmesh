# Enrutador con IA: intenciones a flujos, charla a la IA

Un bot de una compañía telefónica donde el modelo solo clasifica el texto libre: los pagos y el seguimiento de pedidos corren como flujos deterministas y el resto lo responde la IA.

**Nivel:** Avanzado · **Etiquetas:** IA, Flujos, Enrutado por intención, WhatsApp, Telegram

**Funcionalidades:** [`ctx.tools.ai.generate()`](/es/guide/ai#usar-la-ia-desde-tu-codigo-ctx-tools-ai) ·
[`replyInChat()` con historial del chat](/es/guide/ai#usar-la-ia-desde-tu-codigo-ctx-tools-ai) ·
[flujos con validación y menús](/es/guide/flujos) ·
[iniciar un flujo desde código (`bot.trigger`)](/es/guide/mensajes#iniciar-un-flujo-desde-codigo) ·
[handler catch-all](/es/guide/primer-bot#_6-catch-all) ·
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

## El bot

```js
// bot.js
import { Bot, defineBot, flow, isMainModule, slashCommandsPlugin } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'
import { aiPlugin, chatKeyOf } from '@botmesh/ai'

const INTENCIONES = ['pago', 'pedido', 'charla']
const CLASIFICADOR = [
  'Clasifica el mensaje que un cliente envió a Nimbus Móvil, una compañía telefónica, con una etiqueta:',
  'pago (quiere pagar una factura o pregunta cómo pagar),',
  'pedido (pregunta dónde está un pedido, un teléfono o el envío de una SIM),',
  'charla (cualquier otra cosa). Responde solo con la etiqueta.',
].join(' ')

// Una llamada al modelo pequeña y acotada. La etiqueta se comprueba en código: el modelo solo elige.
async function clasificar(ctx) {
  const { text } = await ctx.tools.ai.generate({
    system: CLASIFICADOR,
    messages: [{ role: 'user', content: ctx.body }],
    maxTokens: 100,
    effort: 'low',
  })
  const etiqueta = text.trim().toLowerCase().replace(/[^a-z]/g, '')
  return INTENCIONES.includes(etiqueta) ? etiqueta : 'charla'
}

// Sustituto de tu sistema de pedidos.
const rastrearPedido = (id) => `📦 El pedido ${id.toUpperCase()} salió de nuestro almacén y llega mañana.`

const createBot = defineBot((provider) => {
  const bot = new Bot({ provider, lang: 'es' })

  bot.plug(slashCommandsPlugin, {
    greeting: '📱 ¡Hola! Soy el asistente de Nimbus Móvil. Puedo cobrar una factura, seguir un pedido o resolver dudas.',
  })

  // Flujos deterministas. Escribir su nombre ("pago", "pedido") los inicia sin llamar a la IA.
  bot.use(
    flow('pago')
      .say('💳 *Pagar tu factura*')
      .ask('¿Cuál es tu número de cuenta? (6 dígitos)', 'cuenta', {
        validate: (body) => (/^\d{6}$/.test(body.trim()) ? true : '❌ El número de cuenta tiene 6 dígitos, inténtalo de nuevo'),
      })
      .choose('¿Cómo quieres pagar?', { tarjeta: 'Tarjeta', transferencia: 'Transferencia bancaria' }, 'metodo')
      .say((_ctx, c) => `✅ Te enviamos un enlace de ${c.state.metodo === 'tarjeta' ? 'pago con tarjeta' : 'transferencia bancaria'} para la cuenta ${c.state.cuenta}.`),
  )
  bot.use(
    flow('pedido')
      .ask('¿Cuál es tu número de pedido? (como N-1234)', 'id', {
        validate: (body) => (/^n-\d{4}$/i.test(body.trim()) ? true : '❌ Eso no parece un N-1234, inténtalo de nuevo'),
      })
      .say((_ctx, c) => rastrearPedido(c.state.id.trim())),
  )

  bot.plug(aiPlugin({
    provider: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-haiku-5-5',
    persona: 'Eres el asistente de Nimbus Móvil, una compañía telefónica. Responde breve y solo sobre Nimbus Móvil.',
    autoReply: false, // el enrutador de abajo decide quién responde
  }))

  // Texto libre: clasificar y después pasar a un flujo o dejar que responda la IA.
  bot.onMessage(async (ctx) => {
    const intencion = await clasificar(ctx)
    if (intencion === 'charla') {
      await ctx.reply(await ctx.tools.ai.replyInChat(chatKeyOf(ctx), ctx.body))
      return
    }
    await bot.trigger(intencion, { chatId: ctx.from, userId: ctx.sender, isGroup: ctx.isGroup })
  })

  return bot
})

export default createBot

// `node bot.js` conecta con WhatsApp; `npx botmesh dev bot.js` se salta este bloque.
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'enrutador-bot' }))
  bot.on('ready', () => console.log('✅ Conectado'))
  await bot.start()
}
```

## Cómo funciona

- **El modelo clasifica, tu código decide.** `clasificar()` pide una etiqueta
  con `ctx.tools.ai.generate()`, una llamada sin historial ni persona. La
  respuesta se limpia y se comprueba contra `INTENCIONES`; cualquier cosa
  inesperada cae en `charla`, así un modelo confundido nunca puede iniciar un
  flujo que no esté en la lista.
- **El dinero sigue siendo determinista.** El flujo de pago valida el número
  de cuenta, ofrece un menú fijo y arma la confirmación en código. El modelo
  nunca ve el número de cuenta ni decide el importe.
- **`bot.trigger()` inicia el flujo.** Se puede hacer `await` desde un handler
  del mismo chat: corre en el turno de ese mensaje. Después el flujo atiende
  los mensajes siguientes, igual que si el usuario hubiera escrito su nombre.
- **La charla guarda historial.** `replyInChat(chatKeyOf(ctx), text)` lee y
  guarda el historial de IA del chat y usa la persona del plugin. Con
  `autoReply: false` el plugin no añade su propio catch-all.
- **Coste.** Las palabras clave ("pago", "pedido") y los comandos slash se
  saltan el clasificador. La llamada del clasificador es corta
  (`maxTokens: 100`, `effort: 'low'`); `maxTokens` incluye los tokens de
  pensamiento de los modelos de razonamiento, así que no lo pongas demasiado
  bajo.

## Pruébalo

```bash
npx botmesh dev bot.js --env-file .env   # .env tiene la línea ANTHROPIC_API_KEY=sk-ant-...
```

Una ejecución del código de arriba en el simulador de terminal. El modelo (las
etiquetas del clasificador y la respuesta de charla) sigue un guion en el test
que ejecuta esta página (`packages/ai/tests/docs-examples-ai.test.ts`); los
flujos son los reales.

```text
user › hola, quiero pagar mi factura
bot › 💳 *Pagar tu factura*
bot › ¿Cuál es tu número de cuenta? (6 dígitos)
user › 12345
bot › ❌ El número de cuenta tiene 6 dígitos, inténtalo de nuevo
user › 123456
bot › ¿Cómo quieres pagar?

      1) Tarjeta
      2) Transferencia bancaria
user › 1
bot › ✅ Te enviamos un enlace de pago con tarjeta para la cuenta 123456.
user › ¿dónde está mi nueva tarjeta SIM?
bot › ¿Cuál es tu número de pedido? (como N-1234)
user › N-2041
bot › 📦 El pedido N-2041 salió de nuestro almacén y llega mañana.
user › ¡gracias, eres genial!
bot › ¡Con gusto! 😊 ¿Algo más sobre tu plan de Nimbus?
```

## Otros proveedores de modelos

::: details Cambiar a OpenAI, Gemini o un modelo local de Ollama
Cambia las opciones de `aiPlugin`; los proveedores distintos de Anthropic
ignoran `effort`.

OpenAI (`npm install openai`, key en `OPENAI_API_KEY`):

```js
aiPlugin({ provider: 'openai', apiKey: process.env.OPENAI_API_KEY, model: 'gpt-5-mini', autoReply: false })
```

Gemini (`npm install @google/genai`, key en `GEMINI_API_KEY`):

```js
aiPlugin({ provider: 'gemini', apiKey: process.env.GEMINI_API_KEY, model: 'gemini-3.8-flash', autoReply: false })
```

Ollama en tu máquina (sin paquete ni key; antes ejecuta `ollama pull llama3.1`):

```js
aiPlugin({ provider: 'ollama', model: 'llama3.1', autoReply: false })
```
:::

## Ejecutarlo en WhatsApp o Telegram

`node bot.js` muestra un código QR: escanéalo con WhatsApp (**Dispositivos
vinculados**). Para Telegram, instala `@botmesh/telegram` y arranca la fábrica
con `new TelegramProvider({ token: process.env.TELEGRAM_TOKEN ?? '' })`.

## Siguientes pasos

- [Flujos conversacionales](/es/guide/flujos): todos los pasos del DSL de flujos
- [IA con escalado a humano](./ia-escalado-humano): deja que el modelo pase el chat a una persona
- [Índice de ejemplos](./index)
