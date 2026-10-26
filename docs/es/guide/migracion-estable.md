# Migrar a la API estable

`@botmesh/core` 2.0 congela su API pública. Antes de eso, las últimas alphas
recortaron la entrada principal y eligieron un nombre por concepto. Esta página
lista cada cambio que puede notar quien usa una alpha, con su reemplazo. La
mayoría de los renombres conservan un alias `@deprecated`, así que el editor
los tacha y el código sigue funcionando. Las pocas rupturas reales están
marcadas como **Ruptura**.

## Entradas del paquete

La entrada principal (`@botmesh/core`) ahora solo exporta lo que necesita una
aplicación: 512 nombres antes, 365 después. Todo lo demás pasó a un subpath:

| Importa de | Qué contiene |
| --- | --- |
| `@botmesh/core` | El `Bot`, el DSL de flujos, los tipos de mensaje, las opciones y los errores que puedes capturar. |
| `@botmesh/core/testing` | Kit de tests, transcripciones doradas, simulación de caídas, `MemoryCoordinator` / `MemoryCoordinationHub`. |
| `@botmesh/core/spi` | **Nuevo.** Para autores de stores, backends de durabilidad, schedule stores, coordinadores, integraciones de trazas y transportes. Con garantía semver. |
| `@botmesh/core/internal` | Clases y helpers del motor. Sin garantía semver. |

**Ruptura:** `@botmesh/core` ya no exporta los nombres de abajo. Cambia la ruta
del import; los valores son los mismos.

| Nombres | Importa de |
| --- | --- |
| `KvDurability`, `KvInbox`, `KvOutbox`, `KvDurabilityOptions`, `MemoryKv`, `assertKvMutation`, `DurableKvEntry`, `DurableKvIndex`, `DurableTable`, `KvMutation`, `MemoryKvSnapshot`, `StaleLeaseError`, `computeBackoff`, `DEFAULT_BACKOFF`, `InboxJournal`, `InboxRecord`, `InboxState`, `InboxAppend`, `OutboxJournal`, `OutboxRecord`, `OutboxState`, `OutboxPut`, `OutboxError`, `ClaimedSend`, `ClaimOptions`, `LeaseOptions` | `@botmesh/core/spi` |
| `MemoryScheduleStore`, `isScheduleClaimable`, `applyScheduleComplete`, `ScheduleRecord`, `ScheduleKind`, `ClaimResult`, `CompletePatch`, `MemoryLeaseProvider`, `LeaseGrant`, `LeaseInfo`, `Ticket`, `ChatTurn`, `Leadership`, `AcquireTurnOptions` | `@botmesh/core/spi` |
| `messageKey`, `legacyMessageKey`, `CheckpointAnswer`, `CheckpointHandover`, `UserDataEntry`, `UserDataStore`, `supportsUserData` | `@botmesh/core/spi` |
| `toInboundLocation`, `InboundLocationInput`, `formReplyBody`, `parseFormReply`, `assertFormDefinition`, `validateFormValues`, `parseFieldAnswer`, `parseFormDate`, `formOptionEntries`, `isFieldRequired`, `selectionBounds`, `FieldCheck`, `FormFieldError`, `FormValidation`, `I18n`, `I18nOptions`, `I18nLogger`, `normalizeLocale` | `@botmesh/core/spi` |
| `noopTracer`, `NOOP_TRACING`, `errorTypeOf`, `formatTraceparent`, `parseTraceparent`, `CheckpointTrace` | `@botmesh/core/spi` |
| `MemoryCoordinator`, `MemoryCoordinationHub`, `MemoryCoordinatorOptions` | `@botmesh/core/testing` |
| `Dispatcher`, `ConversationRuntime`, `HookSystem`, `Scheduler`, `InboundDeduper`, `createInboundDeduper`, `inboundDedupeKey`, `SentRefRing`, `createEchoFilter`, `UserDataService`, `checkAccess`, `validateHandoffConfig`, `HANDOFF_INDEX_KEY`, `messagingSupport`, `DEFAULT_TYPING`, `cronNextRun`, `sleep`, `withTimeout`, `humanTypingDelay`, `randomId`, `isSchemaLike`, `resolveStreamStrategy`, `findSplitPoint`, `withFormDefaults`, `providerLanguageOf` y sus tipos de opciones | `@botmesh/core/internal` |
| `buildMessageContext`, `createControls`, `createPacer`, `runBroadcast`, `runFormStep`, `resolveFormMode`, `newFormToken`, `MetricsCollector`, `formatUptime`, `ExternalSendClock`, `TYPING_REFRESH_MS`, `normalizeTypingConfig`, `resolveReplyTyping`, `typingDuration`, `parseReplyDelay` | `@botmesh/core/internal` (se quitaron los reexports obsoletos de la entrada principal) |

