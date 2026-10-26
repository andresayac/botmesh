# Ejemplos

Bots completos para copiar y ejecutar. Cada uno es un único `bot.js` que corre
en el simulador de la terminal (`npx botmesh dev bot.js`) y en un canal real
(`node bot.js`), y enumera las funcionalidades que muestra con enlaces a sus
guías. Todos los ejemplos del sitio los ejecuta la suite de tests de botmesh,
transcripción incluida.

## Intermedios

| Ejemplo | Nivel | Etiquetas | Funcionalidades | Qué vas a construir |
| --- | --- | --- | --- | --- |
| [Reserva de citas](./reserva-citas) | Intermedio | WhatsApp, Formularios, SQLite | `.persistent()`, `.form()`, `validate` + `maxAttempts`, `SQLiteStore`, `ctx.user` | Un flujo de reservas que valida, confirma y se retoma tras un reinicio |
| [Seguimiento de pedidos](./seguimiento-pedidos) | Intermedio | WhatsApp, Datos de usuario | namespaces de `ctx.user`, `bot.conversation()`, `MemoryStore` con archivo | Consultas de pedidos que recuerdan lo que sigue cada usuario |
| [Handoff humano](./handoff-humano) | Intermedio | WhatsApp, Soporte | `ctx.handoff()`, `bot.resume()`, eventos de handoff, comandos de agente, `bot.delay()` | Un bot de soporte que pasa chats a agentes y los recupera |
| [Bot multi-idioma](./multi-idioma) | Intermedio | WhatsApp, Telegram, i18n | `bot.locale()`, `ctx.t()`, `detect`, `ctx.setLang()`, plurales | Un bot que responde a cada usuario en español o en inglés |
| [Bot de grupo](./bot-de-grupo) | Intermedio | WhatsApp, Telegram, Grupos | conversaciones por participante, `scope`, menciones, `groupMode`, comandos solo para admins | Un quiz de grupo con marcador y comandos de administración |
| [WhatsApp y Telegram a la vez](./whatsapp-y-telegram) | Intermedio | WhatsApp, Telegram, SQLite | `defineBot`, dos providers, espacios de nombres del store, ids estables | Un archivo de bot que atiende dos canales desde un proceso |
