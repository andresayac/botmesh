# Migrating to the stable API

`@botmesh/core` 2.0 freezes its public API. Before that, the last alphas
trimmed the main entry and picked one name per concept. This page lists every
change an alpha user may hit, with the replacement. Most renames keep a
`@deprecated` alias, so your editor shows a strike-through and the code still
runs. The few hard breaks are marked **Breaking**.

Moving from an alpha to stable is covered by four pages; read all that apply:

- this page: package entries, canonical names and configuration (API surface);
- [behaviour changes](/guide/migration-2): English default texts, `retries` vs
  `maxAttempts`, sends before `start()`, log ids, append-log corruption;
- [dependencies and names](/guide/migration): Baileys/ffmpeg, Graph `v26.0`,
  `redis` as a peer, AI SDKs and default models, `botwa` → `botmesh`;
- [channels and plugins](/guide/upgrade-channels-plugins): per-channel fixes,
  plus the cross-channel contract (epoch-ms timestamps, long-text splitting,
  absent methods for unsupported operations) in
  [Channels](/guide/channels).

## Package entries

The main entry (`@botmesh/core`) now exports only what an application needs:
512 names before, 372 after (368 after the trim, plus `BotNotRunningError`, `InvalidProviderEventError`, `RateLimitRetryOptions` and `SplitTextOptions` from the other stable changes). Everything else moved to a subpath:

| Import from | What it holds |
| --- | --- |
| `@botmesh/core` | The `Bot`, the flow DSL, the message types, the options and the errors you can catch. |
| `@botmesh/core/testing` | Test kit, golden transcripts, crash simulation, `MemoryCoordinator` / `MemoryCoordinationHub`. |
| `@botmesh/core/spi` | **New.** For authors of stores, durability backends, schedule stores, coordinators, tracer integrations and transports. Covered by semver. |
| `@botmesh/core/internal` | Engine classes and helpers. No semver guarantee. |

**Breaking:** the names below are no longer exported by `@botmesh/core`.
Change the import path; the values are the same.

| Names | Import from |
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
| `buildMessageContext`, `createControls`, `createPacer`, `runBroadcast`, `runFormStep`, `resolveFormMode`, `newFormToken`, `MetricsCollector`, `formatUptime`, `ExternalSendClock`, `TYPING_REFRESH_MS`, `normalizeTypingConfig`, `resolveReplyTyping`, `typingDuration`, `parseReplyDelay` | `@botmesh/core/internal` (the deprecated main-entry re-exports were removed) |

```ts
// Before: Bot, KvDurability, MemoryKv and MemoryCoordinator all came from '@botmesh/core'.
// After:
import { Bot } from '@botmesh/core'
import { KvDurability, MemoryKv } from '@botmesh/core/spi'
import { MemoryCoordinator } from '@botmesh/core/testing'
```

Some types the engine moved still appear in signatures an application uses, so the
main entry keeps them: `MessagingFeature` and `MessagingSupport` (`ctx.supports()`),
`ResolvedWaitOptions` (`ConversationControlsBase.waitAny()`) and `JsonValue` (the
shape of `SerializedMediaRef.data` and of the journal records; `@botmesh/core/spi`
exports it too). Import them from `@botmesh/core`, not from `/internal` or `/testing`.

The golden-transcript helpers (`recordTranscript`, `RecordingProvider`,
`redactTranscript`, `transcriptFromStore`, `parseTranscript`…) are still
re-exported by `@botmesh/core`, but deprecated: import them from
`@botmesh/core/testing`.

## One name per concept

These aliases keep working and are marked `@deprecated`:

