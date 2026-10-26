/**
 * DeploymentStore — the storage contract of `@botmesh/deployments`. `MemoryDeploymentStore`
 * is the reference implementation and `KvDeploymentStore` persists through any
 * `DurableKv` of `@botmesh/core`; both pass `test-utils/deployment-store-conformance.ts`.
 *
 * Per tenant and bot the store keeps immutable version records, exactly one active
 * version, short-lived reservations (a version whose gate is still running) and the
 * audit log of gate runs. Every read returns a copy.
 */

import type { Deployment, GateRecord, GateRun } from './types.js'

/** Options of {@link DeploymentStore.list}. */
export interface DeploymentListOptions {
  limit?: number
  /** Continue after this version (the last one of the previous page). */
  after?: string
}

/**
 * The versions {@link DeploymentStore.prune} deletes from `versions` (publish order): every
 * one outside the newest `keep`, except `active` (an older active version is kept too).
 * @internal
 */
export function versionsToPrune(versions: readonly string[], active: string | null, keep: number): string[] {
  if (!Number.isInteger(keep) || keep < 1) throw new RangeError('prune(): keep must be a positive integer')
  const newest = new Set(versions.slice(Math.max(0, versions.length - keep)))
  return versions.filter((v) => !newest.has(v) && v !== active)
}

/**
 * The slice of `versions` a {@link DeploymentStore.list} page returns.
 * @internal
 */
export function versionsPage(versions: readonly string[], limit: number, after: string | undefined): string[] {
  let start = 0
  if (after !== undefined) {
    const i = versions.indexOf(after)
    if (i === -1) return []
    start = i + 1
  }
  return versions.slice(start, start + limit)
}

/** Input of {@link DeploymentStore.commit}. */
export interface CommitInput {
  tenantId: string
  botId: string
  version: string
  artifact: string
  /** Trace of the gate the version passed. */
  gate?: GateRecord
  /**
   * `true` when the caller holds the reservation of this version (a gated publish):
   * the reservation is consumed. Otherwise a live reservation by a running gate
   * refuses the commit with `DeploymentExistsError`.
   */
  reserved?: boolean
  /**
   * With `reserved`, the `until` the caller passed to {@link DeploymentStore.reserve}. Once
   * that reservation expired and another publish holds a live one, the commit is refused
   * with `DeploymentExistsError` instead of taking the version from its new owner.
   */
  reservedUntil?: number
}

/**
 * Whether the live reservation `live` (the stored expiry of the version, if any) belongs to
 * someone other than the caller of a commit, which must then be refused.
 * @internal
 */
export function heldByOther(input: CommitInput, live: number | undefined, now: number): boolean {
  if (live === undefined || live <= now) return false
  if (!input.reserved) return true
  return input.reservedUntil !== undefined && live !== input.reservedUntil
}

export interface DeploymentStore {
  /**
   * Reserve `version` for a gate that is about to run, until `until` (epoch ms).
   * `false` when the version exists or another live reservation holds it.
   */
  reserve(tenantId: string, botId: string, version: string, until: number): Promise<boolean>
  /** Drop the reservation of `version` (no-op when there is none). */
  release(tenantId: string, botId: string, version: string): Promise<void>
  /**
   * Store the version and make it the active one, in one atomic step with respect to
   * the bot's other versions.
   * @throws {DeploymentExistsError} when the version exists or is reserved by someone else.
   */
  commit(input: CommitInput): Promise<Deployment>
  /**
   * Make a stored version the active one (rollback).
   * @throws {DeploymentNotFoundError} when it does not exist in that tenant and bot.
   */
  activate(tenantId: string, botId: string, version: string): Promise<Deployment>
  /** The active version, or `undefined` before the first publish. */
  active(tenantId: string, botId: string): Promise<Deployment | undefined>
  /** One version, or `undefined`. */
  get(tenantId: string, botId: string, version: string): Promise<Deployment | undefined>
  /**
   * Versions in publish order (at most `limit`, default 1000). `after` (the last version
   * of the previous page) continues from the next one; an unknown `after` gives `[]`.
   */
  list(tenantId: string, botId: string, options?: DeploymentListOptions): Promise<Deployment[]>
  /**
   * Delete the versions older than the newest `keep` (`keep` >= 1), except the active one
   * (kept on top of them when it is older, e.g. after a rollback). Returns how many were deleted; a deleted version
   * can be published again. Gate runs stay as an audit trail.
   */
  prune(tenantId: string, botId: string, keep: number): Promise<number>
  /** Persist the outcome of a gate run (pass or fail) and return it with its id. */
  recordGateRun(run: Omit<GateRun, 'id'>): Promise<GateRun>
  /** Gate runs of one version, oldest first (at most `limit`, default 100). */
  listGateRuns(tenantId: string, botId: string, version: string, options?: { limit?: number }): Promise<GateRun[]>
}
