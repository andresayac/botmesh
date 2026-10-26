/**
 * Journals, envelopes and the worker of `@botmesh/events` (the public names are re-exported by
 * `index.ts`; the `__testing` seam stays here).
 */
import { randomUUID } from 'node:crypto'
import { link, mkdir, open, readFile, realpath, rename, rm, stat, utimes } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { AppendLog, appendLogOptions, syncDirectory, writeSnapshotFile, type AppendLogOptions, type AppendLogReplay } from './fileLog.js'

export interface EventContext {
  tenantId: string
  environmentId: string
  botId: string
  providerId: string
  connectionId: string
  chatId?: string
  participantId?: string
}

export interface EventEnvelope<TPayload = unknown> {
  eventId: string
  eventType: string
  schemaVersion: number
  occurredAt: number
  context: EventContext
  correlationId: string
  causationId?: string
  idempotencyKey: string
  partitionKey: string
  payload: TPayload
}

export interface CreateEnvelopeInput<TPayload> {
  eventId?: string
  eventType: string
  schemaVersion?: number
  occurredAt?: number
  context: EventContext
  correlationId?: string
  causationId?: string
  idempotencyKey?: string
  partitionKey?: string
  payload: TPayload
}

const REQUIRED_CONTEXT = ['tenantId', 'environmentId', 'botId', 'providerId', 'connectionId'] as const

/**
 * Build an envelope with defaults (`eventId` a random UUID, `correlationId` and `idempotencyKey`
 * the `eventId`, `partitionKey` `tenant/bot/connection/chat`, `occurredAt` now).
 * @throws {TypeError} when `eventType` or a required `context` id is missing, or `occurredAt`
 *   is not a finite number.
 */
export function createEnvelope<TPayload>(input: CreateEnvelopeInput<TPayload>): EventEnvelope<TPayload> {
  if (typeof input?.eventType !== 'string' || !input.eventType.trim()) throw new TypeError('createEnvelope(): eventType is required (a non-empty string)')
  if (!Number.isInteger(input.schemaVersion ?? 1) || (input.schemaVersion ?? 1) <= 0) {
    throw new Error('schemaVersion must be a positive integer')
  }
  if (input.occurredAt !== undefined && (typeof input.occurredAt !== 'number' || !Number.isFinite(input.occurredAt))) {
    throw new TypeError(`createEnvelope(): occurredAt must be a finite number (epoch ms; got ${String(input.occurredAt)})`)
  }
  if (typeof input.context !== 'object' || input.context === null) {
    throw new TypeError('createEnvelope(): context is required ({ tenantId, environmentId, botId, providerId, connectionId })')
  }
  for (const field of REQUIRED_CONTEXT) {
    if (typeof input.context[field] !== 'string') throw new TypeError(`createEnvelope(): context.${field} is required (a non-empty string)`)
  }
  for (const [field, value] of Object.entries(input.context)) {
    if (field.endsWith('Id') && typeof value === 'string' && value.trim() === '') {
      throw new Error(`context.${field} must not be empty`)
    }
  }

  const eventId = input.eventId ?? randomUUID()
  const correlationId = input.correlationId ?? eventId
  const partitionKey = input.partitionKey ??
    [
      input.context.tenantId,
      input.context.botId,
      input.context.connectionId,
      input.context.chatId ?? 'global',
    ].join('/')

  return {
    eventId,
    eventType: input.eventType,
    schemaVersion: input.schemaVersion ?? 1,
    occurredAt: input.occurredAt ?? Date.now(),
    context: { ...input.context },
    correlationId,
    causationId: input.causationId,
    idempotencyKey: input.idempotencyKey ?? eventId,
    partitionKey,
    payload: input.payload,
  }
}

export type EventRecordState = 'pending' | 'processing' | 'failed' | 'done' | 'dead'

export interface EventRecord<TPayload = unknown> {
  envelope: EventEnvelope<TPayload>
  state: EventRecordState
  attempts: number
  nextAttemptAt: number
  leaseUntil?: number
  /**
   * Fencing token of the latest claim. Strictly increasing per event (never
   * reused, not even after `replay`); 0 or absent if it was never claimed.
   * Pass it back to `ack`/`fail` so a worker whose lease expired cannot
   * complete an event another worker has since re-claimed.
   */
  fencingToken?: number
  lastError?: string
  completedAt?: number
  /** Holder of the current lease (claims made with `owner`). */
  owner?: string
  /**
   * Isolation channel. Records appended with a channel (e.g. the bot's durable inbox, see
   * `@botmesh/events/durability`) are only claimed or purged by callers naming that channel,
   * so an {@link EventWorker} never runs them. `list()` still shows every record.
   */
  channel?: string
}

export interface ClaimEventOptions {
  now?: number
  leaseMs?: number
  /** Lease holder recorded on each claimed record. */
  owner?: string
  /** Also take `owner`'s own unexpired leases (a restarted process with a stable owner id). */
  reclaimOwn?: boolean
  /** Only records of this channel. Omitted: only records without a channel (today's behaviour). */
  channel?: string
  /** Only records passing this predicate. */
  filter?: (record: EventRecord) => boolean
  /** `'partition'` (default): by partition key, then age. `'occurredAt'`: oldest first across partitions. */
  order?: 'partition' | 'occurredAt'
}

export interface AckEventOptions {
  now?: number
  /**
   * Token from the claim being acknowledged. When set, the call is rejected
   * with {@link StaleLeaseError} unless the event is still `processing` under
   * this same token. Omit it only for operator overrides.
   */
  fencingToken?: number
}

export interface FailEventOptions extends AckEventOptions {
  maxAttempts?: number
  retryDelayMs?: number
  /**
   * Explicit outcome (instead of `maxAttempts`/`retryDelayMs`): `true` dead-letters the event
   * now (and records `completedAt`); otherwise it is retried at {@link retryAt}.
   */
  dead?: boolean
  /** Explicit retry time (epoch ms); default `now`. Setting it (or `dead`) skips the attempt count. */
  retryAt?: number
}

export interface ReleaseEventOptions extends AckEventOptions {
  /** Always back to `pending`, due `now` (default: `failed` if it failed before, never later than it was due). */
  toPending?: boolean
}

/** Lease parameters of {@link LeasedEventJournal.claimOne} / {@link AppendEventOptions.lease}. */
export interface EventLease {
  now: number
  leaseMs: number
  owner: string
}

/** Options of {@link LeasedEventJournal.appendRecord}. */
export interface AppendEventOptions {
  /** When the new record becomes due. Default: the envelope's `occurredAt`. */
  now?: number
  /** Isolation channel of the record (see {@link EventRecord.channel}). */
  channel?: string
  /** Create the record already claimed (`processing`, token 1, 1 attempt) under this lease. */
  lease?: EventLease
}

/** Options of {@link LeasedEventJournal.list}. */
export interface ListEventOptions {
  state?: EventRecordState
  /** Default 100; `Infinity` for every record. */
  limit?: number
  /** Only records of this channel. Omitted: every record. */
  channel?: string
  filter?: (record: EventRecord) => boolean
}

/** Options of {@link LeasedEventJournal.purge}. */
export interface PurgeEventOptions {
  /** Delete `done` records completed before this time (epoch ms). */
  doneBefore: number
  /** Also delete `dead` records completed before `doneBefore`. */
  includeDead?: boolean
  /** Only records of this channel. Omitted: only records without a channel. */
  channel?: string
  filter?: (record: EventRecord) => boolean
}

/** Side state stored with the journal's records, in the same atomic snapshot (see {@link LeasedEventJournal.sidecar}). */
export interface JournalSidecar {
  snapshot(): unknown
  restore(data: unknown): void
}

/** Returned by {@link LeasedEventJournal.sidecar}: call `changed()` after every write of the side state. */
export interface SidecarHandle {
  changed(): Promise<void>
}

/** The event does not exist (fenced operations, `replay`). */
export class EventNotFoundError extends Error {
  constructor(readonly eventId: string) {
    super(`Event ${eventId} does not exist`)
    this.name = 'EventNotFoundError'
  }
}

/**
 * Raised by a fenced `ack`/`fail` whose claim was superseded: the lease
 * expired and another worker re-claimed the event, or the event already left
 * `processing` (acknowledged, failed or replayed).
 */
