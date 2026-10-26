/**
 * TicketDesk — the transport-agnostic ticket/queue engine behind `ctx.tools.tickets`.
 *
 * Usable on its own (no Bot needed): give it a {@link TicketKeyValue} and it keeps an
 * in-memory index, loaded lazily on the first call and written through on every change.
 * Mutations are serialized, so concurrent `create()` calls never share an id. Callbacks
 * (`onCreate`, `onAssign`, `onClose`, `onUpdate`) run after the change is persisted and
 * outside the lock, so they may call back into the desk; their errors go to `onError`
 * and never fail the operation.
 *
 * Storage layout (keys under `keyPrefix`, default `tickets:`): `seq` (last id),
 * `index` (JSON array of the ids of NON-closed tickets), `t:<id>` (one JSON ticket
 * each) and, in shared mode with `reuseOpen`, `open:<chatId>` (the chat's claimed ticket). Only active tickets live in memory and in the index, so both stay bounded by
 * the live workload; closed tickets stay in `t:<id>` and are read on demand (`get`, and
 * `list` when the filter can match `closed`, which scans `1..seq`).
 *
 * Memory changes only after the store writes succeed, so a failed write rejects the
 * call and leaves the desk as it was.
 *
 * Shared mode: when the storage has an atomic `setIf` (compare-and-set by value, e.g.
 * `memoryTicketStorage()` or `durableKvTicketStorage(kv)`), several desks (bot
 * replicas) can share it. Every call then re-reads the index from storage, a new id is
 * claimed with a compare-and-set on `seq`, and ticket and index writes are
 * compare-and-set with a bounded retry (`maxRetries`, then `TicketContentionError`).
 * With `reuseOpen` (the default) the chat's open ticket is also claimed with a
 * compare-and-set on `open:<chatId>`, so replicas creating for one chat at the same
 * time (in a handler, the API or the manager) end up with one open ticket; a replica
 * that finds a claimed ticket not yet written finishes writing it.
 * Without `setIf` the desk assumes it is the only writer (one replica).
 */

import type {
  CreateTicketInput,
  CreatedTicket,
  Ticket,
  TicketFilter,
  TicketKeyValue,
  TicketPatch,
  TicketPriority,
  TicketStatus,
  TicketsApi,
} from './types.js'
import { TICKET_PRIORITIES, TICKET_STATUSES } from './types.js'
import { isWithinWorkingHours, parseWorkingHours, type WorkingHours, type WorkingHoursInput } from './workingHours.js'

/** Thrown by `update`/`assign`/`close` for an unknown ticket id. */
export class TicketNotFoundError extends Error {
  constructor(readonly ticketId: string) {
    super(`Ticket ${JSON.stringify(ticketId)} not found`)
    this.name = 'TicketNotFoundError'
  }
}

/**
 * Thrown when a shared-mode write keeps losing its compare-and-set to other replicas
 * after `maxRetries` attempts. No active ticket is left outside the index: a claimed id
 * is just skipped, and a new ticket's id is listed before the ticket is written, so a
 * failed create leaves at most an index entry with no ticket, which reads skip.
 */
export class TicketContentionError extends Error {
  constructor(readonly operation: string) {
    super(`tickets.${operation}: too much contention on the shared ticket storage`)
    this.name = 'TicketContentionError'
  }
}

/** Where a callback error came from (second argument of `onError`). */
export type TicketCallbackName = 'onCreate' | 'onAssign' | 'onClose' | 'onUpdate'

