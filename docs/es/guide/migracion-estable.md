# Migrar a la API estable

`@botmesh/core` 2.0 congela su API pública. Antes de eso, las últimas alphas
recortaron la entrada principal y eligieron un nombre por concepto. Esta página
lista cada cambio que puede notar quien usa una alpha, con su reemplazo. La
mayoría de los renombres conservan un alias `@deprecated`, así que el editor
los tacha y el código sigue funcionando. Las pocas rupturas reales están
marcadas como **Ruptura**.

El paso de una alpha a la estable se cubre en cuatro páginas; lee todas las que
te afecten:

- esta página: entradas del paquete, nombres canónicos y configuración (API);
- [cambios de comportamiento](/es/guide/migracion-2): textos en inglés por
  defecto, `retries` frente a `maxAttempts`, envíos antes de `start()`, ids en
  logs, logs append-only dañados;
- [dependencias y nombres](/es/guide/migracion): Baileys/ffmpeg, Graph
  `v26.0`, `redis` como peer, SDKs y modelos de IA, `botwa` → `botmesh`;
- [canales y plugins](/es/guide/actualizar-canales-plugins): arreglos por
  canal, además del contrato común (timestamps en ms, división de textos
  largos, métodos ausentes para operaciones no soportadas) en
  [Canales](/es/guide/canales).

## Entradas del paquete

La entrada principal (`@botmesh/core`) ahora solo exporta lo que necesita una
aplicación: 512 nombres antes, 372 después (368 tras el recorte, más `BotNotRunningError`, `InvalidProviderEventError`, `RateLimitRetryOptions` y `SplitTextOptions` de los demás cambios para estable). Todo lo demás pasó a un subpath:

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
| `Dispatcher`, `ConversationRuntime`, `HookSystem`, `Scheduler`, `InboundDeduper`, `createInboundDeduper`, `inboundDedupeKey`, `SentRefRing`, `createEchoFilter`, `UserDataService`, `checkAccess`, `validateHandoffConfig`, `HANDOFF_INDEX_KEY`, `messagingSupport`, `DEFAULT_TYPING`, `cronNextRun`, `sleep`, `withTimeout`, `humanTypingDelay`, `randomId`, `isSchemaLike`, `resolveStreamStrategy`, `findSplitPoint`, `withFormDefaults`, `providerLanguageOf` | `@botmesh/core/internal` |
| `Pacer`, `PacerOptions`, `PaceGuard`, `PacerLogger`, `ResolvedTypingConfig`, `RuntimeConfig`, `ConversationHandle`, `CheckpointStore`, `AnswerCodec`, `RuntimeHandover`, `RuntimeHandoverFallback` | `@botmesh/core/internal` |
| `DispatchContext`, `DispatcherDeps`, `DispatcherMessageHandler`, `DispatcherCommandHandler`, `BroadcastDeps`, `BuildContextDeps`, `HooksLike`, `HookLogger`, `RegisteredHook`, `ConversationTraceHooks`, `ConversationTurnTrace`, `TaskTraceHooks`, `TaskRunInfo` | `@botmesh/core/internal` |
| `InboundDedupeKey`, `InboundDeduperOptions`, `SentRefRingOptions`, `UserDataServiceOptions`, `DEFAULT_DEDUPE_SIZE`, `DEFAULT_ECHO_FILTER_SIZE`, `DEFAULT_SCHEMA_MESSAGE`, `DEFAULT_USER_NAMESPACE` | `@botmesh/core/internal` |
| `buildMessageContext`, `createControls`, `createPacer`, `runBroadcast`, `runFormStep`, `resolveFormMode`, `newFormToken`, `MetricsCollector`, `formatUptime`, `ExternalSendClock`, `TYPING_REFRESH_MS`, `normalizeTypingConfig`, `resolveReplyTyping`, `typingDuration`, `parseReplyDelay` | `@botmesh/core/internal` (se quitaron los reexports obsoletos de la entrada principal) |

```ts
// Antes: Bot, KvDurability, MemoryKv y MemoryCoordinator venían de '@botmesh/core'.
// Después:
import { Bot } from '@botmesh/core'
import { KvDurability, MemoryKv } from '@botmesh/core/spi'
import { MemoryCoordinator } from '@botmesh/core/testing'
```

Algunos tipos del motor que se movieron siguen apareciendo en firmas que usa una
aplicación, así que la entrada principal los conserva: `MessagingFeature` y
`MessagingSupport` (`ctx.supports()`), `ResolvedWaitOptions`
(`ConversationControlsBase.waitAny()`) y `JsonValue` (la forma de
`SerializedMediaRef.data` y de los registros de los journals; también lo exporta
`@botmesh/core/spi`). Impórtalos de `@botmesh/core`, no de `/internal` ni de `/testing`.

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

## Paquetes de canales y stores

Los paquetes públicos de canales y stores siguen la misma regla: un nombre por
concepto, con el antiguo como alias `@deprecated` hasta v3.

| Paquete | Deprecado | Usa |
| --- | --- | --- |
| `@botmesh/telegram` | `pollTimeout` (segundos) | `pollTimeoutMs` |
| `@botmesh/telegram` | `toProviderError` | `toTelegramError` |
| `@botmesh/telegram`, `@botmesh/meta` | `debug: true` | `logger` (cualquier `LoggerLike`) |
| `@botmesh/meta` | `toProviderError(chatId, err, retryAfterMs)` | `toGraphError(err, { chatId, retryAfterMs })` de `@botmesh/graph-core` |
| `@botmesh/meta` | reexportaciones de `verifyChallenge`, `verifySignature` | `provider.verifyChallenge(query)` / `provider.ingest()`, o `@botmesh/graph-core` |
| `@botmesh/meta` | `GraphClient` | los métodos del provider, o `graphRequest` de `@botmesh/graph-core` |
| `@botmesh/sqlite-store` | `SCHEDULES_SCHEMA`, `DURABLE_SCHEMA` | nada: el store crea y migra sus tablas |