```ts
// Antes: Bot, KvDurability, MemoryKv y MemoryCoordinator venían de '@botmesh/core'.
// Después:
import { Bot } from '@botmesh/core'
import { KvDurability, MemoryKv } from '@botmesh/core/spi'
import { MemoryCoordinator } from '@botmesh/core/testing'
```

`@botmesh/core` sigue reexportando las funciones de transcripciones doradas
(`recordTranscript`, `RecordingProvider`, `redactTranscript`,
`transcriptFromStore`, `parseTranscript`…), pero están obsoletas: impórtalas de
`@botmesh/core/testing`.

## Un nombre por concepto

Estos alias siguen funcionando y están marcados como `@deprecated`:

| Obsoleto | Usa |
| --- | --- |
| `ctx.say(text)`, `ctx.answer(text)`, `ctx.text(text)` | `ctx.reply(text)` (el paso `.say()` del DSL de flujos no cambia) |
| `addKeyword(trigger)` | `flow(trigger)` |
| `bot.sendText(chatId, text)`, `bot.sendTo(chatId, content)` | `bot.send(chatId, content)` |
| `bot.use(plugin)` | `bot.plug(plugin)` (`bot.use()` es para flujos) |
| `bot.useFlow(flow)` | `bot.use(flow)`, o `bot.registerFlow(flow)` para recibir el id |
| `bot.triggerFlow(id, { chatId }, { data })` | `bot.trigger(id, { chatId, data, ifActive: 'replace' })` (`result.started` es el booleano de antes) |
| `bot.enterConversation('nombre', ctx)` | `bot.trigger('nombre', { chatId: ctx.from, userId: ctx.sender, isGroup: ctx.isGroup, ifActive: 'replace' })` |
| `bot.onImage(h)`, `onAudio`, `onVideo`, `onDocument`, `onSticker`, `onLocation`, `onContact`, `onPoll` | `bot.onType('image', h)` o `bot.when(IMAGE, h)` |
| `Config` | `BotConfig` |
| `Whitelist` (la clase) | `bot.whitelist`, con tipo `Bot['whitelist']`; el concepto es `AccessList` |
| `ConversationFn` | `ConversationHandler` |
| `durability: { journal }` | `durability: { backend }` |
| `storeConfig: { file }` | `store: new MemoryStore({ file })` |

`bot.enterConversation(handler, ctx)` con un handler en línea no está
obsoleto: es la forma de arrancar una conversación que no está registrada.

`BotConfig.storeConfig` ahora tiene tipo (`file`, `maxMessagesPerChat`,
`autoSaveInterval`) y el bot avisa en el log cuando se usa. Poner
`durability.backend` y `durability.journal` con dos backends distintos lanza un
`ConfigValidationError`.

## Plugins: una instancia por nombre

**Ruptura:** `bot.plug()` lanza si ya hay enchufado un plugin con el mismo
`name`. Antes se instalaba también la segunda instancia y las dos ejecutaban
sus handlers. Para volver a enchufar un plugin, llama antes a su función
unplug. Un plugin pensado para correr varias veces pone `multiple: true` en su
spec:

```ts
definePlugin({ name: 'webhook', version: '1.0.0', multiple: true, install(ctx) { /* … */ } })
```

## Duraciones

Toda opción de duración de `BotConfig` acepta un texto de duración o un número
de milisegundos, incluidas todas las opciones `*Ms`. `typing.minMs`,
`typing.maxMs` y `backoff.baseMs` / `backoff.capMs` de la durabilidad solo
aceptaban números; ahora aceptan `'800ms'`, `'1s'`, etc.

**Ruptura (validación más estricta):** `new Bot()` ahora interpreta cada opción
de duración y lanza un `ConfigValidationError` que la nombra
(`err.field === 'coordination.turnWaitMs'`) cuando un valor no se puede leer.
Antes algunos valores inválidos fallaban más tarde, con un mensaje que no
nombraba la opción, y unas pocas aceptaban `null`.

## Logger

El contrato `LoggerLike` no cambia, y su convención de llamada queda
documentada: los paquetes llaman `logger.warn('mensaje')` o
`logger.warn({ err, ...contexto }, 'mensaje')`, como pino. Ver
[Logger](./conceptos#logger).