export interface TicketDeskOptions {
  storage: TicketKeyValue
  /** Clock (epoch ms). Default `Date.now`. */
  now?: () => number
  /** See {@link WorkingHoursInput}. Without it the desk is always open. */
  workingHours?: WorkingHoursInput
  /** IANA timezone used to evaluate `workingHours`. Default: the process timezone. */
  timezone?: string
  /** Return the chat's existing non-closed ticket instead of opening another. Default `true`. */
  reuseOpen?: boolean
  /** Storage key prefix. Default `'tickets:'`. */
  keyPrefix?: string
  /**
   * Shared mode only (storage with `setIf`): compare-and-set attempts per write before
   * rejecting with `TicketContentionError`. Default `20`.
   */
  maxRetries?: number
  onCreate?: (ticket: CreatedTicket) => void | Promise<void>
  onAssign?: (ticket: Ticket) => void | Promise<void>
  onClose?: (ticket: Ticket) => void | Promise<void>
  onUpdate?: (ticket: Ticket, previous: Ticket) => void | Promise<void>
  onError?: (error: unknown, source: TicketCallbackName) => void
}

const READ_BATCH = 50

/** Returned by a shared-mode step that lost a compare-and-set: re-run it on fresh state. */
const RETRY: unique symbol = Symbol('retry')

const PRIORITY_RANK: Record<TicketPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 }

function clone<T>(v: T): T { return structuredClone(v) }

/** `JSON.parse` that names the storage key when the stored value is corrupt. */
function parseStored(key: string, raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error(`tickets: the value stored at ${JSON.stringify(key)} is not valid JSON; repair or delete that key`)
  }
}

function parseIndex(key: string, raw: string | undefined): string[] {
  const parsed: unknown = raw ? parseStored(key, raw) : []
  return Array.isArray(parsed) ? parsed.map(String) : []
}

/** `meta` must be a plain object that survives a JSON round trip (tickets are stored as JSON). */
function assertMeta(meta: unknown, operation: string): asserts meta is Record<string, unknown> {
  const proto = meta !== null && typeof meta === 'object' ? Object.getPrototypeOf(meta) : undefined
  if (proto === undefined || (proto !== Object.prototype && proto !== null)) {
    throw new TypeError(`tickets.${operation}: meta must be a plain object`)
  }
  const bad = (v: unknown): boolean => {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return false
    if (typeof v === 'number') return !Number.isFinite(v)
    if (Array.isArray(v)) return v.some(bad)
    if (typeof v === 'object') {
      const p = Object.getPrototypeOf(v)
      return (p !== Object.prototype && p !== null) || Object.values(v).some(bad)
    }
    return true
  }
  if (bad(meta)) {
    throw new TypeError(`tickets.${operation}: meta must be JSON-serializable (plain objects, arrays, strings, finite numbers, booleans and null)`)
  }
}

/** The ticket a chat's `open:<chatId>` claim names (`''` or garbage = no claim). */
function parseClaim(raw: string | undefined): Ticket | undefined {
  if (!raw) return undefined
  try {
    const t = JSON.parse(raw) as Partial<Ticket> | null
    return t && typeof t.id === 'string' && typeof t.chatId === 'string' ? t as Ticket : undefined
  } catch {
    return undefined
  }
}

function assertPriority(p: unknown): asserts p is TicketPriority {
  if (!TICKET_PRIORITIES.includes(p as TicketPriority)) {
    throw new Error(`Invalid ticket priority ${JSON.stringify(p)}; expected one of ${TICKET_PRIORITIES.join(', ')}`)
  }
}
function assertStatus(s: unknown): asserts s is TicketStatus {
  if (!TICKET_STATUSES.includes(s as TicketStatus)) {
    throw new Error(`Invalid ticket status ${JSON.stringify(s)}; expected one of ${TICKET_STATUSES.join(', ')}`)
  }
}

export class TicketDesk implements TicketsApi {
  private readonly storage: TicketKeyValue
  private readonly now: () => number
  private readonly hours?: WorkingHours
  private readonly prefix: string
  private readonly shared: boolean
  private readonly maxRetries: number
  /** Active (non-closed) tickets only. */
  private tickets = new Map<string, Ticket>()
  /** Raw JSON of each active ticket as last read or written (the compare-and-set witness). */
  private raws = new Map<string, string>()
  private seq = 0
  /** Raw `seq` value as last read (shared mode claims ids against it). */
  private seqRaw: string | undefined
  private loaded?: Promise<void>
  private lock: Promise<unknown> = Promise.resolve()