export class StaleLeaseError extends Error {
  constructor(
    readonly eventId: string,
    readonly fencingToken: number,
    readonly currentToken: number,
    readonly state: EventRecordState,
  ) {
    super(`Stale lease for event ${eventId}: token ${fencingToken} (current ${currentToken}, state ${state})`)
    this.name = 'StaleLeaseError'
  }
}

/**
 * Persistence boundary. SQL/Redis adapters can implement this contract without
 * changing workers or the control plane.
 */
export interface EventJournal {
  append<TPayload>(envelope: EventEnvelope<TPayload>): Promise<boolean>
  get(eventId: string): Promise<EventRecord | undefined>
  /** Lease up to `limit` due events; each returned record carries a fresh `fencingToken`. */
  claim(limit: number, options?: ClaimEventOptions): Promise<EventRecord[]>
  /** Mark done. With `fencingToken`, rejects with {@link StaleLeaseError} if the claim was superseded. */
  ack(eventId: string, options?: AckEventOptions): Promise<void>
  /** Schedule a retry or dead-letter the event. Fenced like `ack`. */
  fail(eventId: string, error: unknown, options?: FailEventOptions): Promise<void>
  /**
   * Hand back a claim whose handler never ran: the event becomes due again
   * right away and the claim's attempt is not charged. Fenced like `ack`.
   */
  release(eventId: string, options?: AckEventOptions): Promise<void>
  replay(eventId: string, now?: number): Promise<void>
  list(options?: { state?: EventRecordState; limit?: number }): Promise<EventRecord[]>
}

/**
 * An {@link EventJournal} with the atomic, fenced operations a durability backend needs
 * (`@botmesh/events/durability`): channel isolation, owner-aware claims, single-record claims,
 * lease extension, purge and side state persisted with the records. Every operation is
 * atomic: two claimers can never get the same record, and a completion is accepted only
 * under the fencing token of the current claim.
 */
export interface LeasedEventJournal extends EventJournal {
  /** Only one process uses this journal at a time (memory; a locked file). */
  readonly exclusive?: boolean
  /**
   * Insert-if-absent by `eventId` or `idempotencyKey`; on conflict the existing record is
   * returned unchanged (`'duplicate'`).
   */
  appendRecord<TPayload>(envelope: EventEnvelope<TPayload>, options?: AppendEventOptions): Promise<{ status: 'appended' | 'duplicate'; record: EventRecord }>
  /** Lease one record when it is claimable (as `claim`); `null` otherwise. */
  claimOne(eventId: string, lease: EventLease): Promise<EventRecord | null>
  /** Extend the current lease (heartbeat). Rejects with {@link StaleLeaseError} unless `fencingToken` is the current claim. */
  extend(eventId: string, options: { fencingToken: number; leaseUntil: number }): Promise<void>
  /** Delete old terminal records; returns the count. */
  purge(options: PurgeEventOptions): Promise<number>
  release(eventId: string, options?: ReleaseEventOptions): Promise<void>
  list(options?: ListEventOptions): Promise<EventRecord[]>
  /**
   * Register side state persisted atomically with the records (same snapshot). Its saved
   * data, if any, is restored before this returns. A name is registered once per journal.
   */
  sidecar?(name: string, state: JournalSidecar): SidecarHandle
  /**
   * Multi-process journals (no `sidecar`): read named side state from the current snapshot
   * (`undefined` when absent). Used with {@link updateSidecar}.
   */
  readSidecar?(name: string): Promise<unknown>
  /**
   * Multi-process journals: update named side state atomically (under the same cross-process
   * exclusion as the records). `update` gets the current data; returning `data` writes it,
   * returning only `result` writes nothing.
   */
  updateSidecar?<T>(name: string, update: SidecarUpdate<T>): Promise<T>
}

/** See {@link LeasedEventJournal.updateSidecar}. */
export type SidecarUpdate<T> = (data: unknown) => { data?: unknown; result: T } | Promise<{ data?: unknown; result: T }>

function claimable(record: EventRecord, now: number, owner: string | undefined, reclaimOwn: boolean): boolean {
  if (record.state === 'pending' || record.state === 'failed') return record.nextAttemptAt <= now
  if (record.state === 'processing') {
    return (record.leaseUntil ?? 0) <= now || (reclaimOwn && owner !== undefined && record.owner === owner)
  }
  return false
}

function lease(record: EventRecord, now: number, leaseMs: number, owner: string | undefined): void {
  record.state = 'processing'
  record.leaseUntil = now + leaseMs
  record.attempts++
  record.fencingToken = (record.fencingToken ?? 0) + 1
  if (owner !== undefined) record.owner = owner
  else delete record.owner
}

/** A finite number (time or duration), checked before a journal call changes anything. */
function checkFinite(value: number | undefined, name: string, who: string, min = Number.NEGATIVE_INFINITY, exclusiveMin = false): void {
  if (value === undefined) return
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || (exclusiveMin && value === min)) {
    const bound = min === Number.NEGATIVE_INFINITY ? 'a finite number' : exclusiveMin ? `a finite number above ${min}` : `a finite number >= ${min}`
    throw new TypeError(`${who}: ${name} must be ${bound} (got ${String(value)})`)
  }
}

function checkLease(lease: EventLease | undefined, who: string): void {
  if (!lease) return
  checkFinite(lease.now, 'lease.now', who)
  checkFinite(lease.leaseMs, 'lease.leaseMs', who, 0, true)
  checkOwner(lease.owner, 'lease.owner', who)
}

/** A lease holder is stored with the record (and written by file journals): a string or nothing. */
function checkOwner(owner: unknown, name: string, who: string): void {
  if (owner !== undefined && typeof owner !== 'string') throw new TypeError(`${who}: ${name} must be a string (got ${typeof owner})`)
}

/**
 * A JSON copy of `envelope`: what a file journal writes and reads back. Checked before the
 * journal changes anything, so a payload that cannot be stored never poisons later writes.
 * @throws {TypeError} for a payload JSON cannot hold (a BigInt, a circular reference).
 */
function jsonEnvelope<TPayload>(envelope: EventEnvelope<TPayload>): EventEnvelope<TPayload> {
  let text: string | undefined
  try {
    text = JSON.stringify(envelope)
  } catch (error) {
    throw new TypeError(`event ${String(envelope?.eventId)} is not JSON-serializable (${(error as Error).message}): file journals store JSON, so convert BigInt values and remove circular references from the payload`)
  }
  if (text === undefined) throw new TypeError('event envelope is not JSON-serializable')
  const stored = JSON.parse(text) as EventEnvelope<TPayload>
  // What is written must be the same event: a toJSON that rewrites the identity (or a value JSON
  // turns into something else, such as NaN into null) would store a different record.
  for (const field of ['eventId', 'eventType', 'idempotencyKey', 'partitionKey', 'occurredAt'] as const) {
    if (!Object.is(stored?.[field], envelope[field])) {
      throw new TypeError(`event ${String(envelope.eventId)}: envelope.${field} changes when serialized to JSON (a toJSON method, or a value JSON cannot hold): file journals store JSON`)
    }
  }
  return stored
}

export class MemoryEventJournal implements LeasedEventJournal {
  /** A memory journal is only ever used by the process that holds it. */
  readonly exclusive = true
  private records = new Map<string, EventRecord>()
  private idempotency = new Map<string, string>()
  private sidecars = new Set<string>()

  async append<TPayload>(envelope: EventEnvelope<TPayload>): Promise<boolean> {
    return (await this.appendRecord(envelope)).status === 'appended'
  }

