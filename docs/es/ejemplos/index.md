# Ejemplos

Bots completos que muestran lo que puede hacer botmesh. Cada uno es un solo archivo que puedes copiar, ejecutar en la terminal con `npx botmesh dev bot.js` y después conectar a WhatsApp o Telegram, y cada uno lo ejecuta un test, así que el código y la conversación de la página son lo que obtienes.

## Ejemplos con IA

Usan [`@botmesh/ai`](/es/guide/ai) con Anthropic por defecto; cada página muestra cómo cambiar a OpenAI, Gemini o un modelo local de Ollama. La API key siempre sale de una variable de entorno.

| Ejemplo | Nivel | Etiquetas | Funcionalidades | Qué hace |
| --- | --- | --- | --- | --- |
| [Asistente de preguntas frecuentes con IA](./ia-faq) | Principiante | IA, Límites | autoresponder, persona, triggers de función, `/reset` | Responde dudas de una tienda con un LLM, rechaza lo que no es del tema y deja las respuestas fijas fuera del modelo. |
| [Asistente de citas con IA](./ia-herramientas-citas) | Intermedio | IA, Herramientas | tool calling, `confirm: true`, `confirmLines`, `dedupe`, `enum` | Reserva, lista y cancela citas con tus funciones, con una confirmación antes de cada cambio. |
| [IA con tus preguntas frecuentes](./ia-rag) | Intermedio | IA, RAG | retriever de `rag`, `appendSources`, `warmup()` | Responde a partir de un FAQ en Markdown, cita la sección que usó y admite lo que no sabe. |
| [Respuestas de IA en streaming](./ia-streaming) | Intermedio | IA, Streaming, Telegram | `stream`, borradores / ediciones / trozos, coste y latencia | Muestra la respuesta mientras el modelo la escribe, ajustada para coste y latencia. |
| [Enrutador con IA](./ia-enrutador) | Avanzado | IA, Flujos | `generate()`, `replyInChat()`, flujos, `bot.trigger()` | Clasifica el texto libre con el modelo, lleva los pagos a flujos deterministas y deja la charla a la IA. |
| [IA con escalado a humano](./ia-escalado-humano) | Avanzado | IA, Herramientas, Handoff | tool calling, `ctx.handoff()`, `bot.resume()`, comandos de escape | Pasa el chat a una persona con un resumen para el agente y lo recupera con `/bot`. |
