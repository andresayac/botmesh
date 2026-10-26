/**
 * @botmesh/core — transport-agnostic bot engine.
 *
 * Flows, hooks, plugins, conversations, scheduler and DI. Pair it with a
 * transport provider (`@botmesh/baileys` for WhatsApp) and, optionally, a store
 * (`@botmesh/sqlite-store`, `@botmesh/redis-store`) and the `@botmesh/ai` plugin.
 *
 * This entry exports what an application needs: the `Bot`, the flow DSL, the message
 * vocabulary, the option types and the errors an app can catch. The other entries:
 *
 * - `@botmesh/core/testing`: test kit (`createTestBot`, `MockProvider`, chaos kit, golden
 *   transcripts, crash simulation, in-memory coordinators).
 * - `@botmesh/core/spi`: for authors of stores, durability backends, schedule stores,
 *   coordinators, tracer integrations and transports (reference backends, record types,
 *   key and form helpers).
 * - `@botmesh/core/dev`: the `botmesh dev` terminal simulator.
 * - `@botmesh/core/internal`: engine building blocks, with no semver guarantee.
 *
 * @example
 * ```ts
 * import { Bot, flow } from '@botmesh/core'
 * import { BaileysProvider } from '@botmesh/baileys'
 *
 * const bot = new Bot({ provider: new BaileysProvider({ session: 'demo' }) })
 * bot.when('hola', async (ctx) => await ctx.reply('¡Hola! 👋'))
 * await bot.start()
 * ```
 */

// Core
export { Bot } from './core/Bot.js'
export type {
  BotEvents,
  BotEventArgs,
  MessageHandler,
  CommandHandler,
  SubjectDataExport,
  SubjectDeletionResult,
  StopOptions,
  ConversationTarget,
} from './core/Bot.js'

// Transport-agnostic contract + core vocabulary
import type { BotConfig as BotConfigForAlias } from './core/types.js'
/** @deprecated Use {@link BotConfig}: `Config` is an older alias of the same type. */
export type Config = BotConfigForAlias
export type {
  BotConfig,
  BuiltinStoreConfig,
  RateLimitRetryOptions,
  IProvider,
  ProviderCapabilities,
  ConnectionState,
  ConnectionUpdate,
  DisconnectReason,
  ChatId,
  UserId,
  MessageId,
  MessageRef,
  ChatKind,
  ChatInfo,
  SenderInfo,
  DefaultTools,
  InboundEvent,
  InboundLocation,
  InboundMessage,
  InboundInteraction,
  DeliveryStatus,
  InboundReaction,
  QuotedRef,
  GroupEvent,
  PresenceEvent,
  CallEvent,
  PollVote,
  Button,
  ListSection,
  SendOptions,
  OutboundContent,
  SendResult,
  MediaSource,
  MediaRef,
  MediaPayload,
  MessageContext,
  MessageType,
  SentMessage,
  StoreKind,
  LoggerLike,
  // Hooks / plugins / triggers / scheduler / conversations
  HookEvent,
  HookHandler,
  HookErrorHandler,
  HookPhase,
  HookContextMap,
  HookContextOf,
  HookBeforeContext,
  HookRegistration,
  SendHookContext,
  AnyHookHandler,
  Plugin,
  PluginContext,
  PluginSpec,
  SyncInstallError,
  ScheduledTask,
  BroadcastResult,
  Trigger,
  TriggerObject,
  TriggerScope,
  MatchStrategy,
  WaitOptions,
} from './core/types.js'
export {
  ProviderError,
  UnsupportedContentError,
  RateLimitedError,
  RecipientUnreachableError,
  PayloadTooLargeError,
  MediaTooLargeError,
  OutsideSessionWindowError,
} from './core/types.js'
export { MediaUnavailableError } from './core/mediaRefs.js'
export type { SerializedMediaRef, MediaUnavailableReason } from './core/mediaRefs.js'
export type { ContextI18n, InboundListener, StreamingMode, TextFormat, DraftOptions } from './core/provider.js'

