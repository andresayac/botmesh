/**
 * `@botmesh/core/spi` — the service-provider interface: what authors of backends and
 * transports build on, kept out of the application entry (`@botmesh/core`).
 *
 * - **Stores** (`IStore`): the message-key helpers, the checkpoint record types, the user-data
 *   rows. Every store runs the shared conformance suite (`test-utils/store-conformance.ts`).
 * - **Durability backends** (`DurabilityBackend`): `KvDurability` over any `DurableKv`, the
 *   reference `MemoryKv`, the inbox/outbox journal contracts and record types, the retry
 *   policy and the errors a backend throws.
 * - **Schedule stores** (`ScheduleStore`): the record types, the reference
 *   `MemoryScheduleStore` and the claim/complete rules every backend must follow.
 * - **Leases and coordinators** (`LeaseProvider`, `Coordinator`): the reference
 *   `MemoryLeaseProvider` and the turn/leadership types.
 * - **Transports** (`IProvider`): `toInboundLocation()`, the native-form helpers and the
 *   built-in message catalog for texts rendered outside a bot.
 * - **Tracer integrations** (`BotTracer`): the no-op tracer and the W3C trace-context helpers.
 *
 * Unlike `@botmesh/core/internal`, everything here follows semver: a breaking change is a
 * major release of `@botmesh/core`.
 *
 * @example
 * ```ts
 * import { KvDurability, MemoryKv, messageKey } from '@botmesh/core/spi'
 * ```
 *
 * @packageDocumentation
 */

// The contracts themselves (also exported by '@botmesh/core', repeated here so a backend
// imports everything it implements from one entry).
export type {
  IStore, StoredMessage, StoredChat, StoredContact, FlowCheckpoint, AIMessage,
} from './store/IStore.js'
export type { IProvider, ProviderCapabilities, InboundEvent, LoggerLike } from './core/types.js'
export type { DurableKv } from './durability/kv.js'
export type { DurabilityBackend } from './durability/types.js'
export type { ScheduleStore } from './scheduler/ScheduleStore.js'
export type { LeaseProvider, SchedulerLease } from './coordination/lease.js'
export type { Coordinator, CoordinatorEvents, Fence, LeaseLossReason } from './coordination/types.js'
export type { BotTracer } from './telemetry/types.js'

// Stores
export { messageKey, legacyMessageKey } from './store/IStore.js'
export type { CheckpointAnswer, CheckpointHandover, UserDataEntry } from './core/provider.js'
export { supportsUserData } from './user/UserDataService.js'
export type { UserDataStore } from './user/UserDataService.js'

// Durability backends
export { KvDurability, KvInbox, KvOutbox } from './durability/journal.js'
export type { KvDurabilityOptions } from './durability/journal.js'
export { MemoryKv, assertKvMutation } from './durability/kv.js'
export type { DurableKvEntry, DurableKvIndex, DurableTable, KvMutation, MemoryKvSnapshot } from './durability/kv.js'
export { StaleLeaseError } from './durability/errors.js'
export { computeBackoff, DEFAULT_BACKOFF } from './durability/backoff.js'
export type {
  InboxJournal, InboxRecord, InboxState, InboxAppend,
  OutboxJournal, OutboxRecord, OutboxState, OutboxPut, OutboxError, ClaimedSend,
  ClaimOptions, LeaseOptions,
} from './durability/types.js'

// Schedule stores
export { MemoryScheduleStore, isScheduleClaimable, applyScheduleComplete } from './scheduler/ScheduleStore.js'
export type { ScheduleRecord, ScheduleKind, ClaimResult, CompletePatch } from './scheduler/ScheduleStore.js'

// Leases and coordinators
export { MemoryLeaseProvider } from './coordination/lease.js'
export type { LeaseGrant } from './coordination/lease.js'
export type { LeaseInfo, Ticket, ChatTurn, Leadership, AcquireTurnOptions } from './coordination/types.js'

// Transports
export { toInboundLocation } from './core/location.js'
export type { InboundLocationInput } from './core/location.js'
export { formReplyBody, parseFormReply } from './forms/reply.js'
export {
  assertFormDefinition, validateFormValues, parseFieldAnswer, parseFormDate,
  formOptionEntries, isFieldRequired, selectionBounds,
} from './forms/validate.js'
export type { FieldCheck, FormFieldError, FormValidation } from './forms/validate.js'
export { I18n, normalizeLocale } from './i18n/I18n.js'
export type { I18nOptions, I18nLogger } from './i18n/I18n.js'

// Tracer integrations
export { noopTracer, NOOP_TRACING, errorTypeOf } from './telemetry/tracing.js'
export { formatTraceparent, parseTraceparent } from './telemetry/w3c.js'
export type { CheckpointTrace } from './telemetry/w3c.js'