  async appendRecord<TPayload>(envelope: EventEnvelope<TPayload>, options: AppendEventOptions = {}): Promise<{ status: 'appended' | 'duplicate'; record: EventRecord }> {
    checkFinite(options.now, 'now', 'appendRecord()')
    checkLease(options.lease, 'appendRecord()')
    if (typeof envelope !== 'object' || envelope === null) throw new TypeError('appendRecord(): envelope must be an object')
    if (options.channel !== undefined && typeof options.channel !== 'string') throw new TypeError('appendRecord(): channel must be a string')
    const existing = this.records.get(envelope.eventId) ?? this.records.get(this.idempotency.get(envelope.idempotencyKey) ?? '')
    if (existing) return { status: 'duplicate', record: structuredClone(existing) }
    const record: EventRecord<TPayload> = {
      // A copy: a caller mutating its envelope later must not change the stored record.
      envelope: structuredClone(envelope),
      state: 'pending',
      attempts: 0,
      nextAttemptAt: options.now ?? envelope.occurredAt,
      ...(options.channel !== undefined ? { channel: options.channel } : {}),
    }
    if (options.lease) lease(record as EventRecord, options.lease.now, options.lease.leaseMs, options.lease.owner)
    // The rules the snapshot reader applies: nothing stored here can make a file journal refuse
    // to reopen, and no record is stored that could never be claimed (a NaN due time).
    const why = recordProblem(record)
    if (why) throw new TypeError(`appendRecord(): invalid event ${String(envelope.eventId)}: ${why}`)
    this.records.set(envelope.eventId, record as EventRecord)
    this.idempotency.set(envelope.idempotencyKey, envelope.eventId)
    return { status: 'appended', record: structuredClone(record as EventRecord) }
  }

  async get(eventId: string): Promise<EventRecord | undefined> {
    const record = this.records.get(eventId)
    return record ? structuredClone(record) : undefined
  }

  async claim(limit: number, options: ClaimEventOptions = {}): Promise<EventRecord[]> {
    checkFinite(options.now, 'now', 'claim()')
    checkFinite(options.leaseMs, 'leaseMs', 'claim()', 0, true)
    checkOwner(options.owner, 'owner', 'claim()')
    const now = options.now ?? Date.now()
    const leaseMs = options.leaseMs ?? 30_000
    if (!Number.isInteger(limit) || limit <= 0) throw new Error('claim limit must be a positive integer')
    const byAge = options.order === 'occurredAt'
    const available = [...this.records.values()]
      .filter((record) =>
        record.channel === options.channel &&
        claimable(record, now, options.owner, options.reclaimOwn === true) &&
        (!options.filter || options.filter(structuredClone(record))))
      .sort((a, b) => byAge
        ? a.envelope.occurredAt - b.envelope.occurredAt || (a.envelope.eventId < b.envelope.eventId ? -1 : a.envelope.eventId > b.envelope.eventId ? 1 : 0)
        : a.envelope.partitionKey.localeCompare(b.envelope.partitionKey) || a.envelope.occurredAt - b.envelope.occurredAt)
      .slice(0, limit)
    for (const record of available) lease(record, now, leaseMs, options.owner)
    return structuredClone(available)
  }

  async claimOne(eventId: string, options: EventLease): Promise<EventRecord | null> {
    checkLease(options, 'claimOne()')
    const record = this.records.get(eventId)
    if (!record || !claimable(record, options.now, options.owner, false)) return null
    lease(record, options.now, options.leaseMs, options.owner)
    return structuredClone(record)
  }

  async extend(eventId: string, options: { fencingToken: number; leaseUntil: number }): Promise<void> {
    checkFinite(options.leaseUntil, 'leaseUntil', 'extend()')
    this.fenced(eventId, options.fencingToken).leaseUntil = options.leaseUntil
  }

  async ack(eventId: string, options: AckEventOptions = {}): Promise<void> {
    checkFinite(options.now, 'now', 'ack()')
    const record = this.fenced(eventId, options.fencingToken)
    const now = options.now ?? Date.now()
    record.state = 'done'
    record.completedAt = now
    record.leaseUntil = undefined
    record.lastError = undefined
    delete record.owner
  }

  async fail(eventId: string, error: unknown, options: FailEventOptions = {}): Promise<void> {
    checkFinite(options.now, 'now', 'fail()')
    checkFinite(options.retryDelayMs, 'retryDelayMs', 'fail()', 0)
    checkFinite(options.retryAt, 'retryAt', 'fail()')
    if (options.maxAttempts !== undefined && (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1)) {
      throw new TypeError(`fail(): maxAttempts must be a positive integer (got ${String(options.maxAttempts)})`)
    }
    const record = this.fenced(eventId, options.fencingToken)
    const maxAttempts = options.maxAttempts ?? 5
    const now = options.now ?? Date.now()
    record.lastError = error instanceof Error ? error.message : String(error)
    record.leaseUntil = undefined
    delete record.owner
    if (options.dead !== undefined || options.retryAt !== undefined) {
      if (options.dead) {
        record.state = 'dead'
        record.completedAt = now
      } else {
        record.state = 'failed'
        record.nextAttemptAt = options.retryAt ?? now
      }
      return
    }
    if (record.attempts >= maxAttempts) {
      record.state = 'dead'
      // Like an explicit `dead: true`: purge({ includeDead }) keys on completedAt.
      record.completedAt = now
      return
    }
    record.state = 'failed'
    record.nextAttemptAt = now + (options.retryDelayMs ?? exponentialBackoff(record.attempts))
  }

  async release(eventId: string, options: ReleaseEventOptions = {}): Promise<void> {
    checkFinite(options.now, 'now', 'release()')
    const record = this.fenced(eventId, options.fencingToken)
    if (record.state !== 'processing') return
    const now = options.now ?? Date.now()
    record.state = options.toPending || record.lastError === undefined ? 'pending' : 'failed'
    record.attempts = Math.max(0, record.attempts - 1)
    record.leaseUntil = undefined
    record.nextAttemptAt = options.toPending ? now : Math.min(record.nextAttemptAt, now)
    delete record.owner
  }

  async replay(eventId: string, now = Date.now()): Promise<void> {
    checkFinite(now, 'now', 'replay()')
    const record = this.required(eventId)
    record.state = 'pending'
    record.attempts = 0
    record.nextAttemptAt = now
    record.leaseUntil = undefined
    record.lastError = undefined
    record.completedAt = undefined
    delete record.owner
  }

  async list(options: ListEventOptions = {}): Promise<EventRecord[]> {
    const limit = options.limit ?? 100
    if (typeof limit !== 'number' || !(limit === Number.POSITIVE_INFINITY || (Number.isInteger(limit) && limit >= 0))) {
      throw new TypeError(`list(): limit must be a non-negative integer or Infinity (got ${String(limit)})`)
    }
    return structuredClone(
      [...this.records.values()]
        .filter((record) => !options.state || record.state === options.state)
        .filter((record) => options.channel === undefined || record.channel === options.channel)
        .filter((record) => !options.filter || options.filter(structuredClone(record)))
        .sort((a, b) => a.envelope.occurredAt - b.envelope.occurredAt)
        .slice(0, limit),
    )
  }

  async purge(options: PurgeEventOptions): Promise<number> {
    if (typeof options?.doneBefore !== 'number' || Number.isNaN(options.doneBefore)) {
      throw new TypeError(`purge(): doneBefore must be a number (epoch ms; got ${String(options?.doneBefore)})`)
    }
    let n = 0
    for (const [eventId, record] of this.records) {
      if (record.channel !== options.channel) continue
      const terminal = record.state === 'done' || (options.includeDead === true && record.state === 'dead')
      if (!terminal || record.completedAt === undefined || record.completedAt >= options.doneBefore) continue
      if (options.filter && !options.filter(structuredClone(record))) continue
      this.records.delete(eventId)
      if (this.idempotency.get(record.envelope.idempotencyKey) === eventId) this.idempotency.delete(record.envelope.idempotencyKey)
      n++
    }
    return n
  }

  sidecar(name: string, _state: JournalSidecar): SidecarHandle {
    if (this.sidecars.has(name)) throw new Error(`sidecar ${name} is already registered on this journal`)
    this.sidecars.add(name)
    return { changed: async () => {} }
  }

  /** The record, after checking that `token` (when given) still owns its lease. */
  private fenced(eventId: string, token: number | undefined): EventRecord {
    const record = this.required(eventId)
    if (token === undefined) return record
    const current = record.fencingToken ?? 0
    if (record.state !== 'processing' || current !== token) {
      throw new StaleLeaseError(eventId, token, current, record.state)
    }
    return record
  }

  private required(eventId: string): EventRecord {
    const record = this.records.get(eventId)
    if (!record) throw new EventNotFoundError(eventId)
    return record
  }

  snapshot(): EventRecord[] { return structuredClone([...this.records.values()]) }
  static fromSnapshot(records: EventRecord[]): MemoryEventJournal {
    const journal = new MemoryEventJournal()
    for (const record of records) {
      journal.records.set(record.envelope.eventId, structuredClone(record))
      journal.idempotency.set(record.envelope.idempotencyKey, record.envelope.eventId)
    }
    return journal
  }
}