// Flows DSL
export { flow, addKeyword, FlowBuilder, isCompiledFlow } from './flows/FlowBuilder.js'
export type { CompiledFlow, CompiledStep, DynamicText, FlowAction } from './flows/FlowBuilder.js'
export type {
  EmptyFlowState,
  FlowControls,
  FlowStateWith,
  FlowStateMerge,
  FlowStateOf,
  FlowGuard,
  FlowDelay,
  SayStepOptions,
  AskStepOptions,
  ChooseStepOptions,
  ChooseOption,
  GuardFailure,
  CompiledAskOptions,
  CompiledChooseOption,
} from './flows/FlowBuilder.js'
export { FLOW_MEDIA_KINDS, isFlowMediaKind } from './flows/media.js'
export type { FlowMediaKind, FlowFileMediaKind, FlowLocation, FlowMediaOptions, FlowMediaSource, DynamicMediaSource } from './flows/media.js'
export type { SchemaLike, SchemaParseResult, SchemaIssueLike, InferSchema } from './flows/schema.js'
export type { SchemaWaitOptions } from './conversations/controls.js'

// Conversations
export type { ConversationHandler } from './conversations/handler.js'
export type {
  /**
   * @deprecated Use {@link ConversationHandler}, the handler type of `bot.conversation()` (its
   * `ctx` is the full `MessageContext`). This is the runtime's narrower function type (the one
   * `ConversationRegistration.fn` records), kept so code typed with it still compiles.
   */
  ConversationFn,
} from './conversations/ConversationRuntime.js'
export type {
  RuntimeMessage,
  ConversationControlsBase,
  ResolvedWaitOptions,
  ConversationRegistration,
  ConversationObserver,
  ConversationSnapshot,
  WaitAccepts,
  ConversationOutcome,
  EnterOptions,
  ConversationStartInfo,
  ConversationEndInfo,
} from './conversations/ConversationRuntime.js'
export type { ConversationControls, WaitMediaType } from './conversations/controls.js'
export {
  ConversationError,
  ConversationTimeout,
  ConversationCancelled,
  ConversationEnded,
  ConversationGoto,
  RetriesExceeded,
  ConcurrentWaitError,
} from './conversations/errors.js'
export { ConversationRetry, RetryUnavailableError } from './conversations/retry.js'
export type { IdleCallback } from './conversations/idle.js'
export type { IdleHandler, IdleEvent } from './core/idle.js'

// Plugins
export { definePlugin, isPlugin } from './plugins/definePlugin.js'
export { slashCommandsPlugin } from './plugins/slashCommands.js'
export type { SlashCommandsConfig } from './plugins/slashCommands.js'

// Store: the IStore contract an app passes as `BotConfig.store` (store authors: '@botmesh/core/spi')
export { MemoryStore } from './store/MemoryStore.js'
export type { IStore, AIMessage, StoredMessage, StoredChat, StoredContact, FlowCheckpoint } from './store/IStore.js'
export type { MemoryStoreOptions, MemoryStoreLogger } from './store/MemoryStore.js'
export { NamespacedStore } from './store/NamespacedStore.js'
export type { StoreNamespace } from './store/NamespacedStore.js'

// Config validation
export { validateConfig, ConfigValidationError } from './utils/validateConfig.js'
export { BotNotRunningError, InvalidProviderEventError } from './core/errors.js'

// Durations and timeouts
export { parseDuration, TimeoutError } from './utils/timers.js'

// Scheduler (bot.schedule / every / delay; BotConfig.scheduler)
export type { DurableTaskOptions, DurableTaskHandler, ScheduledRun, MissedRunPolicy, CronTaskOptions } from './core/types.js'
export type { ScheduleStore, SchedulerOptions } from './scheduler/ScheduleStore.js'
export type { LeaseProvider, SchedulerLease } from './coordination/lease.js'

// Flow inspection (bot.describe / bot.lint / bot.flowInventory)
export { describeFlows } from './flows/describe.js'
export type {
  DescribeOptions,
  FlowGraph,
  FlowGraphFlow,
  FlowGraphNode,
  FlowGraphNodeKind,
  FlowGraphEdge,
  FlowGraphEdgeKind,
  FlowGraphGroup,
  FlowGraphOption,
  FlowGraphTimeoutSource,
  FlowGraphFormInfo,
} from './flows/describe.js'
export { lintFlows } from './flows/lint.js'
export type { LintCode, LintDiagnostic, LintOptions, LintSeverity } from './flows/lint.js'
export { describeTrigger } from './flows/inventory.js'
export type {
  FlowInventory,
  FlowInventoryProvider,
  FlowRoute,
  FlowSource,
  TriggerInfo,
  TriggerPatternInfo,
} from './flows/inventory.js'