  constructor(private readonly opts: TicketDeskOptions) {
    const storage: Partial<TicketKeyValue> | undefined = opts?.storage
    if (!storage || typeof storage !== 'object') {
      throw new TypeError('TicketDesk: options.storage is required, e.g. new TicketDesk({ storage: memoryTicketStorage() })')
    }
    if (typeof storage.get !== 'function' || typeof storage.set !== 'function') {
      throw new TypeError('TicketDesk: options.storage must implement get() and set() (see TicketKeyValue)')
    }
    this.storage = opts.storage
    this.now = opts.now ?? Date.now
    this.prefix = opts.keyPrefix ?? 'tickets:'
    this.shared = typeof opts.storage.setIf === 'function'
    this.maxRetries = opts.maxRetries ?? 20
    if (!Number.isInteger(this.maxRetries) || this.maxRetries < 1) throw new Error('TicketDesk: maxRetries must be a positive integer')
    if (opts.workingHours !== undefined) this.hours = parseWorkingHours(opts.workingHours)
    if (opts.timezone !== undefined) new Intl.DateTimeFormat('en-US', { timeZone: opts.timezone }) // throws on an unknown zone
  }

  /* ---------------------------------------------------------------- reads */

  async get(id: string): Promise<Ticket | undefined> {
    await this.fresh()
    const t = this.tickets.get(String(id)) ?? (await this.readClosed(String(id)))?.[0]
    return t ? clone(t) : undefined
  }

  async list(filter: TicketFilter = {}): Promise<Ticket[]> {
    await this.fresh()
    const statuses = filter.status === undefined ? undefined : ([] as TicketStatus[]).concat(filter.status)
    const all = [...this.tickets.values()]
    if (statuses === undefined || statuses.includes('closed')) {
      const ids: string[] = []
      for (let i = 1; i <= this.seq; i++) if (!this.tickets.has(String(i))) ids.push(String(i))
      for (const [t] of await this.readMany(ids)) if (t.status === 'closed') all.push(t)
    }
    return all
      .filter((t) =>
        (statuses === undefined || statuses.includes(t.status))
        && (filter.chatId === undefined || t.chatId === filter.chatId)
        && (filter.assignee === undefined || t.assignee === filter.assignee)
        && (filter.priority === undefined || t.priority === filter.priority))
      .sort((a, b) => a.createdAt - b.createdAt || Number(a.id) - Number(b.id))
      .map(clone)
  }

  async queue(): Promise<Ticket[]> {
    await this.fresh()
    return this.queued().map(clone)
  }

  async position(id: string): Promise<number | null> {
    await this.fresh()
    const i = this.queued().findIndex((t) => t.id === String(id))
    return i === -1 ? null : i + 1
  }

  isOpen(date: Date = new Date(this.now())): boolean {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new TypeError('tickets.isOpen: date must be a valid Date')
    return this.hours === undefined ? true : isWithinWorkingHours(this.hours, date, this.opts.timezone)
  }

  /* ------------------------------------------------------------ mutations */