| Deprecated | Use |
| --- | --- |
| `ctx.say(text)`, `ctx.answer(text)`, `ctx.text(text)` | `ctx.reply(text)` (the flow DSL's `.say()` step is unchanged) |
| `addKeyword(trigger)` | `flow(trigger)` |
| `bot.sendText(chatId, text)`, `bot.sendTo(chatId, content)` | `bot.send(chatId, content)` |
| `bot.use(plugin)` | `bot.plug(plugin)` (`bot.use()` is for flows) |
| `bot.useFlow(flow)` | `bot.use(flow)`, or `bot.registerFlow(flow)` to get the id back |
| `bot.triggerFlow(id, { chatId }, { data })` | `bot.trigger(id, { chatId, data, ifActive: 'replace' })` (`result.started` is the old boolean) |
| `bot.enterConversation('name', ctx)` | `bot.trigger('name', { chatId: ctx.from, userId: ctx.sender, isGroup: ctx.isGroup, ifActive: 'replace' })` |
| `bot.onImage(h)`, `onAudio`, `onVideo`, `onDocument`, `onSticker`, `onLocation`, `onContact`, `onPoll` | `bot.onType('image', h)` or `bot.when(IMAGE, h)` |
| `Config` | `BotConfig` |
| `Whitelist` (the class) | `bot.whitelist`, typed `Bot['whitelist']`; the concept is `AccessList` |
| `ConversationFn` | `ConversationHandler` |
| `durability: { journal }` | `durability: { backend }` |
| `storeConfig: { file }` | `store: new MemoryStore({ file })` |

`bot.enterConversation(handler, ctx)` with an inline handler is not
deprecated: it is the way to start a conversation that is not registered.

`BotConfig.storeConfig` now has a type (`file`, `maxMessagesPerChat`,
`autoSaveInterval`), and the bot logs a warning when it is set. Setting
`durability.backend` and `durability.journal` to two different backends
throws a `ConfigValidationError`.

## Plugins: one instance per name

**Breaking:** `bot.plug()` throws when a plugin with the same `name` is already
plugged. Before, the second instance was installed too and both ran their
handlers. To plug a plugin again, call the unplug function first. A plugin
built to run several times sets `multiple: true` in its spec:

```ts
definePlugin({ name: 'webhook', version: '1.0.0', multiple: true, install(ctx) { /* … */ } })
```

## Durations

Every duration option of `BotConfig` takes a duration string or a number of
milliseconds, including all `*Ms` options. `typing.minMs`, `typing.maxMs` and
the durability `backoff.baseMs` / `backoff.capMs` accepted only numbers before;
they now accept `'800ms'`, `'1s'` and so on.

**Breaking (stricter validation):** `new Bot()` now parses every duration
option and throws a `ConfigValidationError` naming it
(`err.field === 'coordination.turnWaitMs'`) when a value cannot be read. Before,
some invalid values only failed later, with a message that did not name the
option, and `null` was accepted for a few of them.

## Logger

The `LoggerLike` contract is unchanged, and its calling convention is now
documented: the packages call `logger.warn('message')` or
`logger.warn({ err, ...context }, 'message')`, as pino does. See
[Logger](./concepts#logger).

## Channel and store packages

The public channel and store packages follow the same rule: one name per concept,
the old one kept as a `@deprecated` alias until v3.

| Package | Deprecated | Use |
| --- | --- | --- |
| `@botmesh/telegram` | `pollTimeout` (seconds) | `pollTimeoutMs` |
| `@botmesh/telegram` | `toProviderError` | `toTelegramError` |
| `@botmesh/telegram`, `@botmesh/meta`, `@botmesh/baileys` | `debug: true` | `logger` (any `LoggerLike`) |
| `@botmesh/baileys` | `pairingCode` | `pairingPhoneNumber` (same value: the bot's phone number) |
| `@botmesh/baileys` | JID helpers (`isGroup`, `isPn`, `isLid`, `normalizeJid`, `sameUser`, `toUserId`, `toChatId`…), `IdentityStore`, `toMediaUpload`, `mediaToBuffer`, `makeSticker`, `transcodeToOpus`, `resolveRemoteMedia`, `classifyDisconnect`, `backoffDelay`, the session-path helpers and `toBaileysLogger` on the main entry | the same names from `@botmesh/baileys/internal` (no semver); `toJid` stays on the main entry |
| `@botmesh/meta` | `toProviderError(chatId, err, retryAfterMs)` | `toGraphError(err, { chatId, retryAfterMs })` from `@botmesh/graph-core` |
| `@botmesh/meta` | `verifyChallenge`, `verifySignature` re-exports | `provider.verifyChallenge(query)` / `provider.ingest()`, or `@botmesh/graph-core` |
| `@botmesh/meta` | `GraphClient` | the provider's methods, or `graphRequest` from `@botmesh/graph-core` |
| `@botmesh/sqlite-store` | `SCHEDULES_SCHEMA`, `DURABLE_SCHEMA` | nothing: the store creates and migrates its tables |
| `@botmesh/graph-core` | `checkGraphSignature(body, headers, appSecret, logger?)` | `checkGraphSignature({ body, headers, appSecret, logger })` |
| `@botmesh/http` | `resolvePublicHost` | `resolveHost` (same function; it never filtered private answers) |
| `@botmesh/http` | `RequestInit` fields other than `method`, `headers`, `body`, `signal` | nothing: drop them (see below) |
| `create-botmesh` | `TEMPLATES`, `agentsMd`, `findBotMeshMonorepo`, `AgentsMdInfo` from the main entry | `getTemplate()` / `TEMPLATE_NAMES`, or `create-botmesh/internal` (no semver) |

Every provider's low-level error mapper is now named `to<Channel>Error`; the private
channels got the same renames (`toDiscordError`, `toMessengerError`,
`toInstagramError`, `toTikTokError`, `toEmailError`). The behaviour changes of these
packages (Telegram poll votes, Discord edits, SQLite schema versioning) are in
[Upgrade notes: channels & plugins](./upgrade-channels-plugins).

### `@botmesh/baileys`: entries and native types

The main entry keeps what an application needs (`BaileysProvider`, its options,
`toJid`, `isEditedMessage`, `RateLimiter`, the `PollStore` types). The rest moved
to `@botmesh/baileys/internal`, which has no semver guarantee; the old names stay on
the main entry as `@deprecated` aliases until v3.

- **Breaking:** `toInbound` and `toOutbound` are no longer exported by
  `@botmesh/baileys`: their signatures use Baileys' own types. Import them from
  `@botmesh/baileys/internal`.
- **Breaking (types only):** Baileys' native values are opaque. `provider.socket`
  is `BaileysSocket | null`, `provider.auth` is `BaileysAuthState`, and the `raw` /
  `native` of messages, refs and send results are `BaileysNativeMessage`; the three are
  `unknown` aliases. Nothing changes at runtime. Use `socketOf(provider)` and
  `authStateOf(provider)` from `@botmesh/baileys/internal` for typed handles, or cast
  with your own `@whiskeysockets/baileys` import:

  ```ts
  // before
  const sock = provider.socket
  // after
  import { socketOf } from '@botmesh/baileys/internal'
  const sock = socketOf(provider)
  ```

- The JID predicates (`isGroup`, `isPn`, `isLid`, `isBroadcast`, `isNewsletter`)
  return `boolean` instead of `boolean | undefined` (`undefined` is now `false`).
- `pairingCode` is renamed `pairingPhoneNumber` (the value was always the phone
  number); passing both with different numbers throws a `TypeError`.

## `@botmesh/ai` entries

`@botmesh/ai` got the same split as core: 135 names on the main entry before, 97 after.

| Import from | What it holds |
| --- | --- |
| `@botmesh/ai` | `aiPlugin`, `AIClient`, the providers and the client contracts they take (`AnthropicLike`, `OpenAILike`, `GeminiLike`, `GeminiModelLike`, `GoogleGenAILike`), tools, confirmations, memory, RAG types, `formatMarkdown`. |
| `@botmesh/ai/testing` | **New.** `MockAIProvider` (with `MockOptions`, `MockTurn`) and `validateArgs` (with `ArgsValidation`), to unit-test a tool's schema. Covered by semver. |
| `@botmesh/ai/internal` | **New.** The plugin's helpers and the names of the SDK request/response shapes. No semver guarantee. |

`MockAIProvider`, `MockOptions` and `MockTurn` are still re-exported by `@botmesh/ai`, but
deprecated: import them from `@botmesh/ai/testing`.

**Breaking:** the names below are no longer exported by `@botmesh/ai`. Change the import
path; the values are the same.

| Names | Import from |
| --- | --- |
| `validateArgs`, `ArgsValidation` | `@botmesh/ai/testing` |
| `aiText`, `defaultConfirmPrompt`, `DEFAULT_MAX_STEPS`, `DEFAULT_TOOL_TIMEOUT_MS`, `toolDefinitions`, `parametersOf`, `isAffirmative`, `humanizeName`, `toolTitle`, `ToolLedger`, `stableKey`, `DEFAULT_DEDUPE_WINDOW_MS`, `DEFAULT_LEDGER_RETENTION_MS` | `@botmesh/ai/internal` |
| `toGeminiSchema`, `DEFAULT_MEMORY_NAMESPACE`, `factsSchema`, `parseFacts`, `DEFAULT_RAG_INSTRUCTIONS`, `ragContextBlock`, `citedChunks`, `citedPassages`, `formatSources` | `@botmesh/ai/internal` |
| `AnthropicMessage`, `AnthropicContentBlock`, `AnthropicUsage`, `AnthropicStreamEvent`, `AnthropicRequestOptions`, `OpenAIChatCompletion`, `OpenAIChoice`, `OpenAIStreamChunk`, `OpenAIToolCall`, `OpenAIRequestOptions`, `GeminiResponse`, `GeminiUsage`, `GeminiPart`, `GeminiFunctionCall`, `GeminiRequestOptions`, `GoogleGenAIResponse` | `@botmesh/ai/internal` (types) |

The client contracts did not change shape: their request and response types are now written
inline, so a fake client typed `AnthropicLike` (or `OpenAILike`, `GeminiLike`…) compiles as
before. To name a response shape, derive it from the contract or import it from `/internal`:

```ts
import type { AnthropicLike } from '@botmesh/ai'
type Reply = Awaited<ReturnType<AnthropicLike['messages']['create']>>
```

**Breaking (frozen data):** `PRESETS`, `DEFAULT_YES`, `DEFAULT_NO`, `AI_MESSAGES` and
`AI_LOCALES` are deep-frozen, and typed `readonly`. Changing them used to change the defaults
of every bot in the process; now it throws a `TypeError` in strict mode. Extend a copy:

```ts
aiPlugin({ toolConfirm: { yes: [...DEFAULT_YES, 'arre'] } })
```

Passing them unchanged still compiles (`toolConfirm.yes`/`.no` accept a `readonly string[]`).

Provider constructors now take an `AIProviderConfig` (`model`, `maxTokens`, `effort`,
`thinking`, `baseUrl`), the part of `AIConfig` a provider reads. Passing a whole `AIConfig`
held in a variable still compiles, but an **object literal** with plugin fields now fails
TypeScript's excess-property check (`TS2353`), because providers never read them:

```ts
new AnthropicProvider(client, { model, persona })   // before: compiled; now: TS2353
new AnthropicProvider(client, { model })            // drop the plugin fields
new AnthropicProvider(client, cfg)                  // or pass a variable typed AIConfig
```
`GenerateInput.onStreamEnd` receives a named `AIStreamEndInfo`; its contract
(once, after the last chunk, only on a normal end) is in
[Upgrade notes: channels & plugins](./upgrade-channels-plugins#botmesh-ai).

## HTTP, Graph and scaffolder packages

**`@botmesh/http`: closed `SecureFetchOptions`.** The options of `secureFetch` and
`fetchBuffer` no longer extend `RequestInit`. They hold the request fields the
client honours (`method`, `headers`, `body`, `signal`) and its policy
(`allowHttp`, `allowPrivateHosts`, `timeoutMs`, `maxBytes`, `maxRedirects`,
`resolver`, `fetch`).

- **Breaking (types only):** `redirect` is gone. It was always overridden with
  `'manual'`, because the client follows redirects itself and validates each
  hop; use `maxRedirects` (`0` refuses any redirect).
- The other `RequestInit` fields (`cache`, `keepalive`, `integrity`...) still
  type-check through a `@deprecated` overload (`LegacySecureFetchOptions`) and
  are still forwarded to `fetch`. They stop being accepted at stable.
- Streaming uploads need no extra field: with a `ReadableStream` (or async
  iterable) `body`, the client sets the `duplex: 'half'` that fetch requires.
  Drop an explicit `duplex` along with the other `RequestInit` fields.
- A variable typed `SecureFetchOptions` no longer accepts browser fields
  (`mode`, `credentials`, `window`...). Remove them.
- `resolvePublicHost` is now `resolveHost`: it resolves any host and leaves the
  verdict to `assertSafeTarget`. The old name stays as a `@deprecated` alias.

```ts
// Before
await fetchBuffer(url, { redirect: 'follow', cache: 'no-store', maxBytes })
// After
await fetchBuffer(url, { maxRedirects: 3, maxBytes })
```

**`@botmesh/graph-core`: one options object.** `checkGraphSignature` takes
`{ body, headers, appSecret, logger }`. The positional form keeps working as a
`@deprecated` overload with the same results. graph-core is a public package and
is covered by semver like the others: a breaking change in it is a major bump.

```ts
// Before
const sig = checkGraphSignature(rawBody, headers, appSecret, logger)
// After
const sig = checkGraphSignature({ body: rawBody, headers, appSecret, logger })
```

**`@botmesh/meta`: session-window plumbing is experimental.** What an app
configures and queries stays public and covered by semver:
`SessionWindowManager` (constructor, `forScope`, `state`, `isOpen`, `expiresAt`,
`pending`, `clearPending`), `SessionWindowOptions`, the `SessionWindowStore`
contract and its `MemorySessionWindowStore`, the report and reopen types,
`SessionWindowReopenedError` and the constants. The hooks the provider drives
(`send`, `noteInbound`, `noteFailedStatus`) and their `RawSend` type are now
`@experimental`: they may change in a minor release. Nothing changes at runtime.
See [API stability](./session-window#api-stability).

**`create-botmesh`: internals in `/internal`.** The main entry is the
scaffolder: `scaffold`, `sanitizeName`, `getTemplate` and `TEMPLATE_NAMES`.
`TEMPLATES`, `agentsMd`, `findBotMeshMonorepo` and `AgentsMdInfo` moved to
`create-botmesh/internal` (no semver); the main entry re-exports them as
`@deprecated` until stable. The CLI does not change.

```ts
// Before
import { TEMPLATES } from 'create-botmesh'
const files = TEMPLATES.telegram.files('my-bot')
// After
import { getTemplate } from 'create-botmesh'
const files = getTemplate('telegram').files('my-bot')
```

## Sandbox API token

`@botmesh/sandbox` is private, but scripts that drive its web API change:

- **Breaking:** `POST /api/<channel>/send|fault|status|reset` now needs the
  per-run token in the `x-sandbox-token` header. Read it from `sandbox.token`
  (or the CLI output), or fix it with `startSandbox({ token })` / `--token`.
- Requests whose `Host` is not loopback, or whose `Origin` is another site, get
  a 403. Pass `allowedHosts` / `--allow-host` when the hub is reached through
  another name on purpose.
- Bad input is now a 4xx: unknown fields, wrong types and a body that is not a
  JSON object are refused, and `toUserInput()` throws `SandboxInputError`.