/** Options of {@link FileEventJournal.open}. */
export interface FileEventJournalOptions {
  /**
   * Take a `<file>.lock` advisory lock holding this process's pid, so a second process cannot
   * open the same journal while this one is alive (a lock left by a dead process is taken
   * over; nothing is ever killed). Within one process, a second locked `open()` of the same
   * file is refused until the first journal is closed. Required by
   * `@botmesh/events/durability`. Default `false`.
   */
  lock?: boolean
  /**
   * `fsync` every snapshot before it replaces the previous one (and the directory after the
   * rename, where the platform allows it), so a power loss cannot leave an empty or partial
   * journal. Default `false` (atomic temp file + rename, possibly still in the OS cache).
   */
  fsync?: boolean
}

const RECORD_STATES: ReadonlySet<string> = new Set<EventRecordState>(['pending', 'processing', 'failed', 'done', 'dead'])

const finite = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v)
const count = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= 0

/**
 * Why `value` is not a journal record (`undefined` when it is one). Applied to every record a
 * journal stores (`appendRecord`) and to every record a snapshot or append log holds, so a
 * record that opens is one the journal can claim, fence and complete.
 */
function recordProblem(value: unknown): string | undefined {
  const r = value as Partial<EventRecord> | null
  if (typeof r !== 'object' || r === null) return 'not an object'
  const e = r.envelope as Partial<EventEnvelope> | undefined
  if (typeof e !== 'object' || e === null) return 'no envelope'
  for (const field of ['eventId', 'eventType', 'idempotencyKey', 'partitionKey'] as const) {
    if (typeof e[field] !== 'string') return `envelope.${field} is not a string`
  }
  if (!finite(e.occurredAt)) return 'envelope.occurredAt is not a finite number'
  if (typeof e.context !== 'object' || e.context === null || Array.isArray(e.context)) return 'envelope.context is not an object'
  if (typeof r.state !== 'string' || !RECORD_STATES.has(r.state)) return `unknown state ${JSON.stringify(r.state)}`
  if (!count(r.attempts)) return 'attempts is not a non-negative integer'
  if (!finite(r.nextAttemptAt)) return 'nextAttemptAt is not a finite number'
  // undefined (in memory) and null are "no value"; JSON drops the first.
  if (r.leaseUntil != null && !finite(r.leaseUntil)) return 'leaseUntil is not a finite number'
  if (r.fencingToken != null && !count(r.fencingToken)) return 'fencingToken is not a non-negative integer'
  if (r.completedAt != null && !finite(r.completedAt)) return 'completedAt is not a finite number'
  if (r.lastError != null && typeof r.lastError !== 'string') return 'lastError is not a string'
  if (r.owner !== undefined && typeof r.owner !== 'string') return 'owner is not a string'
  if (r.channel !== undefined && typeof r.channel !== 'string') return 'channel is not a string'
  return undefined
}

/**
 * Parse a journal snapshot (format version 1 or 2, plus the append-log sequence).
 * @throws {Error} naming `filePath` and the problem when it is not one.
 */
function parseSnapshot(text: string, filePath: string): { records: EventRecord[]; sidecars: Record<string, unknown>; logSeq?: number } {
  const invalid = (why: string) => new Error(`invalid event journal snapshot ${filePath}: ${why}. Restore it from a backup (or move it aside to start empty).`)
  let parsed: { version?: number; records?: EventRecord[]; sidecars?: unknown; logSeq?: unknown }
  try {
    parsed = JSON.parse(text) as typeof parsed
  } catch (error) {
    throw invalid(`not JSON (${(error as Error).message})`)
  }
  const okSidecars = parsed?.version === 1 || (typeof parsed?.sidecars === 'object' && parsed.sidecars !== null && !Array.isArray(parsed.sidecars))
  const okLogSeq = parsed?.logSeq === undefined || (typeof parsed.logSeq === 'number' && Number.isInteger(parsed.logSeq) && parsed.logSeq >= 0)
  if ((parsed?.version !== 1 && parsed?.version !== 2) || !Array.isArray(parsed.records) || !okSidecars || !okLogSeq) {
    throw invalid('not a version 1 or 2 journal')
  }
  for (let i = 0; i < parsed.records.length; i++) {
    const why = recordProblem(parsed.records[i])
    if (why) throw invalid(`record ${i}: ${why}`)
  }
  return {
    records: parsed.records,
    sidecars: parsed.version === 2 ? parsed.sidecars as Record<string, unknown> : {},
    ...(parsed.logSeq !== undefined ? { logSeq: parsed.logSeq as number } : {}),
  }
}

/** Snapshot text: version 1 while there is no side state (readable by older versions), else 2. */
function snapshotText(records: EventRecord[], sidecars: Record<string, unknown>, logSeq?: number): string {
  const suffix = logSeq !== undefined ? { logSeq } : {}
  return Object.keys(sidecars).length === 0
    ? JSON.stringify({ version: 1, records, ...suffix })
    : JSON.stringify({ version: 2, records, sidecars, ...suffix })
}

/** One append-log entry of the shared journal: what changed with respect to the snapshot. */
interface JournalDelta {
  /** Records inserted or replaced. */
  put?: EventRecord[]
  /** Ids removed (purged). */
  del?: string[]
  /** Side state written or removed. */
  sidecars?: { set?: Record<string, unknown>; del?: string[] }
}

/** Why `value` is not a {@link JournalDelta} (`undefined` when it is one). */
function deltaProblem(value: unknown): string | undefined {
  const d = value as JournalDelta | null
  if (typeof d !== 'object' || d === null || Array.isArray(d)) return 'not an object'
  if (d.put !== undefined) {
    if (!Array.isArray(d.put)) return 'put is not an array'
    for (let i = 0; i < d.put.length; i++) {
      const why = recordProblem(d.put[i])
      if (why) return `put[${i}]: ${why}`
    }
  }
  if (d.del !== undefined && (!Array.isArray(d.del) || d.del.some((id) => typeof id !== 'string'))) return 'del is not a list of ids'
  const sc = d.sidecars
  if (sc !== undefined) {
    if (typeof sc !== 'object' || sc === null || Array.isArray(sc)) return 'sidecars is not an object'
    if (sc.set !== undefined && (typeof sc.set !== 'object' || sc.set === null || Array.isArray(sc.set))) return 'sidecars.set is not an object'
    if (sc.del !== undefined && (!Array.isArray(sc.del) || sc.del.some((name) => typeof name !== 'string'))) return 'sidecars.del is not a list of names'
  }
  return undefined
}

/** Append a delta to the state read from the snapshot. */
function applyDelta(
  records: EventRecord[],
  sidecars: Record<string, unknown>,
  delta: JournalDelta,
): { records: EventRecord[]; sidecars: Record<string, unknown> } {
  const byId = new Map(records.map((record) => [record.envelope.eventId, record]))
  for (const record of delta.put ?? []) byId.set(record.envelope.eventId, record)
  for (const id of delta.del ?? []) byId.delete(id)
  const nextSidecars = { ...sidecars }
  for (const [name, value] of Object.entries(delta.sidecars?.set ?? {})) nextSidecars[name] = value
  for (const name of delta.sidecars?.del ?? []) delete nextSidecars[name]
  return { records: [...byId.values()], sidecars: nextSidecars }
}