  async create(input: CreateTicketInput): Promise<CreatedTicket> {
    if (!input || typeof input.chatId !== 'string' || input.chatId === '') throw new Error('tickets.create: chatId must be a non-empty string')
    if (typeof input.subject !== 'string') throw new Error('tickets.create: subject must be a string')
    const priority = input.priority ?? 'normal'
    assertPriority(priority)
    if (input.meta !== undefined) assertMeta(input.meta, 'create')

    const { result, created } = await this.serial('create', async () => {
      const reuse = this.opts.reuseOpen !== false
      if (reuse) {
        const existing = [...this.tickets.values()].find((t) => t.chatId === input.chatId && t.status !== 'closed')
        if (existing) return { result: existing, created: false }
      }
      // Shared mode: the chat's open ticket is claimed with a compare-and-set on
      // `open:<chatId>`, so two replicas creating for one chat at once agree on one.
      const claimKey = this.shared && reuse ? `${this.prefix}open:${input.chatId}` : undefined
      const claimRaw = claimKey ? await this.storage.get(claimKey) : undefined
      const claimed = parseClaim(claimRaw)
      if (claimed && claimed.chatId === input.chatId) {
        const storedRaw = await this.storage.get(`${this.prefix}t:${claimed.id}`)
        const stored = storedRaw ? parseStored(`${this.prefix}t:${claimed.id}`, storedRaw) as Ticket : undefined
        if (stored?.status !== 'closed') {
          // Open, or still being written by the replica that claimed it: finish that write.
          const entry = await this.materialize(claimed)
          // Closed meanwhile: start over, the claim is now stale.
          if (entry === RETRY || entry[0].status === 'closed') return RETRY
          this.remember(entry)
          return { result: entry[0], created: false }
        }
      }
      const at = this.now()
      const id = String(this.seq + 1)
      const ticket: Ticket = {
        id,
        chatId: input.chatId,
        subject: input.subject,
        priority,
        status: 'open',
        ...(input.meta !== undefined ? { meta: clone(input.meta) } : {}),
        createdAt: at,
        updatedAt: at,
      }
      // seq first: if a later write fails the id is just skipped (never reused for
      // a ticket that might already sit in t:<id>). In shared mode this is the claim.
      if (!await this.write(`${this.prefix}seq`, this.seqRaw, id)) return RETRY
      this.seq = Number(id)
      this.seqRaw = id
      if (claimKey && !await this.storage.setIf!(claimKey, claimRaw, JSON.stringify(ticket))) return RETRY
      let entry: [Ticket, string] | typeof RETRY
      try {
        entry = await this.materialize(ticket)
      } catch (error) {
        // Best effort: release the chat's claim so the next create does not finish this one.
        if (claimKey) await this.storage.setIf!(claimKey, JSON.stringify(ticket), claimRaw ?? '').catch(() => undefined)
        throw error
      }
      if (entry === RETRY) return RETRY
      this.remember(entry)
      return { result: entry[0], created: true }
    })

    const pos = this.queued().findIndex((t) => t.id === result.id)
    const out: CreatedTicket = {
      ...clone(result),
      created,
      position: pos === -1 ? null : pos + 1,
      withinWorkingHours: this.isOpen(),
    }
    if (created) await this.fire('onCreate', () => this.opts.onCreate?.(clone(out)))
    return out
  }

  update(id: string, patch: TicketPatch): Promise<Ticket> {
    return this.apply(id, patch)
  }

  assign(id: string, assignee: string): Promise<Ticket> {
    return this.update(id, { assignee, status: 'assigned' })
  }

