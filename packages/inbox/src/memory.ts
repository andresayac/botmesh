/**
 * MemoryInboxStore — the in-RAM reference implementation of {@link InboxStore}, plus
 * the pure helpers (direction, filters, patches, note ids) both stores share. Every
 * read returns a copy; state is lost on restart (use `KvInboxStore` to persist).
 */

import { randomUUID } from 'node:crypto'
import type { StoredMessage } from '@botmesh/core'
import { assertTenantId } from '@botmesh/tenant-kv'
import type { InboxStore } from './store.js'
import {
  InboxConflictError,
  InboxNotFoundError,
  type ConversationStatus,
  type InboxConversation,
  type InboxListOptions,
  type InboxNoteListOptions,
  type InboxNote,
  type InboxPatch,
  type InboxUpsert,
} from './types.js'

export interface MemoryInboxStoreOptions {
  /** Time source (epoch ms). Default `Date.now`. */
  clock?: () => number
}

export const DEFAULT_LIST_LIMIT = 100
export const DEFAULT_SCAN = 1000
export const DEFAULT_NOTES_LIMIT = 100

/** Explicit direction, else derived from `fromMe`; throws when neither is set or the message has no chat (or an empty tenant). */
export function messageDirection(message: StoredMessage): 'inbound' | 'outbound' {
  assertTenantId(message.chatId, 'chatId')
  if (message.tenantId !== undefined) assertTenantId(message.tenantId)
  if (message.direction === 'inbound' || message.direction === 'outbound') return message.direction
  if (message.fromMe === true) return 'outbound'
  if (message.fromMe === false) return 'inbound'
  throw new TypeError('cannot project a message without direction or fromMe')
}

export function matchesFilter(conversation: InboxConversation, filter: InboxListOptions): boolean {
  return (!filter.status || conversation.status === filter.status) &&
    (!filter.assigneeId || conversation.assigneeId === filter.assigneeId)
}

export function assertLimit(value: number | undefined, fallback: number, what: string): number {
  if (value === undefined) return fallback
  if (!(Number.isInteger(value) || value === Number.POSITIVE_INFINITY) || value < 0) throw new RangeError(`${what} must be a non-negative integer`)
  return value
}

export function assertUnread(value: number | undefined): void {
  if (value !== undefined && !(Number.isInteger(value) && value >= 0)) throw new RangeError('unread must be a non-negative integer')
}

/** @throws {TypeError} for an empty `authorId`; `Error` for a blank `body`. */
export function assertNoteBody(body: string, authorId: string): void {
  assertTenantId(authorId, 'authorId')
  if (typeof body !== 'string' || !body.trim()) throw new Error('note body is required')
}

const STATUSES: ReadonlySet<unknown> = new Set<ConversationStatus>(['open', 'pending', 'resolved'])

/** @throws {TypeError} for a status outside `open | pending | resolved`. */
export function assertStatus(value: unknown): void {
  if (!STATUSES.has(value)) throw new TypeError('status must be "open", "pending" or "resolved"')
}

function assertHandoff(value: unknown): void {
  if (typeof value !== 'boolean') throw new TypeError('handoff must be a boolean')
}

function assertAssignee(value: unknown): void {
  if (typeof value !== 'string' || value === '') throw new TypeError('assigneeId must be a non-empty string')
}

function assertSlaDueAt(value: unknown): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('slaDueAt must be a finite number (epoch ms)')
}

/** Apply an agent patch (without touching `version`/`updatedAt`). */
export function applyPatch(conversation: InboxConversation, patch: InboxPatch): InboxConversation {
  assertUnread(patch.unread)
  if (patch.status !== undefined) assertStatus(patch.status)
  if (patch.handoff !== undefined) assertHandoff(patch.handoff)
  if (patch.assigneeId !== undefined && patch.assigneeId !== null) assertAssignee(patch.assigneeId)
  if (patch.slaDueAt !== undefined && patch.slaDueAt !== null) assertSlaDueAt(patch.slaDueAt)
  const next: InboxConversation = { ...conversation }
  if (patch.status !== undefined) next.status = patch.status
  if (patch.handoff !== undefined) next.handoff = patch.handoff
  if (patch.unread !== undefined) next.unread = patch.unread
  if (patch.assigneeId === null) delete next.assigneeId
  else if (patch.assigneeId !== undefined) next.assigneeId = patch.assigneeId
  if (patch.slaDueAt === null) delete next.slaDueAt
  else if (patch.slaDueAt !== undefined) next.slaDueAt = patch.slaDueAt
  return next
}

/** The merged conversation of an upsert over `old` (or a new one), `version` bumped. */
export function mergeUpsert(old: InboxConversation | undefined, input: InboxUpsert, now: number): InboxConversation {
  assertUnread(input.unread)
  assertStatus(input.status)
  assertHandoff(input.handoff)
  // An omitted optional field keeps its stored value; an explicit `undefined` clears it.
  const assigneeId = 'assigneeId' in input ? input.assigneeId : old?.assigneeId
  const slaDueAt = 'slaDueAt' in input ? input.slaDueAt : old?.slaDueAt
  if (assigneeId !== undefined) assertAssignee(assigneeId)
  if (slaDueAt !== undefined) assertSlaDueAt(slaDueAt)
  // Only known fields are stored, so every store keeps exactly the same shape.
  const next: InboxConversation = {
    tenantId: input.tenantId,
    id: input.id,
    status: input.status,
    handoff: input.handoff,
    unread: input.unread ?? old?.unread ?? 0,
    version: (old?.version ?? 0) + 1,
    updatedAt: now,
  }
  if (assigneeId !== undefined) next.assigneeId = assigneeId
  if (slaDueAt !== undefined) next.slaDueAt = slaDueAt
  return next
}