/** The delta between two snapshots, or `undefined` when nothing changed. */
function deltaOf(
  beforeRecords: EventRecord[],
  afterRecords: EventRecord[],
  beforeSidecars: Record<string, unknown>,
  afterSidecars: Record<string, unknown>,
): JournalDelta | undefined {
  const before = new Map(beforeRecords.map((record) => [record.envelope.eventId, JSON.stringify(record)]))
  const after = new Map(afterRecords.map((record) => [record.envelope.eventId, record]))
  const put = afterRecords.filter((record) => before.get(record.envelope.eventId) !== JSON.stringify(record))
  const del = [...before.keys()].filter((id) => !after.has(id))
  const set: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(afterSidecars)) {
    if (JSON.stringify(beforeSidecars[name]) !== JSON.stringify(value)) set[name] = value
  }
  const removed = Object.keys(beforeSidecars).filter((name) => !Object.prototype.hasOwnProperty.call(afterSidecars, name))
  const sidecars = Object.keys(set).length || removed.length
    ? { ...(Object.keys(set).length ? { set } : {}), ...(removed.length ? { del: removed } : {}) }
    : undefined
  if (!put.length && !del.length && !sidecars) return undefined
  return { ...(put.length ? { put } : {}), ...(del.length ? { del } : {}), ...(sidecars ? { sidecars } : {}) }
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  if (pid === process.pid) return true
  try {
    process.kill(pid, 0) // signal 0: existence probe only, sends nothing
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Lock files held by an open journal of THIS process (canonical paths). */
const heldLocks = new Set<string>()

/** Open SharedFileEventJournals of THIS process, by the lock key of their file (count per key). */
const sharedOpen = new Map<string, number>()

/** Whether a live single-process FileEventJournal holds the `<file>.lock` lock with key `key`. */
async function singleHolderAlive(lockPath: string, key: string): Promise<boolean> {
  if (heldLocks.has(key)) return true
  const holder = Number.parseInt(await readFile(lockPath, 'utf8').catch(() => ''), 10)
  return holder !== process.pid && pidAlive(holder)
}

/** A canonical key for a lock path: real directory (symlinks resolved), case-folded on Windows. */
async function lockKey(lockPath: string): Promise<string> {
  const key = join(await realpath(dirname(lockPath)), basename(lockPath))
  return process.platform === 'win32' ? key.toLowerCase() : key
}

async function acquireLock(lockPath: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(lockPath, 'wx')
      await handle.writeFile(String(process.pid), 'utf8')
      await handle.close()
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const holder = Number.parseInt(await readFile(lockPath, 'utf8').catch(() => ''), 10)
      // Our own pid while no journal of this process holds it (open() checks heldLocks):
      // a lock left by an earlier process that had the same pid (a restarted container).
      if (holder === process.pid) return
      if (pidAlive(holder)) throw new Error(`event journal is locked by live process ${holder}: ${lockPath}`)
      await rm(lockPath, { force: true }) // stale lock of a dead process
    }
  }
  throw new Error(`could not acquire event journal lock: ${lockPath}`)
}

/**
 * Durable single-process journal with atomic snapshot replacement. Every write rewrites the
 * whole snapshot (temp file + rename): a crash leaves the previous or the next one. Side state
 * registered with {@link sidecar} is part of the same snapshot (format version 2; version 1
 * is still written while no side state exists, and both open).
 */
export class FileEventJournal implements LeasedEventJournal {
  private writeQueue: Promise<void> = Promise.resolve()
  /** A write queued but not started yet: later changes join it (its snapshot is taken when it starts). */
  private queuedWrite: Promise<void> | undefined
  /** In-memory changes not written yet (lease extensions). */
  private dirty = false
  private closed = false
  private readonly registered = new Map<string, JournalSidecar>()
  private constructor(
    private readonly filePath: string,
    private readonly memory: MemoryEventJournal,
    private readonly lockPath: string | undefined,
    /** Key of this journal's entry in the in-process lock registry. */
    private readonly lockKey: string | undefined,
    /** Saved side state, including names this process never registers (kept on rewrite). */
    private readonly savedSidecars: Record<string, unknown>,
    /** `FileEventJournalOptions.fsync`. */
    private readonly fsync = false,
  ) {}

  /** The file is held under the advisory lock (`open(path, { lock: true })`) and the journal is not closed. */
  get locked(): boolean { return this.lockPath !== undefined && !this.closed }
  /** Only one process can use a locked file journal. */
  get exclusive(): boolean { return this.locked }

  /**
   * @throws {Error} when the file is not a valid journal, or (with `lock`) another live process
   *   holds it or another open journal of this process does.
   */
  static async open(filePath: string, options: FileEventJournalOptions = {}): Promise<FileEventJournal> {
    if (options.fsync !== undefined && typeof options.fsync !== 'boolean') throw new TypeError('FileEventJournal.open(): fsync must be a boolean')
    const lockPath = options.lock === true ? `${filePath}.lock` : undefined
    let key: string | undefined
    if (lockPath) {
      await mkdir(dirname(filePath), { recursive: true })
      key = await lockKey(lockPath)
      // Checked and claimed with no await in between, so two concurrent opens cannot both pass.
      if (heldLocks.has(key)) throw new Error(`event journal is already open in this process: ${filePath}`)
      if (sharedOpen.has(key)) throw new Error(`event journal is open as a SharedFileEventJournal in this process: ${filePath}`)
      heldLocks.add(key)
      try {
        await acquireLock(lockPath)
      } catch (error) {
        heldLocks.delete(key)
        throw error
      }
    }
    let records: EventRecord[] = []
    let sidecars: Record<string, unknown> = {}
    // With the lock, the snapshot is read under the SharedFileEventJournal mutex: a shared writer
    // (of another process) either committed before this read or sees the lock and refuses.
    let releaseMutex: (() => Promise<void>) | undefined
    try {
      if (lockPath) releaseMutex = await acquireMutex(`${filePath}.mutex`, 10_000, 30_000, 10_000)
      ;({ records, sidecars } = parseSnapshot(await readFile(filePath, 'utf8'), filePath))
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        await releaseMutex?.().catch(() => {})
        if (lockPath) await rm(lockPath, { force: true }).catch(() => {})
        if (key) heldLocks.delete(key)
        throw error
      }
    }
    await releaseMutex?.()
    return new FileEventJournal(filePath, MemoryEventJournal.fromSnapshot(records), lockPath, key, sidecars, options.fsync === true)
  }
  async append<TPayload>(envelope: EventEnvelope<TPayload>): Promise<boolean> { return (await this.appendRecord(envelope)).status === 'appended' }
  /** @throws {TypeError} when the envelope is not JSON-serializable (nothing is stored then). */
  async appendRecord<TPayload>(envelope: EventEnvelope<TPayload>, options?: AppendEventOptions): Promise<{ status: 'appended' | 'duplicate'; record: EventRecord }> {
    this.assertOpen()
    const result = await this.memory.appendRecord(jsonEnvelope(envelope), options)
    if (result.status === 'appended') await this.persist()
    return result
  }
  get(eventId: string): Promise<EventRecord | undefined> { return this.memory.get(eventId) }
  async claim(limit: number, options?: ClaimEventOptions): Promise<EventRecord[]> { this.assertOpen(); const records = await this.memory.claim(limit, options); if (records.length) await this.persist(); return records }
  async claimOne(eventId: string, lease: EventLease): Promise<EventRecord | null> { this.assertOpen(); const record = await this.memory.claimOne(eventId, lease); if (record) await this.persist(); return record }
  /**
   * Extends the lease in memory only; the file gets it with the next write (or `close()`).
   * A lease matters only while this process lives, so a heartbeat never rewrites the file.
   */
  async extend(eventId: string, options: { fencingToken: number; leaseUntil: number }): Promise<void> {
    this.assertOpen()
    await this.memory.extend(eventId, options)
    this.dirty = true
  }
  async ack(eventId: string, options?: AckEventOptions): Promise<void> { this.assertOpen(); await this.memory.ack(eventId, options); await this.persist() }
  async fail(eventId: string, error: unknown, options?: FailEventOptions): Promise<void> { this.assertOpen(); await this.memory.fail(eventId, error, options); await this.persist() }
  async release(eventId: string, options?: ReleaseEventOptions): Promise<void> { this.assertOpen(); await this.memory.release(eventId, options); await this.persist() }
  async replay(eventId: string, now?: number): Promise<void> { this.assertOpen(); await this.memory.replay(eventId, now); await this.persist() }
  list(options?: ListEventOptions): Promise<EventRecord[]> { return this.memory.list(options) }
  async purge(options: PurgeEventOptions): Promise<number> { this.assertOpen(); const n = await this.memory.purge(options); if (n > 0) await this.persist(); return n }

  sidecar(name: string, state: JournalSidecar): SidecarHandle {
    if (this.registered.has(name)) throw new Error(`sidecar ${name} is already registered on this journal`)
    if (Object.prototype.hasOwnProperty.call(this.savedSidecars, name)) state.restore(this.savedSidecars[name])
    this.registered.set(name, state)
    return { changed: () => this.persist() }
  }

  /**
   * Write pending in-memory changes, wait for pending writes and release the lock (if any).
   * Idempotent. Later writes reject: a closed journal never writes without its lock.
   */
  async close(): Promise<void> {
    if (this.closed) return
    if (this.dirty) await this.persist().catch(() => {})
    this.closed = true
    await this.writeQueue
    if (this.lockPath) await rm(this.lockPath, { force: true })
    if (this.lockKey) heldLocks.delete(this.lockKey)
  }

  private assertOpen(): void {
    if (this.closed) throw new Error(`event journal is closed: ${this.filePath}`)
  }

  private snapshotJson(): string {
    const records = this.memory.snapshot()
    if (this.registered.size === 0 && Object.keys(this.savedSidecars).length === 0) return JSON.stringify({ version: 1, records })
    const sidecars: Record<string, unknown> = { ...this.savedSidecars }
    for (const [name, state] of this.registered) sidecars[name] = state.snapshot()
    return JSON.stringify({ version: 2, records, sidecars })
  }

  /**
   * Rewrite the snapshot. A call made while another write is queued (not started) joins it:
   * that write takes its snapshot when it starts, so it carries this change too.
   */
  private persist(): Promise<void> {
    if (this.closed) return Promise.reject(new Error(`event journal is closed: ${this.filePath}`))
    if (this.queuedWrite) return this.queuedWrite
    const write: Promise<void> = this.writeQueue.then(async () => {
      if (this.queuedWrite === write) this.queuedWrite = undefined
      this.dirty = false
      await mkdir(dirname(this.filePath), { recursive: true })
      const temporary = `${this.filePath}.${randomUUID()}.tmp`
      try {
        await writeSnapshotFile(temporary, this.snapshotJson(), this.fsync)
        await rename(temporary, this.filePath)
        if (this.fsync) await syncDirectory(this.filePath)
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => {})
        throw error
      }
    })
    // The caller sees this write's failure; the queue does not, so one failed
    // write (full disk, a transient EPERM on Windows) never blocks later ones.
    this.queuedWrite = write
    this.writeQueue = write.catch(() => {})
    return write
  }
}