  private async apply(id: string, patch: TicketPatch, closeReason?: string): Promise<Ticket> {
    if (!patch || typeof patch !== 'object') throw new TypeError('tickets.update: patch must be an object')
    if (patch.subject !== undefined && typeof patch.subject !== 'string') throw new TypeError('tickets.update: subject must be a string')
    if (patch.meta !== undefined) assertMeta(patch.meta, 'update')
    if (patch.priority !== undefined) assertPriority(patch.priority)
    if (patch.status !== undefined) assertStatus(patch.status)
    if (patch.assignee !== undefined && patch.assignee !== null && (typeof patch.assignee !== 'string' || patch.assignee === '')) {
      throw new Error('tickets.update: assignee must be a non-empty string or null')
    }
    const { next, previous } = await this.serial('update', async () => {
      const found = this.activeEntry(String(id)) ?? await this.readClosed(String(id))
      if (!found) throw new TicketNotFoundError(String(id))
      const [cur, curRaw] = found
      const previous = clone(cur)
      const next: Ticket = { ...cur }
      if (patch.subject !== undefined) next.subject = patch.subject
      if (patch.priority !== undefined) next.priority = patch.priority
      if (patch.meta !== undefined) next.meta = clone(patch.meta)
      if (patch.assignee !== undefined) {
        if (patch.assignee === null) {
          delete next.assignee
          if (next.status === 'assigned') next.status = 'open'
        } else {
          next.assignee = patch.assignee
          if (next.status === 'open' || next.status === 'pending') next.status = 'assigned'
        }
      }
      if (patch.status !== undefined) next.status = patch.status
      if (next.status === 'closed' && previous.status !== 'closed') next.closedAt = this.now()
      if (next.status !== 'closed') { delete next.closedAt; delete next.closeReason }
      else if (closeReason !== undefined) next.closeReason = closeReason
      next.updatedAt = Math.max(this.now(), previous.updatedAt + 1)
      const nextRaw = JSON.stringify(next)
      const wasActive = previous.status !== 'closed'
      const isActive = next.status !== 'closed'
      // Reopening: list the id before the ticket turns active, so an active ticket is
      // never left outside the index (a closed id in the index is harmless).
      if (!wasActive && isActive) await this.editIndex('update', (ids) => [...ids.filter((k) => k !== next.id), next.id])
      if (!await this.write(`${this.prefix}t:${next.id}`, curRaw, nextRaw)) return RETRY
      if (wasActive && !isActive) {
        try {
          await this.editIndex('update', (ids) => ids.filter((k) => k !== next.id))
        } catch (error) {
          // Best effort: put the previous ticket back so storage matches memory.
          if (curRaw !== undefined) await this.write(`${this.prefix}t:${next.id}`, nextRaw, curRaw).catch(() => undefined)
          throw error
        }
      }
      if (isActive) { this.tickets.set(next.id, next); this.raws.set(next.id, nextRaw) }
      else { this.tickets.delete(next.id); this.raws.delete(next.id) }
      return { next, previous }
    })

    await this.fire('onUpdate', () => this.opts.onUpdate?.(clone(next), previous))
    const newlyAssigned = next.assignee !== undefined && next.assignee !== previous.assignee && next.status === 'assigned'
    if (newlyAssigned) await this.fire('onAssign', () => this.opts.onAssign?.(clone(next)))
    if (next.status === 'closed' && previous.status !== 'closed') await this.fire('onClose', () => this.opts.onClose?.(clone(next)))
    return clone(next)
  }

  close(id: string, opts: { reason?: string } = {}): Promise<Ticket> {
    if (opts?.reason !== undefined && typeof opts.reason !== 'string') {
      return Promise.reject(new TypeError('tickets.close: reason must be a string'))
    }
    return this.apply(id, { status: 'closed' }, opts.reason)
  }

  /* ------------------------------------------------------------- internals */

