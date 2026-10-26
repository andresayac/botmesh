/**
 * `@botmesh/core/internal` — engine internals.
 *
 * Building blocks the `Bot` is made of: the dispatcher, the conversation runtime, the hook
 * system, the scheduler, the inbound deduper and echo filter, the context builder, the reply
 * pacer, the broadcast engine, the metrics collector, the native-form runner and their
 * helpers. They are exported for engine work, custom bots and advanced tests. **No semver
 * guarantee:** any of them may change or disappear in a minor release. Applications use the
 * `Bot` API from `@botmesh/core`; backend and transport authors use `@botmesh/core/spi`.
 *
 * @example
 * ```ts
 * import { createPacer, MetricsCollector } from '@botmesh/core/internal'
 * ```
 *
 * @packageDocumentation
 */

// Dispatcher, context builder, hooks
export { Dispatcher } from './core/Dispatcher.js'
export type {
  DispatchContext,
  DispatcherDeps,
  HooksLike,
  MessageHandler as DispatcherMessageHandler,
  CommandHandler as DispatcherCommandHandler,
} from './core/Dispatcher.js'
export { buildMessageContext } from './core/context.js'
export type { BuildContextDeps } from './core/provider.js'
export { HookSystem } from './hooks/HookSystem.js'
export type { RegisteredHook, HookLogger, HookSystemOptions } from './hooks/HookSystem.js'

// Conversation runtime
export { ConversationRuntime } from './conversations/ConversationRuntime.js'
export type {
  ConversationFn,
  RuntimeConfig,
  ResolvedWaitOptions,
  ConversationHandle,
  CheckpointStore,
  ConversationTraceHooks,
  ConversationTurnTrace,
} from './conversations/ConversationRuntime.js'
export type { AnswerCodec, RuntimeHandover, RuntimeHandoverFallback } from './conversations/handover.js'
export { createControls } from './conversations/controls.js'
// A cancellable pause for code that runs steps on the conversation controls, such as the JSON
// flow interpreter of `@botmesh/flow-schema`.
export { pauseControls } from './conversations/retry.js'
export { isSchemaLike, DEFAULT_SCHEMA_MESSAGE } from './flows/schema.js'

// Messaging: reply pacing and typing
export {
  TYPING_REFRESH_MS,
  DEFAULT_TYPING,
  ExternalSendClock,
  createPacer,
  normalizeTypingConfig,
  resolveReplyTyping,
  typingDuration,
  parseReplyDelay,
  messagingSupport,
} from './core/messaging.js'
export type {
  ResolvedTypingConfig,
  MessagingFeature,
  MessagingSupport,
  Pacer,
  PacerOptions,
  PaceGuard,
  PacerLogger,
} from './core/messaging.js'
export { resolveStreamStrategy } from './streaming/streamText.js'
export { findSplitPoint } from './streaming/split.js'

// Inbound idempotency and echo filter
export { InboundDeduper, createInboundDeduper, inboundDedupeKey, DEFAULT_DEDUPE_SIZE } from './core/dedupe.js'
export type { InboundDeduperOptions, InboundDedupeKey } from './core/dedupe.js'
export { SentRefRing, createEchoFilter, DEFAULT_ECHO_FILTER_SIZE } from './core/echo.js'
export type { SentRefRingOptions } from './core/echo.js'

// Access lists and handoff
export { Whitelist, checkAccess } from './gates/accessList.js'
export { HANDOFF_INDEX_KEY, validateHandoffConfig } from './gates/handoff.js'

// Operations
export { runBroadcast } from './ops/broadcast.js'
export type { BroadcastDeps } from './ops/broadcast.js'
export { MetricsCollector, formatUptime } from './ops/metrics.js'

// Native forms
export { runFormStep, resolveFormMode } from './forms/runForm.js'
export { newFormToken } from './forms/reply.js'
export { withFormDefaults } from './forms/defaults.js'

// i18n resolution
export { providerLanguageOf } from './i18n/I18n.js'

// Per-user data service (ctx.user)
export { UserDataService, DEFAULT_USER_NAMESPACE } from './user/UserDataService.js'
export type { UserDataServiceOptions } from './user/UserDataService.js'

// Scheduler
export { Scheduler } from './scheduler/Scheduler.js'
export { cronNextRun } from './scheduler/cron.js'
export type { TaskTraceHooks, TaskRunInfo } from './scheduler/tracing.js'

// Timers
export { sleep, humanTypingDelay, withTimeout, randomId } from './utils/timers.js'
