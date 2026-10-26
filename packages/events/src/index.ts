/**
 * @botmesh/events — versioned event envelopes, leased journals with fencing tokens, an
 * at-least-once worker with retries and a dead-letter state. No dependency on `@botmesh/core`;
 * the bot durability backend lives in `@botmesh/events/durability`.
 */
export {
  createEnvelope,
  EventNotFoundError,
  StaleLeaseError,
  MemoryEventJournal,
  FileEventJournal,
  SharedFileEventJournal,
  EventWorker,
  exponentialBackoff,
} from './journal.js'
export type {
  EventContext,
  EventEnvelope,
  CreateEnvelopeInput,
  EventRecordState,
  EventRecord,
  ClaimEventOptions,
  AckEventOptions,
  FailEventOptions,
  ReleaseEventOptions,
  EventLease,
  AppendEventOptions,
  ListEventOptions,
  PurgeEventOptions,
  JournalSidecar,
  SidecarHandle,
  EventJournal,
  LeasedEventJournal,
  SidecarUpdate,
  FileEventJournalOptions,
  SharedFileEventJournalOptions,
  EventHandler,
  EventWorkerOptions,
  EventBatchResult,
} from './journal.js'
export type { AppendLogOptions } from './fileLog.js'