  private queued(): Ticket[] {
    return [...this.tickets.values()]
      .filter((t) => t.status === 'open')
      .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.createdAt - b.createdAt || Number(a.id) - Number(b.id))
  }

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      const seqRaw = await this.storage.get(`${this.prefix}seq`)
      const seq = Number(seqRaw)
      const ids = parseIndex(`${this.prefix}index`, await this.storage.get(`${this.prefix}index`))
      const map = new Map<string, Ticket>()
      const raws = new Map<string, string>()
      // Older indexes may still list closed tickets: they are simply not kept in memory.
      for (const [t, raw] of await this.readMany(ids)) {
        if (t.status !== 'closed') { map.set(t.id, t); raws.set(t.id, raw) }
      }
      this.tickets = map
      this.raws = raws
      const maxId = Math.max(0, ...ids.map(Number).filter(Number.isFinite))
      this.seq = Math.max(Number.isFinite(seq) ? seq : 0, maxId)
      this.seqRaw = seqRaw
    })()
    // A failed load is retried on the next call instead of poisoning the desk.
    this.loaded.catch(() => { this.loaded = undefined })
    return this.loaded
  }

  /** Load once (single writer), or re-read storage (shared mode: other replicas write too). */
  private fresh(): Promise<void> {
    if (this.shared) this.loaded = undefined
    return this.load()
  }

  /**
   * Run a mutation under the local lock on fresh state. In shared mode a step that lost
   * a compare-and-set returns `RETRY` and runs again on re-read state, up to
   * `maxRetries` times.
   */
  private serial<T>(operation: string, fn: () => Promise<T | typeof RETRY>): Promise<T> {
    const run = this.lock.then(async () => {
      for (let attempt = 0; attempt < this.maxRetries; attempt++) {
        await this.fresh()
        const out = await fn()
        if (out !== RETRY) return out
      }
      throw new TicketContentionError(operation)
    })
    this.lock = run.catch(() => undefined)
    return run
  }

  /** Plain `set`, or compare-and-set against `expected` (by value) in shared mode. */
  private async write(key: string, expected: string | undefined, value: string): Promise<boolean> {
    if (!this.shared) { await this.storage.set(key, value); return true }
    return this.storage.setIf!(key, expected, value)
  }

  /** Rewrite the active-id index; shared mode re-reads it and retries on conflict. */
  private async editIndex(operation: string, edit: (ids: string[]) => string[]): Promise<void> {
    const key = `${this.prefix}index`
    if (!this.shared) {
      await this.storage.set(key, JSON.stringify(edit([...this.tickets.keys()])))
      return
    }
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const raw = await this.storage.get(key)
      const next = [...new Set(edit(parseIndex(key, raw)))]
      if (await this.storage.setIf!(key, raw, JSON.stringify(next))) return
    }
    throw new TicketContentionError(operation)
  }

  /**
   * Store a new ticket: list its id in the index first, then write `t:<id>`. A create
   * that fails or dies in between leaves at most an index entry with no ticket (skipped
   * on read), never an active ticket outside the index. In shared mode another replica
   * may have written the same ticket already (finishing a claimed create): the stored
   * version wins. `RETRY` when `t:<id>` is gone after a lost compare-and-set.
   */
  private async materialize(ticket: Ticket): Promise<[Ticket, string] | typeof RETRY> {
    const key = `${this.prefix}t:${ticket.id}`
    const raw = JSON.stringify(ticket)
    await this.editIndex('create', (ids) => [...ids, ticket.id])
    if (await this.write(key, undefined, raw)) return [ticket, raw]
    const current = await this.storage.get(key)
    return current ? [parseStored(key, current) as Ticket, current] : RETRY
  }

  /** Keep an active ticket (and its raw witness) in memory. */
  private remember([ticket, raw]: [Ticket, string]): void {
    if (ticket.status === 'closed') return
    this.tickets.set(ticket.id, ticket)
    this.raws.set(ticket.id, raw)
  }

  private activeEntry(id: string): [Ticket, string | undefined] | undefined {
    const t = this.tickets.get(id)
    return t ? [t, this.raws.get(id)] : undefined
  }

  /** Read tickets by id, `READ_BATCH` reads at a time; missing ids are skipped. */
  private async readMany(ids: string[]): Promise<Array<[Ticket, string]>> {
    const out: Array<[Ticket, string]> = []
    for (let i = 0; i < ids.length; i += READ_BATCH) {
      const keys = ids.slice(i, i + READ_BATCH).map((id) => `${this.prefix}t:${id}`)
      const raws = await Promise.all(keys.map((key) => this.storage.get(key)))
      raws.forEach((raw, j) => { if (raw) out.push([parseStored(keys[j]!, raw) as Ticket, raw]) })
    }
    return out
  }

  /** A closed ticket from storage (active ones always live in memory). */
  private async readClosed(id: string): Promise<[Ticket, string] | undefined> {
    if (this.tickets.has(id)) return undefined
    const [entry] = await this.readMany([id])
    return entry?.[0].status === 'closed' ? entry : undefined
  }

  private async fire(source: TicketCallbackName, fn: () => void | Promise<void>): Promise<void> {
    try {
      await fn()
    } catch (error) {
      try { this.opts.onError?.(error, source) } catch { /* never let reporting fail the operation */ }
    }
  }
}