// Access lists and human handoff
export { AccessList } from './gates/accessList.js'
export {
  /**
   * @deprecated The class of `bot.whitelist` (an {@link AccessList} with an on/off mode). Use the
   * instance on the bot (`bot.whitelist`) and never construct one; to name its type, write
   * `Bot['whitelist']`.
   */
  Whitelist,
} from './gates/accessList.js'
export type {
  AccessDecision,
  AccessListAction,
  AccessListChange,
  AccessListName,
  AccessListSnapshot,
  AccessListsSnapshot,
  WhitelistSnapshot,
} from './gates/accessList.js'
export type {
  HandoffConfig,
  HandoffEvent,
  HandoffOptions,
  HandoffState,
  ResumeEvent,
  ResumeOptions,
  StoredHandoff,
} from './gates/handoff.js'

// Type triggers
export {
  WELCOME,
  MEDIA,
  IMAGE,
  VIDEO,
  AUDIO,
  VOICE_NOTE,
  DOCUMENT,
  STICKER,
  LOCATION,
  CONTACT,
  POLL,
  CALL,
  typeTrigger,
  isTypeTrigger,
  isWelcomeTrigger,
} from './core/triggers.js'
export type { TypeTrigger, WelcomeTrigger } from './core/triggers.js'

// Bot factory pattern shared by `npm start` and the `botmesh dev` simulator ('@botmesh/core/dev').
export { defineBot, isBotFactory, isMainModule } from './dev/defineBot.js'
export type { BotFactory } from './dev/defineBot.js'

// Inbound idempotency and echo filter options (BotConfig.dedupe / BotConfig.echoFilter)
export type { InboundDedupeOptions } from './core/dedupe.js'
export type { EchoFilterOptions } from './core/echo.js'

// ctx.user: per-user data
export { userOf } from './user/UserDataService.js'
export { UserDataError } from './user/errors.js'
export type { UserDataErrorCode } from './user/errors.js'
export type { UserData, UserSetOptions } from './user/types.js'

// Messaging: typing indicator (BotConfig.typing), reply options, ctx.edit / ctx.react
export { PacedSendCancelled } from './core/messaging.js'
export type { TypingConfig, ReplyOptions, EditOptions, EditResult, MessagingFeature, MessagingSupport } from './core/messaging.js'
export type { JsonValue } from './core/json.js'

// Operations: bot.broadcast(), bot.trigger(), bot.metrics() + Prometheus exporter
export type { BroadcastOptions, BroadcastFailure, BroadcastProgress } from './ops/broadcast.js'
export type { TriggerOptions, TriggerResult, TriggerSkipReason, TriggerRaw } from './ops/trigger.js'
export type { BotMetricsSnapshot, ConversationCounters, ConversationStartedEvent, ConversationEndedEvent } from './ops/metrics.js'
export { toPrometheus, PROMETHEUS_CONTENT_TYPE } from './ops/prometheus.js'
export type { PrometheusOptions } from './ops/prometheus.js'

// i18n: bot.locale(), ctx.t() / c.t(), ctx.setLang() and the built-in core messages
export { CORE_MESSAGES, BUILTIN_LOCALES } from './i18n/builtins.js'
export type { CoreMessageKey } from './i18n/builtins.js'
export type {
  I18nConfig,
  LanguageDetector,
  LangSource,
  LocaleMessages,
  PluralCategory,
  PluralForms,
  Translate,
  TranslateParams,
} from './i18n/types.js'

// Dynamic flow registry: bot.registerFlow / unregisterFlow / replaceFlow / listFlows
export type { FlowTriggerOptions, FlowTriggerTarget, RegisteredFlowInfo } from './core/flowRegistry.js'

// Streaming: ctx.stream() and the text helpers behind it
export { streamText } from './streaming/streamText.js'
export { splitMessage } from './streaming/split.js'
export type { SplitTextOptions } from './streaming/split.js'
export type { StreamSource, StreamStrategy, StreamOptions, StreamResult, StreamTarget } from './streaming/types.js'

// Native forms: flow().form(definition) (provider renderers: '@botmesh/core/spi')
export type {
  FormDefinition, FormField, FormFieldType, FormOptions, FormValue, FormValues, FormReply,
  FormMode, FormStepOptions, FormContent, FormFieldBase,
  TextFormField, NumberFormField, EmailFormField, DateFormField, SelectFormField,
  MultiSelectFormField, OptInFormField,
} from './forms/types.js'

// Media: lazily download an inbound message's media (populates ctx.media)
export { loadMediaOf } from './core/context.js'
export type { LoadMediaOptions } from './core/context.js'