/** Options of {@link SharedFileEventJournal.open}. */
export interface SharedFileEventJournalOptions {
  /** How long an operation waits for the cross-process mutex before it rejects. Default `10_000` ms. */
  lockTimeoutMs?: number
  /**
   * A mutex held longer than this is considered abandoned and broken (a holder that froze, or
   * one on another host whose pid cannot be probed). Must exceed the slowest write. A live
   * holder refreshes the mutex mtime (heartbeat) every `heartbeatMs`, so a slow operation is
   * never mistaken for a dead process. A mutex of a dead process on this host is broken at
   * once. Default `30_000` ms.
   */
  staleLockMs?: number
  /**
   * How often the holder refreshes the mutex mtime. Default a third of `staleLockMs`. Must be
   * positive and lower than `staleLockMs`.
   */
  heartbeatMs?: number
  /**
   * Append-only journal (`<file>.log`): each write appends the records/sidecars that changed
   * instead of rewriting the whole snapshot, and the snapshot is rewritten (with `logSeq`)
   * and the log truncated every `compactEvery` entries (1000) or `compactBytes` (4 MiB).
   * `true` uses those defaults; `false`/omitted keeps the whole-file rewrite. A leftover log
   * is always replayed on open (and folded into the next snapshot).
   */
  appendLog?: boolean | AppendLogOptions
  /**
   * `fsync` every snapshot before it replaces the previous one (and the directory after the
   * rename, where the platform allows it). Also the default of `appendLog.fsync`. Default `false`.
   */
  fsync?: boolean
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Transient Windows errors (antivirus, a reader holding the file) worth a short retry. */
function transient(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'
}

async function retrying<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (!transient(error) || attempt >= 20) throw error
      await sleep(Math.min(100, 5 * (attempt + 1)))
    }
  }
}

function unregisterShared(key: string): void {
  const n = (sharedOpen.get(key) ?? 1) - 1
  if (n > 0) sharedOpen.set(key, n)
  else sharedOpen.delete(key)
}

/** Per-file in-process queues: journals of this process on one file take turns before the file mutex. */
const sharedQueues = new Map<string, Promise<void>>()

/**
 * A cross-process mutex file (`<file>.mutex`) holding `<pid>:<nonce>`. Returns its release.
 * A mutex of a dead local pid, or one older than `staleMs`, is broken. While held, the owner
 * refreshes its mtime every `heartbeatMs`, so a slow-but-alive holder (another host included)
 * is never mistaken for a stalled one.
 */
