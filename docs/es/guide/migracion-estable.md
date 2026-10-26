# Actualizar a estable: checklist y cambios de API

La línea estable (`@botmesh/core` 2.0.0, los demás paquetes públicos 1.0.0)
congela la API pública. La beta (`@botmesh/core` 2.0.0-beta, los demás paquetes
públicos 1.0.0-beta) ya la incluye, así que estas páginas también sirven para
pasar de una alpha a la beta. Si vienes de una alpha de 2.0, casi todo tu código
sigue funcionando: las APIs renombradas conservan un alias `@deprecated` (tu
editor las tacha), y las pocas rupturas reales están marcadas como **Ruptura**
en estas páginas.

## Checklist de actualización

Síguelo en orden; cada paso enlaza a los detalles.

1. **Actualiza todos los paquetes `@botmesh/*` a la vez**, a la misma línea de
   versiones. No se soporta mezclar un core antiguo con paquetes de canal
   nuevos.
2. **Dependencias** ([detalles](./migracion)): instala ffmpeg si tu bot de
   Baileys envía notas de voz, pasa los bots de Gemini a `@google/genai`,
   revisa el rango del peer `redis` y la versión de la Graph API, y actualiza
   los dashboards que leen métricas `botwa_*`.
3. **Pasa el verificador de tipos** (`tsc --noEmit`) y corrige lo que reporte
   ([detalles abajo](#entradas-del-paquete)): imports que se movieron a
   `@botmesh/core/spi`, `/testing` o `/internal`, `@botmesh/ai/testing`,
   `@botmesh/baileys/internal` y las APIs eliminadas de `RedisStore`.
4. **Reemplaza los nombres obsoletos** ([tabla](#un-nombre-por-concepto)):
   `ctx.reply` en vez de `ctx.say`, `flow` en vez de `addKeyword`,
   `bot.send`, `bot.plug` para plugins, `bot.trigger`, `onType`… Siguen
   funcionando, pero se eliminan en la v3.
5. **Revisa los cambios de comportamiento** ([detalles](./migracion-2)). Los
   dos que necesitan casi todos los bots: `lang: 'es'` si tu bot habla
   español (los textos internos ahora están en inglés) y `maxAttempts: N`
   donde una espera usaba `retries: N`.
6. **Lee las notas de tus canales y plugins**
   ([detalles](./actualizar-canales-plugins)).
7. **Pasa tus tests** y arranca el bot una vez con un listener
   `bot.on('error', …)`. Atento al aviso único de `retries` y a
   `ConfigValidationError`, que ahora nombra cualquier opción de duración
   inválida.

## Entradas del paquete

La entrada principal (`@botmesh/core`) ahora solo exporta lo que necesita una
aplicación (372 nombres, antes 512). Todo lo demás pasó a un subpath:

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
[Logs](./configuracion#logs).

## Paquetes de canales y stores

Los paquetes públicos de canales y stores siguen la misma regla: un nombre por
concepto, con el antiguo como alias `@deprecated` hasta v3.

| Paquete | Deprecado | Usa |
| --- | --- | --- |
| `@botmesh/telegram` | `pollTimeout` (segundos) | `pollTimeoutMs` |
| `@botmesh/telegram` | `toProviderError` | `toTelegramError` |
| `@botmesh/telegram`, `@botmesh/meta`, `@botmesh/baileys` | `debug: true` | `logger` (cualquier `LoggerLike`) |
| `@botmesh/baileys` | `pairingCode` | `pairingPhoneNumber` (el mismo valor: el número del bot) |
| `@botmesh/baileys` | helpers de JID (`isGroup`, `isPn`, `isLid`, `normalizeJid`, `sameUser`, `toUserId`, `toChatId`…), `IdentityStore`, `toMediaUpload`, `mediaToBuffer`, `makeSticker`, `transcodeToOpus`, `resolveRemoteMedia`, `classifyDisconnect`, `backoffDelay`, los helpers de rutas de sesión y `toBaileysLogger` en la entrada principal | los mismos nombres desde `@botmesh/baileys/internal` (sin semver); `toJid` se queda en la entrada principal |
| `@botmesh/meta` | `toProviderError(chatId, err, retryAfterMs)` | `toGraphError(err, { chatId, retryAfterMs })` de `@botmesh/graph-core` |
| `@botmesh/meta` | reexportaciones de `verifyChallenge`, `verifySignature` | `provider.verifyChallenge(query)` / `provider.ingest()`, o `@botmesh/graph-core` |
| `@botmesh/meta` | `GraphClient` | los métodos del provider, o `graphRequest` de `@botmesh/graph-core` |
| `@botmesh/sqlite-store` | `SCHEDULES_SCHEMA`, `DURABLE_SCHEMA` | nada: el store crea y migra sus tablas |
| `@botmesh/graph-core` | `checkGraphSignature(body, headers, appSecret, logger?)` | `checkGraphSignature({ body, headers, appSecret, logger })` |
| `@botmesh/http` | `resolvePublicHost` | `resolveHost` (la misma función; nunca filtró respuestas privadas) |
| `@botmesh/http` | campos de `RequestInit` que no son `method`, `headers`, `body` ni `signal` | nada: quítalos (ver abajo) |
| `create-botmesh` | `TEMPLATES`, `agentsMd`, `findBotMeshMonorepo`, `AgentsMdInfo` desde la entrada principal | `getTemplate()` / `TEMPLATE_NAMES`, o `create-botmesh/internal` (sin semver) |

El mapeador de errores de bajo nivel de cada provider se llama ahora
`to<Canal>Error`; los canales que eran privados durante las alphas tienen los mismos
cambios de nombre (`toDiscordError`, `toEmailError` y `toTikTokError` en el canal de
TikTok, que sigue siendo privado), y `@botmesh/messenger` y
`@botmesh/instagram`, públicos desde la beta, solo traen `toMessengerError` y
`toInstagramError`. Los cambios de comportamiento de estos paquetes (votos de encuestas
en Telegram, ediciones en Discord, versionado del esquema de SQLite) están en
[Notas de actualización: canales y plugins](./actualizar-canales-plugins).

### `@botmesh/baileys`: entradas y tipos nativos

La entrada principal conserva lo que necesita una aplicación (`BaileysProvider`, sus
opciones, `toJid`, `isEditedMessage`, `RateLimiter`, los tipos de `PollStore`). El
resto pasó a `@botmesh/baileys/internal`, sin garantía semver; los nombres antiguos
siguen en la entrada principal como alias `@deprecated` hasta v3.

- **Ruptura:** `@botmesh/baileys` ya no exporta `toInbound` ni `toOutbound`: sus
  firmas usan los tipos propios de Baileys. Impórtalos desde
  `@botmesh/baileys/internal`.
- **Ruptura (solo tipos):** los valores nativos de Baileys son opacos.
  `provider.socket` es `BaileysSocket | null`, `provider.auth` es `BaileysAuthState`,
  y el `raw` / `native` de mensajes, refs y resultados de envío es
  `BaileysNativeMessage`; los tres son alias de `unknown`. En ejecución no cambia
  nada. Usa `socketOf(provider)` y `authStateOf(provider)` de
  `@botmesh/baileys/internal` para tenerlos tipados, o haz el cast con tu propio
  import de `@whiskeysockets/baileys`:

  ```ts
  // antes
  const sock = provider.socket
  // después
  import { socketOf } from '@botmesh/baileys/internal'
  const sock = socketOf(provider)
  ```

- Los predicados de JID (`isGroup`, `isPn`, `isLid`, `isBroadcast`, `isNewsletter`)
  devuelven `boolean` en lugar de `boolean | undefined` (`undefined` ahora es `false`).
- `pairingCode` pasa a llamarse `pairingPhoneNumber` (el valor siempre fue el número
  de teléfono); pasar los dos con números distintos lanza un `TypeError`.

### `@botmesh/redis-store`

**Ruptura:** los internos del layout de claves cluster pasan a un subpath nuevo sin
garantía semver, `@botmesh/redis-store/internal`. La opción `layout`, el tipo
`RedisKeyLayout`, `migrateToClusterLayout()`, `inspectKeyspace()`,
`isRedisClusterClient()` y `withClusterRetry()` siguen en la entrada principal.

| Nombres | Importar de |
| --- | --- |
| `INDEX_BUCKETS`, `LAYOUT_MARKER`, `bucketOf`, `encodeSegment`, `hashSlot` | `@botmesh/redis-store/internal` (la entrada principal aún los reexporta, `@deprecated`) |
| `storeKeys`, `coordKeys`, `scheduleKeys`, `userDataKeys`, `hashTagOf`, `assertOneSlot`, `assertLayoutPrefix` y los tipos de claves | `@botmesh/redis-store/internal` (nuevos; antes no se exportaban) |

**Ruptura:** se eliminan dos API deprecadas.

| Eliminado | Usa |
| --- | --- |
| `new RedisStore({ ttl: 3600 })` (segundos) | `new RedisStore({ sessionTtl: '1h' })` (una duración o milisegundos). Pasar `ttl` desde JavaScript lanza un `TypeError` que nombra el reemplazo. |
| `store.acquireLock(key, ttlMs)` → `token \| null` | `store.acquireLockFenced(key, ttlMs)` → `{ token, fence } \| null`; libera con `releaseLock(key, lock.token)`. Usa la misma clave de lock, así que réplicas con la versión vieja y la nueva se siguen excluyendo durante un despliegue gradual. Desde JavaScript la llamada antigua rechaza con un `TypeError`. |

```ts
// Antes
const token = await store.acquireLock(`job:${id}`, 30_000)
// Después
const token = (await store.acquireLockFenced(`job:${id}`, 30_000))?.token
```

## Entradas de `@botmesh/ai`

`@botmesh/ai` se divide igual que el core: 135 nombres en la entrada principal antes, 98 después.

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

Pasarlos tal cual sigue compilando (`toolConfirm.yes`/`.no` aceptan un `readonly string[]`).

Los constructores de proveedores reciben ahora un `AIProviderConfig` (`model`, `maxTokens`,
`effort`, `thinking`, `baseUrl`), la parte de `AIConfig` que lee un proveedor. Pasar un
`AIConfig` entero guardado en una variable sigue compilando, pero un **objeto literal** con
campos del plugin falla ahora la comprobación de propiedades sobrantes de TypeScript
(`TS2353`), porque los proveedores nunca los leen:

```ts
new AnthropicProvider(client, { model, persona })   // antes compilaba; ahora: TS2353
new AnthropicProvider(client, { model })            // quita los campos del plugin
new AnthropicProvider(client, cfg)                  // o pasa una variable de tipo AIConfig
```
`GenerateInput.onStreamEnd` recibe un `AIStreamEndInfo` con
nombre; su contrato (una vez, tras el último fragmento, solo si termina con normalidad) está en
[Notas de actualización: canales y plugins](./actualizar-canales-plugins#botmesh-ai).

## Paquetes HTTP, Graph y scaffolder

**`@botmesh/http`: `SecureFetchOptions` cerrado.** Las opciones de `secureFetch` y
`fetchBuffer` ya no extienden `RequestInit`. Llevan los campos de la petición que
el cliente respeta (`method`, `headers`, `body`, `signal`) y su política
(`allowHttp`, `allowPrivateHosts`, `timeoutMs`, `maxBytes`, `maxRedirects`,
`resolver`, `fetch`).

- **Ruptura (solo tipos):** desaparece `redirect`. Siempre se sobrescribía con
  `'manual'`, porque el cliente sigue las redirecciones por su cuenta y valida
  cada salto; usa `maxRedirects` (`0` rechaza cualquier redirección).
- Los demás campos de `RequestInit` (`cache`, `keepalive`, `integrity`...) siguen
  compilando con una sobrecarga `@deprecated` (`LegacySecureFetchOptions`) y se
  siguen pasando a `fetch`. Dejan de aceptarse en la estable.
- Las subidas en streaming no necesitan ningún campo extra: con un `body`
  `ReadableStream` (o iterable asíncrono), el cliente pone el `duplex: 'half'`
  que exige fetch. Quita el `duplex` explícito junto con los demás campos de
  `RequestInit`.
- Una variable con tipo `SecureFetchOptions` ya no admite campos de navegador
  (`mode`, `credentials`, `window`...). Quítalos.
- `resolvePublicHost` pasa a llamarse `resolveHost`: resuelve cualquier host y
  deja el veredicto a `assertSafeTarget`. El nombre antiguo queda como alias
  `@deprecated`.

```ts
// Antes
await fetchBuffer(url, { redirect: 'follow', cache: 'no-store', maxBytes })
// Después
await fetchBuffer(url, { maxRedirects: 3, maxBytes })
```

**`@botmesh/graph-core`: un objeto de opciones.** `checkGraphSignature` recibe
`{ body, headers, appSecret, logger }`. La forma posicional sigue funcionando como
sobrecarga `@deprecated`, con los mismos resultados. graph-core es un paquete
público y lo cubre semver como a los demás: un cambio incompatible en él es una
versión mayor.

```ts
// Antes
const sig = checkGraphSignature(rawBody, headers, appSecret, logger)
// Después
const sig = checkGraphSignature({ body: rawBody, headers, appSecret, logger })
```

**`@botmesh/meta`: la fontanería de la ventana de sesión es experimental.** Lo
que una app configura y consulta sigue siendo público y lo cubre semver:
`SessionWindowManager` (constructor, `forScope`, `state`, `isOpen`, `expiresAt`,
`pending`, `clearPending`), `SessionWindowOptions`, el contrato
`SessionWindowStore` y su `MemorySessionWindowStore`, los tipos de informe y de
reapertura, `SessionWindowReopenedError` y las constantes. Los ganchos que mueve
el provider (`send`, `noteInbound`, `noteFailedStatus`) y su tipo `RawSend` pasan
a `@experimental`: pueden cambiar en una versión menor. En ejecución no cambia
nada. Ver [Estabilidad de la API](./ventana-24h#estabilidad-de-la-api).

**`create-botmesh`: internos en `/internal`.** La entrada principal es el
scaffolder: `scaffold`, `sanitizeName`, `getTemplate` y `TEMPLATE_NAMES`.
`TEMPLATES`, `agentsMd`, `findBotMeshMonorepo` y `AgentsMdInfo` pasan a
`create-botmesh/internal` (sin semver); la entrada principal los reexporta como
`@deprecated` hasta la estable. La CLI no cambia.

```ts
// Antes
import { TEMPLATES } from 'create-botmesh'
const files = TEMPLATES.telegram.files('my-bot')
// Después
import { getTemplate } from 'create-botmesh'
const files = getTemplate('telegram').files('my-bot')
```

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

## Siguientes pasos

- [Actualizar a estable: dependencias](./migracion)
- [Actualizar a estable: cambios de comportamiento](./migracion-2)
- [Notas de actualización: canales y plugins](./actualizar-canales-plugins)
