import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { redactSecrets } from './redact.js'

export type ControlAction =
  | 'bots:read' | 'bots:write' | 'bots:operate'
  | 'messages:read' | 'messages:send'
  | 'connections:read' | 'connections:write'
  | 'secrets:write' | 'audit:read'

export interface Principal {
  id: string
  tenantId: string
  scopes: readonly ControlAction[]
}

export function assertAuthorized(principal: Principal, tenantId: string, action: ControlAction): void {
  if (!principal.id || !principal.tenantId) throw new Error('principal id and tenantId are required')
  if (principal.tenantId !== tenantId) throw new ControlPlaneError('cross-tenant access denied', 'FORBIDDEN')
  if (!principal.scopes.includes(action)) throw new ControlPlaneError(`missing scope: ${action}`, 'FORBIDDEN')
}

export class ControlPlaneError extends Error {
  constructor(message: string, readonly code: 'FORBIDDEN' | 'CONFLICT' | 'NOT_FOUND' | 'INVALID') {
    super(message)
    this.name = 'ControlPlaneError'
  }
}

export interface AuditEntry {
  id: string
  at: number
  tenantId: string
  actorId: string
  action: string
  resource: string
  outcome: 'allowed' | 'denied' | 'failed'
  requestId?: string
  metadata?: Record<string, unknown>
}

/** Options of {@link AuditLog}. */
export interface AuditLogOptions {
  /** Entries kept in memory; the oldest are dropped first. Default `10000`. */
  maxEntries?: number
}

/**
 * In-memory audit sink with secret-aware metadata redaction. Bounded (`maxEntries`): it is
 * a window over recent activity, not durable storage; forward entries elsewhere to keep them.
 */
export class AuditLog {
  private readonly entries: AuditEntry[] = []
  private readonly maxEntries: number
  constructor(options: AuditLogOptions = {}) {
    this.maxEntries = options.maxEntries ?? 10_000
    if (!Number.isInteger(this.maxEntries) || this.maxEntries < 1) throw new ControlPlaneError('AuditLog maxEntries must be a positive integer', 'INVALID')
  }
  append(entry: Omit<AuditEntry, 'id' | 'at' | 'metadata'> & { metadata?: Record<string, unknown> }): AuditEntry {
    const record: AuditEntry = {
      ...entry,
      id: randomBytes(12).toString('hex'),
      at: Date.now(),
      metadata: redact(entry.metadata),
    }
    this.entries.push(record)
    if (this.entries.length > this.maxEntries) this.entries.splice(0, this.entries.length - this.maxEntries)
    return { ...record, metadata: record.metadata ? { ...record.metadata } : undefined }
  }
  list(tenantId: string): AuditEntry[] {
    return this.entries.filter((entry) => entry.tenantId === tenantId).map((entry) => ({ ...entry, metadata: entry.metadata ? { ...entry.metadata } : undefined }))
  }
}

/** AES-256-GCM secret vault. Responses expose a reference, never a value. */
export class SecretVault {
  private readonly records = new Map<string, { tenantId: string; iv: Buffer; tag: Buffer; ciphertext: Buffer; version: number }>()
  private readonly key: Buffer
  constructor(masterKey: Buffer | string) {
    this.key = Buffer.isBuffer(masterKey) ? Buffer.from(masterKey) : Buffer.from(masterKey, 'base64')
    if (this.key.byteLength !== 32) throw new ControlPlaneError('SecretVault master key must be exactly 32 bytes', 'INVALID')
  }
  put(tenantId: string, name: string, value: string): { ref: string; version: number } {
    if (!tenantId || !name || !value) throw new ControlPlaneError('tenantId, name and value are required', 'INVALID')
    const ref = `${tenantId}:${name}`
    const key = recordKey(tenantId, ref)
    const previous = this.records.get(key)
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    this.records.set(key, { tenantId, iv, tag: cipher.getAuthTag(), ciphertext, version: (previous?.version ?? 0) + 1 })
    return { ref, version: (previous?.version ?? 0) + 1 }
  }
  get(tenantId: string, ref: string): string {
    const record = this.records.get(recordKey(tenantId, ref))
    if (!record || record.tenantId !== tenantId) throw new ControlPlaneError('secret not found', 'NOT_FOUND')
    const decipher = createDecipheriv('aes-256-gcm', this.key, record.iv)
    decipher.setAuthTag(record.tag)
    return Buffer.concat([decipher.update(record.ciphertext), decipher.final()]).toString('utf8')
  }
  describe(tenantId: string, ref: string): { ref: string; version: number } {
    const record = this.records.get(recordKey(tenantId, ref))
    if (!record || record.tenantId !== tenantId) throw new ControlPlaneError('secret not found', 'NOT_FOUND')
    return { ref, version: record.version }
  }
}

/** Options of {@link IdempotencyRegistry}. */
export interface IdempotencyRegistryOptions {
  /** Keys remembered; the oldest are forgotten first. Default `1000`. */
  maxEntries?: number
}

/** Ensures repeated tenant-scoped idempotency keys reuse one outcome (bounded by `maxEntries`). */
export class IdempotencyRegistry<T> {
  private readonly records = new Map<string, { fingerprint: string; promise: Promise<T> }>()
  private readonly maxEntries: number
  constructor(options: IdempotencyRegistryOptions = {}) {
    this.maxEntries = options.maxEntries ?? 1000
    if (!Number.isInteger(this.maxEntries) || this.maxEntries < 1) throw new ControlPlaneError('IdempotencyRegistry maxEntries must be a positive integer', 'INVALID')
  }
  /** Keys currently remembered. */
  get size(): number { return this.records.size }
  async run(tenantId: string, key: string, fingerprint: string, operation: () => Promise<T>): Promise<T> {
    if (!tenantId || !key) throw new ControlPlaneError('tenantId and idempotency key are required', 'INVALID')
    const composite = `${tenantId}\u0000${key}`
    const existing = this.records.get(composite)
    if (existing) {
      // Same key MUST mean the same request. Reusing it for a different
      // operation is a client bug — fail loudly instead of silently skipping
      // the new operation and returning the previous result.
      if (existing.fingerprint !== fingerprint) {
        throw new ControlPlaneError('idempotency key reused for a different request', 'CONFLICT')
      }
      return existing.promise
    }
    const promise = operation().catch((error) => {
      this.records.delete(composite)
      throw error
    })
    this.records.set(composite, { fingerprint, promise })
    while (this.records.size > this.maxEntries) this.records.delete(this.records.keys().next().value!)
    return promise
  }
}

/** Constant-time API key check over SHA-256 digests (the key length is not leaked either). */
export function verifyApiKey(presented: string, expected: string): boolean {
  return timingSafeEqual(sha256(presented), sha256(expected))
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

/**
 * Vault map key. Scoped by tenant with a NUL separator: the public ref
 * (`tenant:name`) is ambiguous when ids contain `:` (`a:b` + `c` and `a` + `b:c`),
 * and must never let one tenant overwrite another tenant's secret.
 */
function recordKey(tenantId: string, ref: string): string {
  return `${tenantId}\u0000${ref}`
}

function redact(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  return metadata ? redactSecrets(metadata) : undefined
}
