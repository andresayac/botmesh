/**
 * KvContactStore — {@link ContactStore} persisted through any `DurableKv` of
 * `@botmesh/core` (SQLite, PostgreSQL, Redis, file or memory) via `@botmesh/tenant-kv`.
 *
 * One table per tenant, `product/crm/contact/<tenant>`: id = contact id, `all` index =
 * most recently updated first. `upsert` replaces the document, `setConsent` is a
 * compare-and-set loop (a concurrent writer is retried, never overwritten), and reads
 * validate the stored document instead of trusting it.
 */

import type { DurableKv } from '@botmesh/core'
import { TenantDocs } from '@botmesh/tenant-kv'
import {
  DEFAULT_LIST_LIMIT,
  DEFAULT_SCAN,
  assertConsent,
  assertContactIds,
  assertLimit,
  cloneContact,
  matchesSegment,
  normalizeContact,
} from './memory.js'
import type { ContactStore } from './store.js'
import { ContactNotFoundError, type Contact, type ContactInput, type ContactListOptions, type ContactSegment } from './types.js'

export interface KvContactStoreOptions {
  /** Time source (epoch ms). Default `Date.now`. */
  clock?: () => number
  /** Compare-and-set retries of `upsert` and `setConsent` before a `KvContentionError` (default 32). */
  attempts?: number
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isString = (v: unknown): v is string => typeof v === 'string'
const isAttr = (v: unknown): v is string | number | boolean => isString(v) || typeof v === 'number' || typeof v === 'boolean'

function parseContact(value: unknown): Contact {
  if (!isRecord(value)) throw new TypeError('contact is not an object')
  const { tenantId, id, channels, tags, attributes, marketingConsent, updatedAt } = value
  if (!isString(tenantId) || !isString(id) || typeof marketingConsent !== 'boolean' || typeof updatedAt !== 'number') {
    throw new TypeError('bad contact')
  }
  if (!isRecord(channels) || !Object.values(channels).every(isString)) throw new TypeError('bad contact channels')
  if (!Array.isArray(tags) || !tags.every(isString)) throw new TypeError('bad contact tags')
  if (!isRecord(attributes) || !Object.values(attributes).every(isAttr)) throw new TypeError('bad contact attributes')
  return {
    tenantId,
    id,
    channels: { ...(channels as Record<string, string>) },
    tags: [...tags],
    attributes: { ...(attributes as Record<string, string | number | boolean>) },
    marketingConsent,
    updatedAt,
  }
}

export class KvContactStore implements ContactStore {
  private readonly contacts: TenantDocs<Contact>
  private readonly clock: () => number

  constructor(kv: DurableKv, options: KvContactStoreOptions = {}) {
    this.clock = options.clock ?? Date.now
    const attempts = options.attempts ?? 32
    if (!Number.isInteger(attempts) || attempts < 1) throw new RangeError('attempts must be a positive integer')
    this.contacts = new TenantDocs<Contact>(kv, {
      family: ['crm', 'contact'],
      parse: parseContact,
      order: (contact) => -contact.updatedAt,
      attempts,
    })
  }

  /**
   * A compare-and-set loop like `setConsent`: concurrent upserts of one contact never fail,
   * the last one wins whole (as in `MemoryContactStore`).
   * @throws {KvContentionError} after `attempts` lost compare-and-sets.
   */
  async upsert(input: ContactInput): Promise<Contact> {
    const contact = normalizeContact(input, this.clock())
    const written = await this.contacts.in(contact.tenantId).update(contact.id, () => contact)
    return cloneContact(written!.doc)
  }

  async get(tenantId: string, id: string): Promise<Contact | undefined> {
    assertContactIds(tenantId, id)
    const entry = await this.contacts.in(tenantId).get(id)
    return entry && cloneContact(entry.doc)
  }

  async segment(tenantId: string, rule: ContactSegment, options: ContactListOptions = {}): Promise<Contact[]> {
    assertContactIds(tenantId)
    const limit = assertLimit(options.limit, DEFAULT_LIST_LIMIT, 'limit')
    const scan = assertLimit(options.scan, DEFAULT_SCAN, 'scan')
    const candidates = await this.contacts.in(tenantId).list({ limit: scan })
    return candidates.filter((contact) => matchesSegment(contact, rule)).slice(0, limit).map(cloneContact)
  }

  /** @throws {ContactNotFoundError} when absent; {@link KvContentionError} after `attempts` lost compare-and-sets. */
  async setConsent(tenantId: string, id: string, marketingConsent: boolean): Promise<Contact> {
    assertContactIds(tenantId, id)
    assertConsent(marketingConsent)
    const written = await this.contacts.in(tenantId).update(id, (current) =>
      current && { ...current, marketingConsent, updatedAt: this.clock() },
    )
    if (!written) throw new ContactNotFoundError()
    return cloneContact(written.doc)
  }

  async erase(tenantId: string, id: string): Promise<boolean> {
    assertContactIds(tenantId, id)
    return this.contacts.in(tenantId).delete(id)
  }
}
