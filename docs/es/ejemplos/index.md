# Ejemplos

Bots completos para copiar, ejecutar y adaptar. Cada ejemplo es un único
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

El código de cada ejemplo es el mismo en WhatsApp (Baileys) y Telegram:
solo cambia el provider. Cuando un canal muestra algo distinto (botones,
stickers), la página del ejemplo lo dice, y la
[matriz de capacidades](/es/guide/canales#matriz-de-capacidades) da los
detalles.
