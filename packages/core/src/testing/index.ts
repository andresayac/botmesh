/**
 * `@botmesh/core/testing` — test kit for bots: `MockProvider`, `createTestBot`, the chaos kit
 * (`ChaosProvider`, `withChaos`), identity-contract checks, crash simulation, golden
 * transcripts and in-memory coordinators. Never imported by the engine itself.
 *
 * @packageDocumentation
 */
export { MockProvider } from './MockProvider.js'
export type {
  MockProviderOptions,
  MockProviderSupports,
  MockEdit,
  MockDraft,
  MockOutgoing,
  MockIncomingOptions,
  MockMediaOptions,
  MockMediaSource,
  MockMediaToken,
  MockJournalEntry,
} from './MockProvider.js'
export { createTestBot } from './createTestBot.js'
// Test chat views (createTestBot().chat / dm() / group() / chat.as()).
export { TestKitError, DEFAULT_TEST_USER, DEFAULT_TEST_NAME } from './testChat.js'
export type { TestChat, TestMediaKind, PressedButton, TestTranscriptOptions, TestSent } from './testChat.js'

// chaos-mock: adversarial delivery kit + identity stability contract helpers
export type { TestBot, CreateTestBotOptions } from './createTestBot.js'
export {
  ChaosProvider,
  ChaosDisconnectedError,
  withChaos,
  createSeededRandom,
  cloneInboundEvent,
} from './chaos.js'
export type {
  ChaosOptions,
  ChaosDelay,
  ChaosRange,
  ChaosDuplicateOptions,
  ChaosReorderOptions,
  ChaosSendFailureOptions,
  ChaosSendErrorKind,
  ChaosSendAttempt,
  ChaosErrorFactory,
  ChaosDisconnectOptions,
  ChaosAliasOptions,
  ChaosLogEntry,
} from './chaos.js'
export {
  checkIdentityContract,
  assertStableIdentity,
  IdentityContractError,
  recordEvents,
} from './identityContract.js'
export type {
  IdentityEventInput,
  IdentityExpectation,
  IdentityExpectations,
  IdentityContractOptions,
  IdentityRule,
  IdentityViolation,
  EventRecorder,
} from './identityContract.js'
// Inbound shape contract: epoch-ms timestamps and message fields, for provider suites.
export { checkInboundContract, assertInboundContract, InboundContractError } from './inboundContract.js'
export type { InboundContractInput, InboundContractOptions, InboundRule, InboundViolation } from './inboundContract.js'
// Capability contract: capability flags agree with the optional methods a provider exposes.
export { checkCapabilityContract, assertCapabilityContract, CapabilityContractError } from './capabilityContract.js'
export type { CapabilityRule, CapabilityViolation } from './capabilityContract.js'

// golden-transcripts: record, redact and replay conversations
export {
  TRANSCRIPT_FORMAT,
  TRANSCRIPT_VERSION,
  TranscriptFormatError,
  createTranscript,
  parseTranscript,
  serializeTranscript,
  serializeContent,
  outboundText,
  inboundTurnOf,
  outboundTurnOf,
  transcriptToText,
  transcriptFromMessages,
  transcriptFromStore,
} from './transcripts/format.js'
export type {
  Transcript,
  TranscriptTurn,
  TranscriptInbound,
  TranscriptOutbound,
  TranscriptInboundEvent,
  JsonValue,
  FromMessagesOptions,
  TranscriptMessageSource,
  TranscriptStoreOwner,
} from './transcripts/format.js'
export { recordTranscript, RecordingProvider, DEFAULT_MAX_TURNS } from './transcripts/record.js'
export type { RecordTranscriptOptions, TranscriptRecorder } from './transcripts/record.js'
export { redactTranscript, createRedactionMap } from './transcripts/redact.js'
export type { RedactOptions, RedactionRule, RedactionMap } from './transcripts/redact.js'
export {
  replayTranscript,
  assertTranscript,
  formatReplayReport,
  TranscriptMismatchError,
  REPLAY_MASKS,
} from './transcripts/replay.js'
export type {
  ReplayOptions,
  ReplayResult,
  ReplayBotFactory,
  ReplayMask,
  TranscriptDiff,
} from './transcripts/replay.js'
// Crash simulation for durability (BotConfig.durability) tests.
export { crashable, CrashableProvider } from './crash.js'
export type { CrashableBackend, JournalOp } from './crash.js'
// Multi-replica coordination (BotConfig.coordination) in one process: bots sharing a
// MemoryCoordinationHub coordinate like replicas sharing Redis (`crash()` simulates a dead replica).
export { MemoryCoordinator, MemoryCoordinationHub } from '../coordination/MemoryCoordinator.js'
export type { MemoryCoordinatorOptions } from '../coordination/MemoryCoordinator.js'
// Tracing (BotConfig.telemetry): an in-memory tracer to assert on the spans a bot produced.
export { createRecordingTracer } from './recordingTracer.js'
export type { RecordingTracer, RecordingTracerOptions, RecordedSpan } from './recordingTracer.js'