El mapeador de errores de bajo nivel de cada provider se llama ahora
`to<Canal>Error`; los canales privados tienen los mismos cambios de nombre
(`toDiscordError`, `toMessengerError`, `toInstagramError`, `toTikTokError`,
`toEmailError`). Los cambios de comportamiento de estos paquetes (votos de encuestas
en Telegram, ediciones en Discord, versionado del esquema de SQLite) están en
[Notas de actualización: canales y plugins](./actualizar-canales-plugins).

## Entradas de `@botmesh/ai`

`@botmesh/ai` se divide igual que el core: 135 nombres en la entrada principal antes, 97 después.

| Importar de | Qué contiene |
| --- | --- |
| `@botmesh/ai` | `aiPlugin`, `AIClient`, los proveedores y los contratos de cliente que reciben (`AnthropicLike`, `OpenAILike`, `GeminiLike`, `GeminiModelLike`, `GoogleGenAILike`), herramientas, confirmaciones, memoria, tipos de RAG, `formatMarkdown`. |
| `@botmesh/ai/testing` | **Nuevo.** `MockAIProvider` (con `MockOptions`, `MockTurn`) y `validateArgs` (con `ArgsValidation`), para probar el esquema de una herramienta. Cubierto por semver. |
| `@botmesh/ai/internal` | **Nuevo.** Los helpers del plugin y los nombres de las formas de petición/respuesta de los SDK. Sin garantía semver. |

`@botmesh/ai` sigue reexportando `MockAIProvider`, `MockOptions` y `MockTurn`, pero
obsoletos: impórtalos de `@botmesh/ai/testing`.

**Ruptura:** `@botmesh/ai` ya no exporta estos nombres. Cambia la ruta del import; los valores
son los mismos.

| Nombres | Importar de |
| --- | --- |
| `validateArgs`, `ArgsValidation` | `@botmesh/ai/testing` |
| `aiText`, `defaultConfirmPrompt`, `DEFAULT_MAX_STEPS`, `DEFAULT_TOOL_TIMEOUT_MS`, `toolDefinitions`, `parametersOf`, `isAffirmative`, `humanizeName`, `toolTitle`, `ToolLedger`, `stableKey`, `DEFAULT_DEDUPE_WINDOW_MS`, `DEFAULT_LEDGER_RETENTION_MS` | `@botmesh/ai/internal` |
| `toGeminiSchema`, `DEFAULT_MEMORY_NAMESPACE`, `factsSchema`, `parseFacts`, `DEFAULT_RAG_INSTRUCTIONS`, `ragContextBlock`, `citedChunks`, `citedPassages`, `formatSources` | `@botmesh/ai/internal` |
| `AnthropicMessage`, `AnthropicContentBlock`, `AnthropicUsage`, `AnthropicStreamEvent`, `AnthropicRequestOptions`, `OpenAIChatCompletion`, `OpenAIChoice`, `OpenAIStreamChunk`, `OpenAIToolCall`, `OpenAIRequestOptions`, `GeminiResponse`, `GeminiUsage`, `GeminiPart`, `GeminiFunctionCall`, `GeminiRequestOptions`, `GoogleGenAIResponse` | `@botmesh/ai/internal` (tipos) |

Los contratos de cliente no cambian de forma: sus tipos de petición y respuesta ahora van
escritos en línea, así que un cliente falso tipado `AnthropicLike` (u `OpenAILike`,
`GeminiLike`…) compila igual. Para nombrar una respuesta, derívala del contrato o impórtala de
`/internal`:

```ts
import type { AnthropicLike } from '@botmesh/ai'
type Reply = Awaited<ReturnType<AnthropicLike['messages']['create']>>
```

**Ruptura (datos congelados):** `PRESETS`, `DEFAULT_YES`, `DEFAULT_NO`, `AI_MESSAGES` y
`AI_LOCALES` están congelados en profundidad y tipados `readonly`. Antes, modificarlos cambiaba
los valores por defecto de todos los bots del proceso; ahora lanza un `TypeError` en modo
estricto. Extiende una copia:

```ts
aiPlugin({ toolConfirm: { yes: [...DEFAULT_YES, 'arre'] } })
```

Los constructores de proveedores reciben ahora un `AIProviderConfig` (`model`, `maxTokens`,
`effort`, `thinking`, `baseUrl`), la parte de `AIConfig` que lee un proveedor. Pasar un
`AIConfig` entero sigue compilando. `GenerateInput.onStreamEnd` recibe un `AIStreamEndInfo` con
nombre; su contrato (una vez, tras el último fragmento, solo si termina con normalidad) está en
[Notas de actualización: canales y plugins](./actualizar-canales-plugins#botmesh-ai).

## Token de la API del sandbox

`@botmesh/sandbox` es privado, pero los scripts que usan su API web cambian:

- **Ruptura:** `POST /api/<canal>/send|fault|status|reset` necesita ahora el
  token de la ejecución en la cabecera `x-sandbox-token`. Léelo de
  `sandbox.token` (o de la salida de la CLI), o fíjalo con
  `startSandbox({ token })` / `--token`.
- Las peticiones con un `Host` que no es de loopback, o con un `Origin` de otro
  sitio, reciben un 403. Pasa `allowedHosts` / `--allow-host` si llegas al hub
  con otro nombre a propósito.
- Una entrada incorrecta es ahora un 4xx: se rechazan los campos desconocidos,
  los tipos erróneos y un cuerpo que no sea un objeto JSON, y `toUserInput()`
  lanza `SandboxInputError`.