async function acquireMutex(path: string, timeoutMs: number, staleMs: number, heartbeatMs: number): Promise<() => Promise<void>> {
  const token = `${process.pid}:${randomUUID()}`
  const deadline = Date.now() + timeoutMs
  let delay = 2
  for (;;) {
    try {
      const handle = await open(path, 'wx')
      try {
        await handle.writeFile(token, 'utf8')
      } finally {
        await handle.close()
      }
      const heartbeat = setInterval(() => {
        // Extend only a mutex that is still ours: never resurrect one another process broke.
        void readFile(path, 'utf8')
          .then(async (current) => {
            if (current === token) await utimes(path, new Date(), new Date())
          })
          .catch(() => {})
      }, heartbeatMs)
      heartbeat.unref?.()
      return async () => {
        clearInterval(heartbeat)
        // Remove it only while it is still ours (it may have been broken as stale meanwhile).
        const current = await readFile(path, 'utf8').catch(() => undefined)
        if (current === token) await retrying(() => rm(path, { force: true }))
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' && !transient(error)) throw error
    }
    const [text, info] = await Promise.all([readFile(path, 'utf8').catch(() => undefined), stat(path).catch(() => undefined)])
    if (text !== undefined && info) {
      const pid = Number.parseInt(text.split(':')[0] ?? '', 10)
      const deadHolder = Number.isInteger(pid) && pid > 0 && pid !== process.pid && !pidAlive(pid)
      if (deadHolder || Date.now() - info.mtimeMs > staleMs) {
        await breakMutex(path, text)
        continue
      }
    }
    if (Date.now() >= deadline) throw new Error(`timed out waiting for the event journal mutex: ${path}`)
    await sleep(delay + Math.random() * delay)
    delay = Math.min(delay * 2, 40)
  }
}

/**
 * @internal Test seam: the cross-process mutex used by {@link SharedFileEventJournal}
 * (heartbeat included). Not part of the supported API.
 */
export const __testing = { acquireMutex }

/**
 * Break a stale mutex: move it aside, and put it back if it changed after it was inspected.
 *
 * Residual race (accepted): between the inspection and the rename, another process may break
 * the stale mutex and take a fresh one; the rename then moves THAT one aside and it is linked
 * back. If, in the short window between the rename and the link, a third process creates a new
 * mutex, the link fails and two processes briefly both believe they hold it: their
 * read-modify-write cycles can overlap and the last rename wins (one operation's change may be
 * lost). It needs three processes contending on a mutex that was already stale (its holder died
 * or stalled past `staleLockMs`), so keep `staleLockMs` well above the slowest rewrite; where
 * strict mutual exclusion matters under such contention, use a database journal.
 */
async function breakMutex(path: string, seen: string): Promise<void> {
  const aside = `${path}.${randomUUID()}.stale`
  try {
    await rename(path, aside)
  } catch {
    return // already gone, or another process is breaking it
  }
  const moved = await readFile(aside, 'utf8').catch(() => undefined)
  // Another process broke it and took it in between: hand its fresh mutex back.
  if (moved !== seen) await link(aside, path).catch(() => {})
  await rm(aside, { force: true }).catch(() => {})
}

/**
 * Multi-process event journal on one JSON file: several processes (bot replicas, workers) on the
 * same host, or on a filesystem with atomic rename and exclusive create, use it at once.
 *
 * Every write runs under a cross-process mutex (`<file>.mutex`) against the CURRENT file: it reads
 * the snapshot, applies the operation and atomically replaces the file (temp file + rename). So
 * claims are exclusive and fencing tokens hold across processes. Reads take the mutex too and
 * see the last committed snapshot. Named side state ({@link updateSidecar}) is part of the same snapshot: the bot's
 * outbox lives there with `@botmesh/events/durability`.
 *
 * Every write rewrites the whole file: fine for modest volumes and a few processes; use a database
 * journal for heavy traffic. The file format is the {@link FileEventJournal} one, but never open
 * one file with both at the same time: a locked FileEventJournal is refused while a shared
 * journal of this process has the file open, and every shared operation rejects while a live
 * locked FileEventJournal (of any process) holds it, so neither overwrites the other's records. A mutex left by a dead process is broken (nothing is
 * killed); one held longer than `staleLockMs` is treated as abandoned.
 */
export class SharedFileEventJournal implements LeasedEventJournal {
  /** Several processes share this journal. */
  readonly exclusive = false
  private closed = false
  private inflight = new Set<Promise<unknown>>()

  private constructor(
    private readonly filePath: string,
    private readonly mutexPath: string,
    /** The `<file>.lock` path a FileEventJournal takes; checked on every operation. */
    private readonly singleLockPath: string,
    /** Canonical key of `singleLockPath`: in-process registries and queue. */
    private readonly lockKey: string,
    private readonly lockTimeoutMs: number,
    private readonly staleLockMs: number,
    private readonly heartbeatMs: number,
    /** Resolved append-log options, or `undefined` for whole-snapshot writes. */
    private readonly appendLog: Required<AppendLogOptions> | undefined,
    /** `SharedFileEventJournalOptions.fsync`. */
    private readonly fsync = false,
  ) {}

  /**
   * Open (or create) the shared journal at `filePath`.
   * @throws {Error} when the file is not a valid journal or a {@link FileEventJournal} holds it.
   *   Later operations reject too while a live locked FileEventJournal holds the file.
   */
  static async open(filePath: string, options: SharedFileEventJournalOptions = {}): Promise<SharedFileEventJournal> {
    const lockTimeoutMs = options.lockTimeoutMs ?? 10_000
    const staleLockMs = options.staleLockMs ?? 30_000
    if (!Number.isFinite(lockTimeoutMs) || lockTimeoutMs < 0) throw new TypeError('SharedFileEventJournal: lockTimeoutMs must be a non-negative number')
    if (!Number.isFinite(staleLockMs) || staleLockMs <= 0) throw new TypeError('SharedFileEventJournal: staleLockMs must be a positive number')
    const heartbeatMs = options.heartbeatMs ?? Math.max(1, Math.floor(staleLockMs / 3))
    if (!Number.isFinite(heartbeatMs) || heartbeatMs <= 0 || heartbeatMs >= staleLockMs) {
      throw new TypeError('SharedFileEventJournal: heartbeatMs must be positive and lower than staleLockMs')
    }
    // Validated before any lock/registry side effect.
    if (options.fsync !== undefined && typeof options.fsync !== 'boolean') throw new TypeError('SharedFileEventJournal: fsync must be a boolean')
    const fsync = options.fsync === true
    const appendLog = appendLogOptions(
      fsync && typeof options.appendLog === 'object' && options.appendLog !== null && options.appendLog.fsync === undefined
        ? { ...options.appendLog, fsync: true }
        : fsync && options.appendLog === true ? { fsync: true } : options.appendLog,
      'SharedFileEventJournal.open()',
    )
    await mkdir(dirname(filePath), { recursive: true })
    const singleLock = `${filePath}.lock`
    const key = await lockKey(singleLock)
    if (await singleHolderAlive(singleLock, key)) {
      throw new Error(`event journal is open as a single-process FileEventJournal: ${filePath}`)
    }
    // Claimed at once so a FileEventJournal of this process opened from now on is refused.
    sharedOpen.set(key, (sharedOpen.get(key) ?? 0) + 1)
    try {
      parseSnapshot(await readFile(filePath, 'utf8'), filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        unregisterShared(key)
        throw error
      }
    }
    // A corrupt line in the middle of a leftover log is refused now, not on the first write.
    try {
      await AppendLog.verify(filePath)
    } catch (error) {
      unregisterShared(key)
      throw error
    }
    return new SharedFileEventJournal(filePath, `${filePath}.mutex`, singleLock, key, lockTimeoutMs, staleLockMs, heartbeatMs, appendLog, fsync)
  }

  async append<TPayload>(envelope: EventEnvelope<TPayload>): Promise<boolean> {
    return (await this.appendRecord(envelope)).status === 'appended'
  }

  /** @throws {TypeError} when the envelope is not JSON-serializable (nothing is stored then). */
  appendRecord<TPayload>(envelope: EventEnvelope<TPayload>, options?: AppendEventOptions): Promise<{ status: 'appended' | 'duplicate'; record: EventRecord }> {
    let stored: EventEnvelope<TPayload>
    try { stored = jsonEnvelope(envelope) } catch (error) { return Promise.reject(error) }
    return this.write(async (m) => {
      const out = await m.appendRecord(stored, options)
      return { changed: out.status === 'appended', result: out }
    })
  }

  get(eventId: string): Promise<EventRecord | undefined> {
    return this.write(async (m) => ({ changed: false, result: await m.get(eventId) }))
  }
  list(options?: ListEventOptions): Promise<EventRecord[]> {
    return this.write(async (m) => ({ changed: false, result: await m.list(options) }))
  }

  claim(limit: number, options?: ClaimEventOptions): Promise<EventRecord[]> {
    return this.write(async (m) => {
      const records = await m.claim(limit, options)
      return { changed: records.length > 0, result: records }
    })
  }

  claimOne(eventId: string, lease: EventLease): Promise<EventRecord | null> {
    return this.write(async (m) => {
      const record = await m.claimOne(eventId, lease)
      return { changed: record !== null, result: record }
    })
  }

  /** Extends the lease in the shared file (other processes must see the heartbeat). */
  extend(eventId: string, options: { fencingToken: number; leaseUntil: number }): Promise<void> {
    return this.write(async (m) => ({ changed: true, result: await m.extend(eventId, options) }))
  }
  ack(eventId: string, options?: AckEventOptions): Promise<void> {
    return this.write(async (m) => ({ changed: true, result: await m.ack(eventId, options) }))
  }
  fail(eventId: string, error: unknown, options?: FailEventOptions): Promise<void> {
    return this.write(async (m) => ({ changed: true, result: await m.fail(eventId, error, options) }))
  }
  release(eventId: string, options?: ReleaseEventOptions): Promise<void> {
    return this.write(async (m) => ({ changed: true, result: await m.release(eventId, options) }))
  }
  replay(eventId: string, now?: number): Promise<void> {
    return this.write(async (m) => ({ changed: true, result: await m.replay(eventId, now) }))
  }
  purge(options: PurgeEventOptions): Promise<number> {
    return this.write(async (m) => {
      const n = await m.purge(options)
      return { changed: n > 0, result: n }
    })
  }

  readSidecar(name: string): Promise<unknown> {
    return this.write(async (_m, sidecars) => ({
      changed: false,
      result: Object.prototype.hasOwnProperty.call(sidecars, name) ? structuredClone(sidecars[name]) : undefined,
    }))
  }

  updateSidecar<T>(name: string, update: SidecarUpdate<T>): Promise<T> {
    return this.write(async (_m, sidecars) => {
      const current = Object.prototype.hasOwnProperty.call(sidecars, name) ? structuredClone(sidecars[name]) : undefined
      const out = await update(current)
      if (!('data' in out)) return { changed: false, result: out.result }
      sidecars[name] = out.data
      return { changed: true, result: out.result }
    })
  }

  /**
   * Operations accepted before `close()` (even those still queued behind the mutex) run to
   * completion and `close()` waits for them; operations called after it reject. Idempotent.
   * Nothing is held between operations.
   */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await Promise.allSettled([...this.inflight])
    unregisterShared(this.lockKey)
  }

  private assertOpen(): void {
    if (this.closed) throw new Error(`event journal is closed: ${this.filePath}`)
  }

  /**
   * The current state: the snapshot plus any append-log entries beyond its `logSeq`. No
   * closed check: write() admitted the operation, and close() waits for it.
   */
  private async read(): Promise<{ memory: MemoryEventJournal; sidecars: Record<string, unknown>; replay?: AppendLogReplay<JournalDelta> }> {
    let records: EventRecord[] = []
    let sidecars: Record<string, unknown> = {}
    let logSeq = 0
    try {
      const text = await retrying(() => readFile(this.filePath, 'utf8'))
      ;({ records, sidecars, logSeq = 0 } = parseSnapshot(text, this.filePath))
    } catch (error) {
      // A missing snapshot is normal (nothing written yet, or a crash before the first
      // compaction); a log may still hold entries, so keep going.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (!this.appendLog && !(await AppendLog.exists(this.filePath))) {
      return { memory: MemoryEventJournal.fromSnapshot(records), sidecars }
    }
    const replay = await AppendLog.replay<JournalDelta>(this.filePath, logSeq)
    let state = { records, sidecars }
    for (const { s, entry } of replay.entries) {
      const why = deltaProblem(entry)
      if (why) {
        throw new Error(`invalid event journal append log ${AppendLog.pathOf(this.filePath)}: entry ${s}: ${why}. Restore the journal from a backup, or cut the log before that entry.`)
      }
      state = applyDelta(state.records, state.sidecars, entry)
    }
    return { memory: MemoryEventJournal.fromSnapshot(state.records), sidecars: state.sidecars, replay }
  }

  /**
   * Run `op` on the current snapshot under the in-process queue and the cross-process mutex.
   * Reads take it too: no reader holds the file open while a writer replaces it (Windows
   * refuses to replace an open file).
   */
  private write<T>(op: (memory: MemoryEventJournal, sidecars: Record<string, unknown>) => Promise<{ changed: boolean; result: T }>): Promise<T> {
    try { this.assertOpen() } catch (error) { return Promise.reject(error) }
    const previous = sharedQueues.get(this.lockKey) ?? Promise.resolve()
    const run = previous.then(async () => {
      const release = await acquireMutex(this.mutexPath, this.lockTimeoutMs, this.staleLockMs, this.heartbeatMs)
      try {
        // A FileEventJournal (another process) may have opened the file since: it keeps its own
        // copy and rewrites the whole file, so a write from here would be lost. Refuse instead.
        if (await singleHolderAlive(this.singleLockPath, this.lockKey)) {
          throw new Error(`event journal is open as a single-process FileEventJournal: ${this.filePath}`)
        }
        const { memory, sidecars, replay } = await this.read()
        const beforeRecords = memory.snapshot()
        const beforeSidecars = structuredClone(sidecars)
        const out = await op(memory, sidecars)
        if (out.changed) {
          const records = memory.snapshot()
          if (this.appendLog) {
            const delta = deltaOf(beforeRecords, records, beforeSidecars, sidecars)
            if (delta) {
              const log = new AppendLog(this.filePath, this.appendLog)
              if (replay) log.adopt(replay)
              const seq = (replay?.lastSeq ?? 0) + 1
              await log.append(seq, delta)
              if (log.due) {
                await this.persist(records, sidecars, seq)
                await log.truncate()
              }
            }
          } else {
            await this.persist(records, sidecars)
            // A leftover log was replayed into this snapshot; it is no longer needed.
            if (replay) await retrying(() => rm(AppendLog.pathOf(this.filePath), { force: true }))
          }
        }
        return out.result
      } finally {
        await release()
      }
    })
    const settled = run.then(() => {}, () => {})
    sharedQueues.set(this.lockKey, settled)
    void settled.then(() => { if (sharedQueues.get(this.lockKey) === settled) sharedQueues.delete(this.lockKey) })
    this.inflight.add(run)
    void settled.then(() => this.inflight.delete(run))
    return run
  }

  private async persist(records: EventRecord[], sidecars: Record<string, unknown>, logSeq?: number): Promise<void> {
    const temporary = `${this.filePath}.${randomUUID()}.tmp`
    try {
      await writeSnapshotFile(temporary, snapshotText(records, sidecars, logSeq), this.fsync)
      await retrying(() => rename(temporary, this.filePath))
      if (this.fsync) await syncDirectory(this.filePath)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {})
      throw error
    }
  }
}