// Multi-replica coordination (BotConfig.coordination). Backends: RedisCoordinator in
// @botmesh/redis-store; the in-memory ones live in '@botmesh/core/testing'.
export { LeaseLostError, CoordinationUnavailableError, ProviderNotLeaderError } from './coordination/index.js'
export type {
  Coordinator, CoordinationConfig, Fence, LeaseLossReason, CoordinatorEvents,
  ConversationHandoverConfig, ConversationHandoverEvent, HandoverFallback, HandoverContext, InterruptedConversation,
} from './coordination/index.js'

// Durable message processing (BotConfig.durability). Backend authors: '@botmesh/core/spi'.
export { MemoryDurability } from './durability/memory.js'
export { FileDurability } from './durability/file.js'
export type { FileDurabilityOptions } from './durability/file.js'
export type { DurableKv } from './durability/kv.js'
export { SendDeferredError } from './durability/errors.js'
export type { DurabilityControl, DurabilityMetrics } from './durability/engine.js'
export type { DurabilityConfig, DurabilityBackend, RetryBackoff } from './durability/types.js'

// Telemetry (BotConfig.telemetry, bot.tracing): the BotTracer contract an integration
// implements (OpenTelemetry: @botmesh/otel) and the attribute names.
export { TRACE_ATTR, SPAN_NAMES } from './telemetry/attributes.js'
export type {
  BotTracer, BotTracing, BotSpan, SpanOptions, SpanKind, SpanStatus, SpanLink, SpanContextRef, SpanException,
  TraceAttributes, TraceAttributeValue, TelemetryConfig,
} from './telemetry/types.js'

// Golden transcripts: deprecated here; they live in '@botmesh/core/testing'.
export {
  /** @deprecated Import from '@botmesh/core/testing'. */
  TRANSCRIPT_FORMAT,
  /** @deprecated Import from '@botmesh/core/testing'. */
  TRANSCRIPT_VERSION,
  /** @deprecated Import from '@botmesh/core/testing'. */
  TranscriptFormatError,
  /** @deprecated Import from '@botmesh/core/testing'. */
  createTranscript,
  /** @deprecated Import from '@botmesh/core/testing'. */
  parseTranscript,
  /** @deprecated Import from '@botmesh/core/testing'. */
  serializeTranscript,
  /** @deprecated Import from '@botmesh/core/testing'. */
  transcriptFromMessages,
  /** @deprecated Import from '@botmesh/core/testing'. */
  transcriptFromStore,
} from './testing/transcripts/format.js'
export type {
  /** @deprecated Import from '@botmesh/core/testing'. */
  Transcript,
  /** @deprecated Import from '@botmesh/core/testing'. */
  TranscriptTurn,
  /** @deprecated Import from '@botmesh/core/testing'. */
  TranscriptInbound,
  /** @deprecated Import from '@botmesh/core/testing'. */
  TranscriptOutbound,
  /** @deprecated Import from '@botmesh/core/testing'. */
  FromMessagesOptions,
  /** @deprecated Import from '@botmesh/core/testing'. */
  TranscriptMessageSource,
  /** @deprecated Import from '@botmesh/core/testing'. */
  TranscriptStoreOwner,
} from './testing/transcripts/format.js'
export {
  /** @deprecated Import from '@botmesh/core/testing'. */
  recordTranscript,
  /** @deprecated Import from '@botmesh/core/testing'. */
  RecordingProvider,
  /** @deprecated Import from '@botmesh/core/testing'. */
  DEFAULT_MAX_TURNS,
} from './testing/transcripts/record.js'
export type {
  /** @deprecated Import from '@botmesh/core/testing'. */
  RecordTranscriptOptions,
  /** @deprecated Import from '@botmesh/core/testing'. */
  TranscriptRecorder,
} from './testing/transcripts/record.js'
export {
  /** @deprecated Import from '@botmesh/core/testing'. */
  redactTranscript,
  /** @deprecated Import from '@botmesh/core/testing'. */
  createRedactionMap,
} from './testing/transcripts/redact.js'
export type {
  /** @deprecated Import from '@botmesh/core/testing'. */
  RedactOptions,
  /** @deprecated Import from '@botmesh/core/testing'. */
  RedactionRule,
  /** @deprecated Import from '@botmesh/core/testing'. */
  RedactionMap,
} from './testing/transcripts/redact.js'