/** `true` when an upsert with `expectedVersion` may proceed over `old`. */
export function upsertAllowed(old: InboxConversation | undefined, expectedVersion: number | undefined): boolean {
  return old ? expectedVersion === old.version : (expectedVersion ?? 0) === 0
}

let noteSeq = 0

/** Note id: zero-padded `createdAt`, an in-process sequence and a random suffix (sortable, unique). */
export function noteId(createdAt: number): string {
  noteSeq = (noteSeq + 1) % 1_000_000
  return `${String(Math.max(0, Math.floor(createdAt))).padStart(15, '0')}-${String(noteSeq).padStart(6, '0')}-${randomUUID().slice(0, 8)}`
}

/** Most recently updated first, ties by id. */
export function byRecency(a: InboxConversation, b: InboxConversation): number {
  return b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** NUL-separated key, so equal ids in different tenants never collide. */
const key = (tenantId: string, id: string) => `${tenantId}\u0000${id}`

export class MemoryInboxStore implements InboxStore {
  private readonly conversations = new Map<string, InboxConversation>()
  private readonly notes = new Map<string, InboxNote[]>()
  private readonly clock: () => number

  constructor(options: MemoryInboxStoreOptions = {}) {
    this.clock = options.clock ?? Date.now
  }

  async upsert(input: InboxUpsert, expectedVersion?: number): Promise<InboxConversation> {
    assertTenantId(input.tenantId)
    assertTenantId(input.id, 'id')
    const old = this.conversations.get(key(input.tenantId, input.id))
    if (!upsertAllowed(old, expectedVersion)) throw new InboxConflictError()
    const next = mergeUpsert(old, input, this.clock())
    this.conversations.set(key(input.tenantId, input.id), next)
    return { ...next }
  }

  async get(tenantId: string, id: string): Promise<InboxConversation | undefined> {
    assertTenantId(tenantId)
    assertTenantId(id, 'id')
    const value = this.conversations.get(key(tenantId, id))
    return value && { ...value }
  }

  async list(tenantId: string, options: InboxListOptions = {}): Promise<InboxConversation[]> {
    assertTenantId(tenantId)
    const limit = assertLimit(options.limit, DEFAULT_LIST_LIMIT, 'limit')
    const scan = assertLimit(options.scan, DEFAULT_SCAN, 'scan')
    const activeOnly = options.status === 'open' || options.status === 'pending'
    return [...this.conversations.values()]
      .filter((c) => c.tenantId === tenantId && (!activeOnly || c.status !== 'resolved'))
      .sort(byRecency)
      .slice(0, scan)
      .filter((c) => matchesFilter(c, options))
      .slice(0, limit)
      .map((c) => ({ ...c }))
  }

  async update(tenantId: string, id: string, expectedVersion: number, patch: InboxPatch): Promise<InboxConversation> {
    assertTenantId(tenantId)
    assertTenantId(id, 'id')
    const old = this.conversations.get(key(tenantId, id))
    if (!old) throw new InboxNotFoundError()
    if (old.version !== expectedVersion) throw new InboxConflictError()
    const next = { ...applyPatch(old, patch), version: old.version + 1, updatedAt: this.clock() }
    this.conversations.set(key(tenantId, id), next)
    return { ...next }
  }

  async applyMessage(message: StoredMessage): Promise<InboxConversation> {
    const direction = messageDirection(message)
    const tenantId = message.tenantId ?? 'local'
    const delta = direction === 'inbound' ? 1 : 0
    const old = this.conversations.get(key(tenantId, message.chatId))
    const next: InboxConversation = old
      ? { ...old, unread: old.unread + delta, version: old.version + 1, updatedAt: this.clock() }
      : { tenantId, id: message.chatId, status: 'open', handoff: false, unread: delta, version: 1, updatedAt: this.clock() }
    this.conversations.set(key(tenantId, message.chatId), next)
    return { ...next }
  }

  async addNote(tenantId: string, conversationId: string, authorId: string, body: string): Promise<InboxNote> {
    assertTenantId(tenantId)
    assertTenantId(conversationId, 'conversationId')
    if (!this.conversations.has(key(tenantId, conversationId))) throw new InboxNotFoundError()
    assertNoteBody(body, authorId)
    const createdAt = this.clock()
    const note: InboxNote = { id: noteId(createdAt), tenantId, conversationId, authorId, body, createdAt }
    const k = key(tenantId, conversationId)
    this.notes.set(k, [...(this.notes.get(k) ?? []), note])
    return { ...note }
  }

  async listNotes(tenantId: string, conversationId: string, options: InboxNoteListOptions = {}): Promise<InboxNote[]> {
    assertTenantId(tenantId)
    assertTenantId(conversationId, 'conversationId')
    const limit = assertLimit(options.limit, DEFAULT_NOTES_LIMIT, 'limit')
    return notesPage(this.notes.get(key(tenantId, conversationId)) ?? [], limit, options.after).map((note) => ({ ...note }))
  }

  async erase(tenantId: string, conversationId: string): Promise<boolean> {
    assertTenantId(tenantId)
    assertTenantId(conversationId, 'conversationId')
    const k = key(tenantId, conversationId)
    const hadNotes = this.notes.delete(k)
    return this.conversations.delete(k) || hadNotes
  }
}

/** The page of `notes` (creation order) after the note `after` (`[]` when it is unknown). */
export function notesPage<T extends { id: string }>(notes: readonly T[], limit: number, after: string | undefined): T[] {
  let start = 0
  if (after !== undefined) {
    const i = notes.findIndex((note) => note.id === after)
    if (i === -1) return []
    start = i + 1
  }
  return notes.slice(start, start + limit)
}