export type EventHandler<TPayload = unknown> = (envelope: EventEnvelope<TPayload>) => void | Promise<void>

export interface EventWorkerOptions {
  /** Attempts before an event goes to the dead-letter state. Defaults to 5. */
  maxAttempts?: number
  /** Fixed retry delay; defaults to {@link exponentialBackoff}. */
  retryDelayMs?: number
  /** Lease length requested on each claim. Defaults to the journal default (30 s in the bundled journals). */
  leaseMs?: number
  /** Time source for claims, lease checks, acks and failures. Defaults to `Date.now`. */
  clock?: () => number
}

export interface EventBatchResult {
  /** Handled and acknowledged. */
  processed: number
  /** Handler threw (or none was registered); scheduled for retry or dead-lettered. */
  failed: number
  /**
   * Lease lost: it expired before the handler started (the handler was
   * skipped), or the journal fenced off the ack/fail because another worker
   * re-claimed the event.
   */
  stale: number
}

export class EventWorker {
  private handlers = new Map<string, EventHandler>()

  /** @throws {TypeError} for an invalid option (`maxAttempts`, `retryDelayMs`, `leaseMs`, `clock`). */
  constructor(
    private readonly journal: EventJournal,
    private readonly options: EventWorkerOptions = {},
  ) {
    const { maxAttempts, retryDelayMs, leaseMs, clock } = options
    if (maxAttempts !== undefined && (!Number.isInteger(maxAttempts) || maxAttempts < 1)) {
      throw new TypeError(`EventWorker: maxAttempts must be a positive integer (got ${String(maxAttempts)})`)
    }
    checkFinite(retryDelayMs, 'retryDelayMs', 'EventWorker', 0)
    checkFinite(leaseMs, 'leaseMs', 'EventWorker', 0, true)
    if (clock !== undefined && typeof clock !== 'function') throw new TypeError('EventWorker: clock must be a function returning epoch ms')
  }

  on<TPayload>(eventType: string, handler: EventHandler<TPayload>): () => void {
    if (this.handlers.has(eventType)) throw new Error(`Handler already registered for ${eventType}`)
    this.handlers.set(eventType, handler as EventHandler)
    // Only remove THIS handler: a stale unsubscribe must not drop a later one.
    return () => {
      if (this.handlers.get(eventType) === handler) this.handlers.delete(eventType)
    }
  }

  async runBatch(limit = 100): Promise<EventBatchResult> {
    const clock = this.options.clock ?? Date.now
    const { maxAttempts, retryDelayMs, leaseMs } = this.options
    const records = await this.journal.claim(limit, { now: clock(), ...(leaseMs !== undefined ? { leaseMs } : {}) })
    const result: EventBatchResult = { processed: 0, failed: 0, stale: 0 }
    for (const record of records) {
      const { eventId, eventType } = record.envelope
      const fencingToken = record.fencingToken
      // Records run one after another, so a later lease can run out while
      // earlier handlers work. Running it then would race whoever re-claims
      // it; hand it back instead, so the skip does not use up an attempt.
      if (record.leaseUntil !== undefined && clock() >= record.leaseUntil) {
        try {
          await this.journal.release(eventId, { now: clock(), fencingToken })
        } catch (error) {
          // Already re-claimed by another worker: nothing to hand back.
          if (!(error instanceof StaleLeaseError)) throw error
        }
        result.stale++
        continue
      }
      const handler = this.handlers.get(eventType)
      let handlerError: unknown
      let ok = false
      try {
        if (!handler) throw new Error(`No handler registered for ${eventType}`)
        await handler(record.envelope)
        ok = true
      } catch (error) {
        handlerError = error
      }
      try {
        if (ok) {
          await this.journal.ack(eventId, { now: clock(), fencingToken })
          result.processed++
        } else {
          await this.journal.fail(eventId, handlerError, {
            now: clock(),
            fencingToken,
            ...(maxAttempts !== undefined ? { maxAttempts } : {}),
            ...(retryDelayMs !== undefined ? { retryDelayMs } : {}),
          })
          result.failed++
        }
      } catch (error) {
        // Fenced off: another worker owns the event now. Any other journal
        // error propagates; the remaining leases expire and get re-claimed.
        if (!(error instanceof StaleLeaseError)) throw error
        result.stale++
      }
    }
    return result
  }
}

export function exponentialBackoff(attempt: number, baseMs = 1_000, capMs = 60_000): number {
  const safeAttempt = Math.max(1, Math.floor(attempt))
  return Math.min(capMs, baseMs * 2 ** (safeAttempt - 1))
}
