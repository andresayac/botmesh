/**
 * Entry layout of `@botmesh/core` (see docs/release-readiness.md, "API freeze"): the main entry
 * holds only what an application needs; engine internals live in `/internal` (no semver), the
 * backend/transport SPI in `/spi`, test doubles in `/testing`. The runtime names of the main
 * entry are pinned here so that growing it is a deliberate change.
 */
import { describe, expect, it } from 'vitest'

import * as main from '../src/index.js'
import * as internal from '../src/internal.js'
import * as spi from '../src/spi.js'
import * as testing from '../src/testing/index.js'

/** Every runtime (value) export of the main entry. Types are checked by `pnpm api-check`. */
const MAIN_VALUES = [
  'AUDIO', 'AccessList', 'BUILTIN_LOCALES', 'Bot', 'CALL', 'CONTACT', 'CORE_MESSAGES', 'ConcurrentWaitError',
  'ConfigValidationError', 'ConversationCancelled', 'ConversationEnded', 'ConversationError', 'ConversationGoto',
  'ConversationRetry', 'ConversationTimeout', 'CoordinationUnavailableError', 'DOCUMENT', 'FLOW_MEDIA_KINDS',
  'FileDurability', 'FlowBuilder', 'IMAGE', 'LOCATION', 'LeaseLostError', 'MEDIA', 'MediaTooLargeError',
  'MediaUnavailableError', 'MemoryDurability', 'MemoryStore', 'NamespacedStore', 'OutsideSessionWindowError', 'POLL',
  'PROMETHEUS_CONTENT_TYPE', 'PacedSendCancelled', 'PayloadTooLargeError', 'ProviderError', 'ProviderNotLeaderError',
  'RateLimitedError', 'RecipientUnreachableError', 'RetriesExceeded', 'RetryUnavailableError', 'SPAN_NAMES', 'STICKER',
  'SendDeferredError', 'TRACE_ATTR', 'TimeoutError', 'UnsupportedContentError', 'UserDataError', 'VIDEO', 'VOICE_NOTE',
  'WELCOME', 'addKeyword', 'defineBot', 'definePlugin', 'describeFlows', 'describeTrigger', 'flow', 'isBotFactory',
  'isCompiledFlow', 'isFlowMediaKind', 'isMainModule', 'isPlugin', 'isTypeTrigger', 'isWelcomeTrigger', 'lintFlows',
  'loadMediaOf', 'parseDuration', 'slashCommandsPlugin', 'splitMessage', 'streamText', 'toPrometheus', 'typeTrigger',
  'userOf', 'validateConfig',
] as const

/** Deprecated re-exports kept on the main entry for alpha users (their home is `/testing` or `/internal`). */
const MAIN_DEPRECATED_VALUES = [
  'DEFAULT_MAX_TURNS', 'RecordingProvider', 'TRANSCRIPT_FORMAT', 'TRANSCRIPT_VERSION', 'TranscriptFormatError',
  'createRedactionMap', 'createTranscript', 'parseTranscript', 'recordTranscript', 'redactTranscript',
  'serializeTranscript', 'transcriptFromMessages', 'transcriptFromStore', 'Whitelist',
] as const

/** Engine internals that used to be re-exported (deprecated) by the main entry, now only in `/internal`. */
const FORMER_DEPRECATED_INTERNALS = [
  'buildMessageContext', 'createControls', 'createPacer', 'runBroadcast', 'runFormStep',
  'newFormToken', 'resolveFormMode', 'resolveReplyTyping', 'normalizeTypingConfig',
  'typingDuration', 'parseReplyDelay', 'ExternalSendClock', 'MetricsCollector',
  'formatUptime', 'TYPING_REFRESH_MS',
] as const

/** Engine classes and helpers moved from the main entry to `/internal`. */
const MOVED_TO_INTERNAL = [
  'Dispatcher', 'ConversationRuntime', 'HookSystem', 'Scheduler', 'InboundDeduper', 'createInboundDeduper',
  'inboundDedupeKey', 'DEFAULT_DEDUPE_SIZE', 'SentRefRing', 'createEchoFilter', 'DEFAULT_ECHO_FILTER_SIZE',
  'UserDataService', 'DEFAULT_USER_NAMESPACE', 'checkAccess', 'HANDOFF_INDEX_KEY', 'validateHandoffConfig',
  'messagingSupport', 'DEFAULT_TYPING', 'isSchemaLike', 'DEFAULT_SCHEMA_MESSAGE', 'resolveStreamStrategy',
  'findSplitPoint', 'withFormDefaults', 'providerLanguageOf', 'cronNextRun', 'sleep', 'humanTypingDelay',
  'withTimeout', 'randomId',
] as const

/** Backend and transport SPI moved from the main entry to `/spi`. */
const MOVED_TO_SPI = [
  'KvDurability', 'KvInbox', 'KvOutbox', 'MemoryKv', 'StaleLeaseError', 'computeBackoff', 'DEFAULT_BACKOFF',
  'MemoryScheduleStore', 'isScheduleClaimable', 'applyScheduleComplete', 'MemoryLeaseProvider', 'messageKey',
  'legacyMessageKey', 'supportsUserData', 'toInboundLocation', 'formReplyBody', 'parseFormReply',
  'assertFormDefinition', 'validateFormValues', 'parseFieldAnswer', 'parseFormDate', 'formOptionEntries',
  'isFieldRequired', 'selectionBounds', 'I18n', 'normalizeLocale', 'noopTracer', 'NOOP_TRACING', 'errorTypeOf',
  'formatTraceparent', 'parseTraceparent',
] as const

const keysOf = (ns: object) => Object.keys(ns).sort()

describe('@botmesh/core entry layout', () => {
  it('the main entry exports exactly the application values (plus the deprecated re-exports)', () => {
    expect(keysOf(main)).toEqual([...MAIN_VALUES, ...MAIN_DEPRECATED_VALUES].sort())
  })

  it('no engine internal is reachable from the main entry any more', () => {
    for (const name of [...FORMER_DEPRECATED_INTERNALS, ...MOVED_TO_INTERNAL, 'pauseControls']) {
      expect(internal[name as keyof typeof internal], name).toBeDefined()
      expect((main as Record<string, unknown>)[name], name).toBeUndefined()
    }
  })

  it('the SPI lives in /spi only', () => {
    for (const name of MOVED_TO_SPI) {
      expect(spi[name as keyof typeof spi], name).toBeDefined()
      expect((main as Record<string, unknown>)[name], name).toBeUndefined()
      expect((internal as Record<string, unknown>)[name], name).toBeUndefined()
    }
    // New in /spi (never on the main entry): the row check a backend runs when restoring a KV snapshot.
    expect(keysOf(spi)).toEqual([...MOVED_TO_SPI, 'assertKvMutation'].sort())
  })

  it('the in-memory coordinators live in /testing', () => {
    expect(testing.MemoryCoordinator).toBeDefined()
    expect(testing.MemoryCoordinationHub).toBeDefined()
    expect((main as Record<string, unknown>).MemoryCoordinator).toBeUndefined()
    expect((main as Record<string, unknown>).MemoryCoordinationHub).toBeUndefined()
  })

  it('each deprecated main re-export is the very same value as its home', () => {
    for (const name of MAIN_DEPRECATED_VALUES) {
      const home = name === 'Whitelist' ? (internal as Record<string, unknown>) : (testing as Record<string, unknown>)
      expect((main as Record<string, unknown>)[name], name).toBe(home[name])
    }
    expect(main.Bot).toBeDefined()
  })
})
