# Asistente de citas con IA y herramientas

Un asistente de barbería que reserva, lista y cancela citas llamando a tus funciones, y pide al cliente que confirme cada cambio antes.

**Nivel:** Intermedio · **Etiquetas:** IA, Herramientas, WhatsApp, Telegram

**Funcionalidades:** [herramientas de IA (tool calling)](/es/guide/ai-herramientas) ·
[confirmación humana (`confirm: true`)](/es/guide/ai-herramientas#confirmacion-humana) ·
[`confirmLines` con precios de tu código](/es/guide/ai-herramientas#valores-legibles-y-totales) ·
[`dedupe` de efectos repetidos](/es/guide/ai-herramientas#efectos-secundarios-repetidos) ·
[validación de argumentos con `enum`](/es/guide/ai-herramientas#esquemas) ·
[botones Sí/No](/es/guide/ai-herramientas#botones-si-no) ·
[eventos de auditoría](/es/guide/ai-herramientas#eventos-de-auditoria)

## Requisitos

- Node.js 22.12 o superior.
- Una API key de Anthropic en la variable de entorno `ANTHROPIC_API_KEY` (u
  otro modelo con tool calling, ver [más abajo](#otros-proveedores-de-modelos)).

```bash
npm install @botmesh/core @botmesh/ai @anthropic-ai/sdk @botmesh/baileys
```

## El bot

```js
// bot.js
import { Bot, defineBot, isMainModule, slashCommandsPlugin } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'
import { aiPlugin } from '@botmesh/ai'

// Catálogo y agenda. En producción, léelos de tu base de datos.
const SERVICIOS = {
  corte: { nombre: 'Corte de pelo', precio: 25 },
  barba: { nombre: 'Arreglo de barba', precio: 15 },
  tinte: { nombre: 'Tinte', precio: 60 },
}
const HORARIOS = ['lun 10:00', 'lun 15:00', 'mar 11:00', 'mié 17:30']

const citas = [] // en memoria para el ejemplo; en producción usa tu base de datos
const estaLibre = (horario) => !citas.some((c) => c.horario === horario && c.estado === 'reservada')
const citasDe = (chat) => citas.filter((c) => c.chat === chat && c.estado === 'reservada')
const vista = ({ id, servicio, horario }) => ({ id, servicio: SERVICIOS[servicio].nombre, horario, precio: SERVICIOS[servicio].precio })

// `enum` rechaza un servicio o una hora inventados antes de preguntar nada al cliente.
const RESERVA = {
  type: 'object',
  properties: {
    servicio: { type: 'string', enum: Object.keys(SERVICIOS) },
    horario: { type: 'string', enum: HORARIOS },
  },
  required: ['servicio', 'horario'],
  additionalProperties: false,
}

const tools = {
  // Las herramientas de solo lectura corren sin confirmación.
  consultar_disponibilidad: {
    description: 'Lista los servicios con su precio y los horarios libres.',
    handler: () => ({
      servicios: Object.entries(SERVICIOS).map(([clave, s]) => ({ clave, nombre: s.nombre, precio: s.precio })),
      libres: HORARIOS.filter(estaLibre),
    }),
  },
  mis_citas: {
    description: 'Lista las citas reservadas del cliente con su id.',
    handler: (_args, { ctx }) => citasDe(ctx?.from).map(vista),
  },
  // Herramientas con efectos: el cliente confirma antes.
  reservar_cita: {
    title: 'Reservar cita',
    description: 'Reserva un servicio en un horario libre.',
    schema: RESERVA,
    confirm: true,
    dedupe: 'args', // la misma reserva nunca se hace dos veces seguidas
    // La confirmación muestra lo que calcula TU código, nunca un precio escrito por el modelo.
    confirmLines: ({ servicio, horario }) => [`• ${SERVICIOS[servicio].nombre}, ${horario}`, `Precio: $${SERVICIOS[servicio].precio}`],
    handler: ({ servicio, horario }, { ctx }) => {
      if (!estaLibre(horario)) return { error: `${horario} ya está ocupado. Consulta consultar_disponibilidad.` }
      const cita = { id: `C-${citas.length + 1}`, chat: ctx?.from, servicio, horario, estado: 'reservada' }
      citas.push(cita)
      return vista(cita)
    },
  },
  cancelar_cita: {
    title: 'Cancelar cita',
    description: 'Cancela una cita reservada por su id (de mis_citas).',
    schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    confirm: true,
    confirmLines: ({ id }) => [`• Cita ${id}`],
    handler: ({ id }, { ctx }) => {
      const cita = citasDe(ctx?.from).find((c) => c.id === id)
      if (!cita) return { error: `No hay ninguna cita reservada ${id}. Consulta mis_citas.` }
      cita.estado = 'cancelada'
      return { id, estado: 'cancelada' }
    },
  },
}

const PERSONA = [
  'Eres el asistente de reservas de la barbería Fade & Co.',
  'Usa consultar_disponibilidad para servicios, precios y horarios libres: nunca los inventes.',
  'Reserva, lista y cancela citas solo con las herramientas. Responde en pocas palabras.',
].join(' ')

const createBot = defineBot((provider) => {
  const bot = new Bot({ provider, lang: 'es' })

  bot.plug(slashCommandsPlugin, {
    greeting: '💈 ¡Hola! Soy el asistente de reservas de Fade & Co. Pídeme una cita, tus reservas o una cancelación.',
  })

  bot.plug(aiPlugin({
    provider: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-sonnet-5-5',
    persona: PERSONA,
    tools,
    maxSteps: 4, // como mucho 4 llamadas al modelo por mensaje del cliente
  }))

  // Registro de auditoría: cada herramienta ejecutada (los argumentos pueden tener datos personales).
  bot.on('ai.tool', (e) => {
    if (e.type === 'tool.result') bot.logger.info({ tool: e.tool, ms: e.durationMs }, 'ai tool ran')
  })

  return bot
})

export default createBot

// `node bot.js` conecta con WhatsApp; `npx botmesh dev bot.js` se salta este bloque.
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'citas-bot' }))
  bot.on('ready', () => console.log('✅ Conectado'))
  await bot.start()
}
```

## Cómo funciona

- **Las herramientas son funciones normales.** Cada entrada de `tools` tiene
  una `description` que lee el modelo, un `schema` JSON opcional y un
  `handler`. El plugin ejecuta el bucle de herramientas: llama al modelo,
  ejecuta las herramientas que pide y le devuelve los resultados hasta que
  escribe la respuesta (`maxSteps` lo acota).
- **Confirmación antes de los efectos.** `confirm: true` hace que el plugin
  pregunte al cliente y ejecute la herramienta solo tras un "sí" claro. La
  pregunta se hace dentro de una conversación, así que el chat nunca queda
  bloqueado mientras espera. En canales con botones (Telegram, WhatsApp Cloud
  API, el simulador) muestra botones Sí/No; en WhatsApp con Baileys pide un
  sí/no escrito.
- **Tu código manda en los números.** `confirmLines` muestra el servicio y el
  precio de `SERVICIOS`, y el handler también los devuelve, así el modelo los
  repite en vez de calcularlos.
- **Sin reservas dobles.** `dedupe: 'args'` se salta una llamada con los
  mismos argumentos que una reserva hecha en los últimos 10 minutos; al modelo
  se le dice que ya estaba hecha. Un handler que devuelve `{ error }` no hizo
  nada y no se recuerda.
- **Cada alta tiene su listado y su cancelación.** Sin `mis_citas` y
  `cancelar_cita` un modelo "arregla" una reserva haciendo otra.
- **Auditoría.** Cada paso del bucle es un evento `'ai.tool'`; el ejemplo
  registra las ejecuciones en el log.

## Pruébalo

```bash
npx botmesh dev bot.js --env-file .env   # .env tiene la línea ANTHROPIC_API_KEY=sk-ant-...
```

Una ejecución del código de arriba en el simulador de terminal. El modelo
sigue un guion en el test que ejecuta esta página
(`packages/ai/tests/docs-examples-ai.test.ts`); las confirmaciones, los botones y
los resultados de las herramientas son los reales. En el simulador también
puedes responder una confirmación con `:click 1`. En el cuarto mensaje el modelo
pide otra vez la misma reserva: `dedupe` se la salta sin preguntar, y la
cancelación rechazada deja la cita como estaba.

```text
user › ¡hola! ¿me das un corte de pelo el lunes?
bot › ¡Claro! Un corte de pelo cuesta $25. El lunes tengo libres las 10:00 y las 15:00. ¿Cuál te va mejor?
user › a las 15:00, por favor
bot › Voy a: Reservar cita
      • Corte de pelo, lun 15:00
      Precio: $25
      ¿Confirmas?
        [1] Sí
        [2] No
      (:click <n> to choose)
user › sí
bot › ¡Listo! Tu corte quedó reservado para el lun 15:00 (cita C-1). ¡Te esperamos! 💈
user › sí, resérvame el corte a las 15:00
bot › Esa cita ya está reservada (C-1, lun 15:00), así que no la reservé dos veces.
user › mejor cancélala
bot › Voy a: Cancelar cita
      • Cita C-1
      ¿Confirmas?
        [1] Sí
        [2] No
      (:click <n> to choose)
user › no
bot › De acuerdo, mantengo tu cita del lun 15:00.
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
vinculados**). Para Telegram, instala `@botmesh/telegram` y arranca la fábrica
con `new TelegramProvider({ token: process.env.TELEGRAM_TOKEN ?? '' })`: la
confirmación usa entonces botones Sí/No en línea, que se quitan al responder.

## Siguientes pasos

- [Asistente de panadería con IA](https://github.com/andresayac/botmesh/tree/main/examples/bakery-ai): las mismas ideas para pedidos de comida (presupuestos, modificar y cancelar, pedidos por usuario), ejecutable en WhatsApp con Baileys o Twilio (en inglés)
- [Guía de herramientas de IA](/es/guide/ai-herramientas): esquemas, el bucle, confirmaciones y buenas prácticas
- [IA con escalado a humano](./ia-escalado-humano): una herramienta que pasa el chat a una persona
- [Índice de ejemplos](./index)
