# Ejemplos

Bots completos para copiar, ejecutar y adaptar. Casi todos los ejemplos son un único
archivo `bot.js` que muestra un conjunto de funciones de botmesh, con una
transcripción capturada de una ejecución real y enlaces a la guía de cada
función que usa. Un test ejecuta el código de cada ejemplo y comprueba su
transcripción, así que lo que lees es lo que obtienes.

## Ejecutar cualquier ejemplo

1. Prepara un proyecto una vez, como en
   [Inicio rápido](/es/guide/inicio#requisitos) (Node.js 22.12+,
   `"type": "module"`, `npm install @botmesh/core @botmesh/baileys`).
2. Guarda el código del ejemplo como `bot.js`.
3. Chatea con él en la terminal, sin teléfono:

   ```bash
   npx botmesh dev bot.js
   ```

4. Conéctalo de verdad con `node bot.js` (un QR para WhatsApp), o cambia el
   provider para [Telegram](/es/guide/inicio#o-conectar-telegram). El código
   del bot no cambia entre canales.

## Principiante

| Ejemplo | Nivel | Etiquetas | Funciones | Qué vas a construir |
| --- | --- | --- | --- | --- |
| [Bot de saludo](./bot-saludo) | Principiante | Comandos | `WELCOME`, triggers de texto y regex, `ctx.pass()`, comandos slash, catch-all | Un bot que da la bienvenida una vez, saluda, repite y lista sus comandos |
| [Bot de FAQ](./bot-faq) | Principiante | Triggers | Coincidencia normalizada, listas, `contains`, regex, precedencia | Respuestas por palabra clave a preguntas frecuentes, con fallback |
| [Enviar mensajes](./mensajes) | Principiante | Triggers | Formas de trigger, `ctx.quote()`, `ctx.react()`, datos del remitente | Todas las formas de responder a un texto |
| [Bot de menú](./bot-menu) | Principiante | Flujos, Botones | `flow().choose()`, sub-flujos `then`, `bot.conversation()`, botones por canal | El menú de una pizzería que funciona en todos los canales |
| [Bot de encuestas](./bot-encuesta) | Principiante | Encuestas, Reacciones | `ctx.poll()`, `bot.on('poll')`, `bot.send()`, `ctx.react()` | Encuestas nativas respondidas con el recuento en vivo |
| [Respuestas con media](./media) | Principiante | Media | Foto, archivo, video, voz, sticker, ubicación, contacto; `bot.onType()`, `loadMediaOf()` | Un bot que envía cada tipo de media y reacciona a imágenes |
| [Bot de recordatorios](./recordatorios) | Principiante | Scheduler | `bot.delay()`, `bot.schedule()` con zona horaria, `task.cancel()`, `bot.send()` | Recordatorios puntuales y un consejo diario a las 9:00 |
| [Flujo de registro](./flujo-registro) | Principiante | Flujos, Formularios | `.ask()` con `validate`, `.do()`, `c.state`, `.timeout()`, `/cancel` | Un alta validada que guarda al usuario |

## Intermedio

| Ejemplo | Nivel | Etiquetas | Funciones | Qué vas a construir |
| --- | --- | --- | --- | --- |
| [Flujo de compra](./flujo-compra) | Intermedio | Flujos | `.choose()`, sub-flujos `then`, `goto`, estado calculado, timeouts | Una tienda pequeña con cantidad, confirmación y dirección |
| [Soporte con timeout](./flujo-soporte) | Intermedio | Conversaciones | `bot.conversation()`, `c.waitText()`, `c.choose()`, `ConversationTimeout`, `ConversationCancelled` | Un servicio de soporte que abre tickets y maneja sesiones abandonadas |
| [Plugin: rate limiter](./rate-limiter) | Intermedio | Plugins, Hooks | `definePlugin()`, `before('message')`, `abort()`, `onDispose()` | Un plugin reutilizable que limita los mensajes por usuario |
| [Reserva de citas](./reserva-citas) | Intermedio | WhatsApp, Formularios, SQLite | `.persistent()`, `.form()`, `validate` + `maxAttempts`, `SQLiteStore`, `ctx.user` | Un flujo de reservas que valida, confirma y se retoma tras un reinicio |
| [Seguimiento de pedidos](./seguimiento-pedidos) | Intermedio | WhatsApp, Datos de usuario | namespaces de `ctx.user`, `bot.conversation()`, `MemoryStore` con archivo | Consultas de pedidos que recuerdan lo que sigue cada usuario |
| [Handoff humano](./handoff-humano) | Intermedio | WhatsApp, Soporte | `ctx.handoff()`, `bot.resume()`, eventos de handoff, comandos de agente, `bot.delay()` | Un bot de soporte que pasa chats a agentes y los recupera |
| [Bot multi-idioma](./multi-idioma) | Intermedio | WhatsApp, Telegram, i18n | `bot.locale()`, `ctx.t()`, `detect`, `ctx.setLang()`, plurales | Un bot que responde a cada usuario en español o en inglés |
| [Bot de grupo](./bot-de-grupo) | Intermedio | WhatsApp, Telegram, Grupos | conversaciones por participante, `scope`, menciones, `groupMode`, comandos solo para admins | Un quiz de grupo con marcador y comandos de administración |
| [WhatsApp y Telegram a la vez](./whatsapp-y-telegram) | Intermedio | WhatsApp, Telegram, SQLite | `defineBot`, dos providers, espacios de nombres del store, ids estables | Un archivo de bot que atiende dos canales desde un proceso |

## IA

Usan [`@botmesh/ai`](/es/guide/ai) con Anthropic por defecto; cada página muestra cómo cambiar a OpenAI, Gemini o un modelo local de Ollama. La API key siempre sale de una variable de entorno.

| Ejemplo | Nivel | Etiquetas | Funcionalidades | Qué hace |
| --- | --- | --- | --- | --- |
| [Asistente de preguntas frecuentes con IA](./ia-faq) | Principiante | IA, Límites | autoresponder, persona, triggers de función, `/reset` | Responde dudas de una tienda con un LLM, rechaza lo que no es del tema y deja las respuestas fijas fuera del modelo. |
| [Asistente de citas con IA](./ia-herramientas-citas) | Intermedio | IA, Herramientas | tool calling, `confirm: true`, `confirmLines`, `dedupe`, `enum` | Reserva, lista y cancela citas con tus funciones, con una confirmación antes de cada cambio. |
| [IA con tus preguntas frecuentes](./ia-rag) | Intermedio | IA, RAG | retriever de `rag`, `appendSources`, `warmup()` | Responde a partir de un FAQ en Markdown, cita la sección que usó y admite lo que no sabe. |
| [Respuestas de IA en streaming](./ia-streaming) | Intermedio | IA, Streaming, Telegram | `stream`, borradores / ediciones / trozos, coste y latencia | Muestra la respuesta mientras el modelo la escribe, ajustada para coste y latencia. |
| [Enrutador con IA](./ia-enrutador) | Avanzado | IA, Flujos | `generate()`, `replyInChat()`, flujos, `bot.trigger()` | Clasifica el texto libre con el modelo, lleva los pagos a flujos deterministas y deja la charla a la IA. |
| [IA con escalado a humano](./ia-escalado-humano) | Avanzado | IA, Herramientas, Handoff | tool calling, `ctx.handoff()`, `bot.resume()`, comandos de escape | Pasa el chat a una persona con un resumen para el agente y lo recupera con `/bot`. |

## Avanzado

| Ejemplo | Nivel | Etiquetas | Funcionalidades | Qué construyes |
| --- | --- | --- | --- | --- |
| [Servidor de webhooks para la Cloud API](./webhook-cloud-api) | Avanzado | WhatsApp, Cloud API, Webhooks, Seguridad | Webhooks de `@botmesh/meta`, firmas sobre el body crudo, ventana de 24 h, plantillas | Un servidor `node:http` para la Cloud API oficial, con plantilla de respaldo |
| [Bot listo para producción](./bot-produccion) | Avanzado | Producción, Docker, SQLite, Durabilidad | `SQLiteStore`, durabilidad, flujos persistentes, salud y métricas, apagado ordenado, logs | Un bot de soporte empaquetado como proyecto pequeño con Dockerfile |
| [Resumen diario programado](./resumen-diario) | Avanzado | Scheduler, Broadcast, Zonas horarias | Scheduler durable, zonas horarias, `bot.broadcast`, altas y bajas con `ctx.user` | Un resumen a las 08:00 en la zona horaria del bot, una vez al día aunque haya reinicios |
| [Probar tu bot](./probar-tu-bot) | Avanzado | Testing, Vitest, Transcripciones doradas | `createTestBot`, `expectReply`, transcripciones doradas, reproducción | Un archivo de Vitest completo que graba y reproduce una conversación |
| [Crear un plugin: FAQ con herramientas](./plugin-faq) | Avanzado | Plugins, Inyección de dependencias | `definePlugin`, `install`/`uninstall`, `ctx.onDispose`, `provide` | Un plugin de FAQ reutilizable que comparte sus contadores como herramienta |

## Cobertura de funcionalidades

Qué ejemplos muestran cada funcionalidad principal. Todos los ejemplos corren
también en el [simulador de la terminal](/es/guide/simulador) y, salvo el
servidor de webhooks de la Cloud API, en WhatsApp (Baileys) y Telegram con el
mismo código del bot.

| Funcionalidad | Ejemplos |
| --- | --- |
| Flujos (DSL `flow()`) | [Flujo de registro](./flujo-registro), [Bot de menú](./bot-menu), [Flujo de compra](./flujo-compra), [Reserva de citas](./reserva-citas), [Enrutador con IA](./ia-enrutador), [Probar tu bot](./probar-tu-bot), [Webhooks de la Cloud API](./webhook-cloud-api) |
| Preguntas, menús y formularios (`ask`, `choose`, `form`) | [Flujo de registro](./flujo-registro), [Bot de menú](./bot-menu), [Flujo de compra](./flujo-compra), [Soporte con timeout](./flujo-soporte), [Reserva de citas](./reserva-citas), [Seguimiento de pedidos](./seguimiento-pedidos) |
| Triggers y comandos | [Bot de saludo](./bot-saludo), [Bot de FAQ](./bot-faq), [Enviar mensajes](./mensajes), [Bot de grupo](./bot-de-grupo), [Plugin de FAQ](./plugin-faq) |
| Media (enviar y recibir) | [Respuestas con media](./media) |
| Encuestas | [Bot de encuestas](./bot-encuesta) |
| Botones | [Bot de menú](./bot-menu), [Asistente de citas con IA](./ia-herramientas-citas) |
| Hooks | [Rate limiter](./rate-limiter), [Bot multi-idioma](./multi-idioma) |
| Plugins | [Rate limiter](./rate-limiter), [Plugin de FAQ](./plugin-faq) |
| i18n | [Bot multi-idioma](./multi-idioma) |
| Datos de usuario (`ctx.user`) | [Seguimiento de pedidos](./seguimiento-pedidos), [Reserva de citas](./reserva-citas), [Resumen diario](./resumen-diario), [WhatsApp y Telegram](./whatsapp-y-telegram) |
| Handoff humano | [Handoff humano](./handoff-humano), [IA con escalado a humano](./ia-escalado-humano) |
| Grupos | [Bot de grupo](./bot-de-grupo) |
| Scheduler | [Bot de recordatorios](./recordatorios), [Resumen diario](./resumen-diario), [Handoff humano](./handoff-humano) |
| Broadcast | [Resumen diario](./resumen-diario) |
| Stores | [Reserva de citas](./reserva-citas), [Seguimiento de pedidos](./seguimiento-pedidos), [WhatsApp y Telegram](./whatsapp-y-telegram), [Bot listo para producción](./bot-produccion), [Resumen diario](./resumen-diario) |
| Durabilidad | [Bot listo para producción](./bot-produccion) |
| Multicanal (un bot, varios providers) | [WhatsApp y Telegram](./whatsapp-y-telegram) |
| Webhooks y WhatsApp Cloud API | [Webhooks de la Cloud API](./webhook-cloud-api) |
| Telegram | [WhatsApp y Telegram](./whatsapp-y-telegram), [IA en streaming](./ia-streaming), [Bot de grupo](./bot-de-grupo), [Bot multi-idioma](./multi-idioma) |
| Chat con IA | [Asistente de FAQ con IA](./ia-faq), [IA con tus preguntas frecuentes](./ia-rag), [Enrutador con IA](./ia-enrutador) |
| Herramientas de IA con confirmación | [Asistente de citas con IA](./ia-herramientas-citas), [IA con escalado a humano](./ia-escalado-humano) |
| Historial de IA y RAG | [IA con tus preguntas frecuentes](./ia-rag), [Asistente de FAQ con IA](./ia-faq), [Enrutador con IA](./ia-enrutador) |
| Streaming de IA | [IA en streaming](./ia-streaming) |
| Testing | [Probar tu bot](./probar-tu-bot), [IA en streaming](./ia-streaming) |
| Simulador en la terminal (`npx botmesh dev`) | [Bot de saludo](./bot-saludo), [Bot de encuestas](./bot-encuesta), [Probar tu bot](./probar-tu-bot) |

Salvo el servidor de webhooks de la Cloud API, el código de cada ejemplo es
el mismo en WhatsApp (Baileys) y Telegram: solo cambia el provider. Cuando un canal muestra algo distinto (botones,
stickers), la página del ejemplo lo dice, y la
[matriz de capacidades](/es/guide/canales#matriz-de-capacidades) da los
detalles.
