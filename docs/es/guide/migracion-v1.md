# Si vienes de la v1

botmesh 2 (`@botmesh/core`) es una reescritura de la v1, que se publicaba como
`@bot-wa/bot-wa-baileys` (`BaileysClass`). El motor es nuevo y agnóstico de
transporte: todo lo de la conexión de WhatsApp (sesión, QR, JIDs, auth) se
movió a un **provider** que construyes y le pasas al bot. Esta página resume
qué cambia; la guía paso a paso con ejemplos de antes y después es
[`MIGRATION-v1-to-v2`](/MIGRATION-v1-to-v2).

## Qué corresponde a qué

| v1 | v2 |
| --- | --- |
| `new BaileysClass(opts)` | `new Bot({ provider: new BaileysProvider(opts) })` y `await bot.start()` |
| `import … from '@bot-wa/bot-wa-baileys'` | `import { Bot, flow } from '@botmesh/core'` e `import { BaileysProvider } from '@botmesh/baileys'` |
| `addKeyword().addAnswer(texto, { capture })` | `flow(trigger).say(texto)` / `.ask(texto, clave)` (`addKeyword` sigue como alias obsoleto de `flow`; `.addAnswer` y `.addAction` no existen) |
| `sendText`, `sendImage`, `sendFile`… | `bot.send(chatId, contenido)` y los helpers de contexto `ctx.reply`, `ctx.photo`, `ctx.file`… |
| `{ image: { url }, caption }` | `{ kind: 'image', media: { url }, caption }`: una única unión de contenido neutral |
| `ctx.key` / `ctx.rawMessage` | `ctx.ref` (`{ id, chatId, native? }`) / `ctx.raw` |
| `usePairingCode` + evento `pairing_code` | `pairingPhoneNumber` en `BaileysProvider`; el código llega en el evento `qr` |
| `sendButtons` | Usa menús `choose()` o `ctx.poll()` en Baileys; la Cloud API sí tiene botones nativos |
| `bot.groups`, `bot.profile`, `bot.privacy`… | Eliminados del core: ver [Sub-APIs](./sub-apis) |

## Comportamiento que cambia

- **Los triggers de texto comparan por igualdad normalizada**, no por
  "contiene". Pide `{ pattern, match: 'contains' }` donde lo necesitabas
  ([Conceptos básicos](./conceptos)).
- **Los handlers de tipo (`onType`, `bot.when(IMAGE, …)`) son de baja
  especificidad**: un handler más específico que también coincide gana salvo
  que llame a `ctx.pass()`.
- **El evento `'message'` se emite para todo mensaje procesado**; el
  catch-all para lo que nadie manejó es `bot.onMessage()`.
- **En grupos, las conversaciones son por participante** por defecto
  (`conversationScope: 'chat'` recupera una por chat).
- **Solo ESM, Node.js 22 o posterior** (ver [Paquetes y versiones](./paquetes)).
- **Los flujos `.persistent()` solo sobreviven a un reinicio con un store
  persistente** ([Store persistente](./store)).

## Herramientas que ayudan

- La regla de ESLint [`botmesh/no-v1-api`](./eslint#botmesh-no-v1-api) marca
  las llamadas de la v1 y de BuilderBot que ya no existen y nombra su
  reemplazo.
- [Canales](./canales) lista todos los providers que sustituyen a la conexión
  de WhatsApp integrada.

## Siguientes pasos

- [Inicio rápido](./inicio): un proyecto v2 desde cero.
- [Flujos conversacionales](./flujos): el DSL `flow()` en detalle.
- [Guía de actualización](./migracion-estable): pasar entre prereleases de 2.0.
