/**
 * The storage seam of the KV-backed journals ({@link KvDurability}).
 *
 * A backend only has to offer versioned compare-and-set on opaque JSON documents plus
 * two sorted indexes; every state transition, lease and fencing rule lives once in
 * `journal.ts`, so all backends behave identically and the shared conformance suite
 * covers them all. Implemented in core by {@link MemoryKv} (and the file backend),
 * by `@botmesh/postgres-store` (one table, `UPDATE … WHERE version = $n`) and by
 * `@botmesh/redis-store` (compare-and-set script + sorted sets).
 */

/**
 * A journal table: `'inbox'` / `'outbox'`, or a scoped one (`'inbox:<scope>'`, see
 * `DurabilityBackend.scope`). A backend stores any table name as an opaque string and
 * keeps tables fully separate (ids, indexes, ranges).
 *
 * @category Durability
 */
export type DurableTable = string

/**
 * A stored document and its opaque version (changes on every write).
 *
 * @category Durability
 */
export interface DurableKvEntry {
  value: string
  version: string
}

/**
 * Index scores of a document (epoch ms), `null` = not in that index.
 * `due`: when a non-terminal record next needs attention (retry time or lease expiry).
 * `done`: when a terminal record completed (retention purge).
 *
 * @category Durability
 */
export interface DurableKvIndex {
  due: number | null
  done: number | null
}

/**
 * One committed write, as handed to `MemoryKv.changed()`. Append-only file backends record
 * it in a log instead of rewriting the whole snapshot; the version it carries is what the
 * next reader must see (the store's opaque version, here the numeric counter as a string).
 *
 * @category Durability
 */
export type KvMutation =
  | { op: 'insert' | 'replace'; table: DurableTable; id: string; value: string; version: string; index: DurableKvIndex }
  | { op: 'remove'; table: DurableTable; id: string }

/**
 * Versioned document store with two sorted indexes per table.
 *
 * Contract (checked by `runDurableKvConformance`):
 *  - `insert` writes only when `id` is absent and returns the new version, else `undefined`;
 *  - `replace` writes only when the stored version equals `version` and returns the new
 *    version, else `undefined` (missing document or concurrent write);
 *  - `remove` deletes only when the stored version equals `version`;
 *  - `range` returns ids whose index score is `<= max`, ascending by score, at most `limit`.
 *    It may return ids whose document changed since (callers re-read); it must not miss a
 *    document whose committed score is `<= max` beyond `limit`.
 *
 * @category Durability
 */
export interface DurableKv {
  start?(): Promise<void>
  stop?(): Promise<void>
  get(table: DurableTable, id: string): Promise<DurableKvEntry | undefined>
  insert(table: DurableTable, id: string, value: string, index: DurableKvIndex): Promise<string | undefined>
  replace(table: DurableTable, id: string, version: string, value: string, index: DurableKvIndex): Promise<string | undefined>
  remove(table: DurableTable, id: string, version: string): Promise<boolean>
  range(table: DurableTable, index: keyof DurableKvIndex, max: number, limit: number): Promise<string[]>
}

interface MemoryRow {
  value: string
  version: number
  index: DurableKvIndex
}

/**
 * Serializable state of a {@link MemoryKv} (the file backend's snapshot).
 *
 * @category Durability
 */
export interface MemoryKvSnapshot {
  version: 1
  tables: Record<string, Array<[id: string, value: string, version: number, due: number | null, done: number | null]>>
  /** Sequence of the append-only log this snapshot already contains (absent on whole-file snapshots). */
  logSeq?: number
}

/**
 * In-process {@link DurableKv}: the reference implementation.
 *
 * @category Durability
 */
export class MemoryKv implements DurableKv {
  private tables = new Map<DurableTable, Map<string, MemoryRow>>()

  private rowsOf(table: DurableTable): Map<string, MemoryRow> {
    let rows = this.tables.get(table)
    if (!rows) { rows = new Map(); this.tables.set(table, rows) }
    return rows
  }

  async get(table: DurableTable, id: string): Promise<DurableKvEntry | undefined> {
    const row = this.rowsOf(table).get(id)
    return row ? { value: row.value, version: String(row.version) } : undefined
  }

  async insert(table: DurableTable, id: string, value: string, index: DurableKvIndex): Promise<string | undefined> {
    const rows = this.rowsOf(table)
    if (rows.has(id)) return undefined
    rows.set(id, { value, version: 1, index: { ...index } })
    await this.changed({ op: 'insert', table, id, value, version: '1', index: { ...index } })
    return '1'
  }

  async replace(table: DurableTable, id: string, version: string, value: string, index: DurableKvIndex): Promise<string | undefined> {
    const row = this.rowsOf(table).get(id)
    if (!row || String(row.version) !== version) return undefined
    row.value = value
    row.version += 1
    row.index = { ...index }
    await this.changed({ op: 'replace', table, id, value, version: String(row.version), index: { ...row.index } })
    return String(row.version)
  }

  async remove(table: DurableTable, id: string, version: string): Promise<boolean> {
    const rows = this.rowsOf(table)
    const row = rows.get(id)
    if (!row || String(row.version) !== version) return false
    rows.delete(id)
    await this.changed({ op: 'remove', table, id })
    return true
  }

  async range(table: DurableTable, index: keyof DurableKvIndex, max: number, limit: number): Promise<string[]> {
    const hits: Array<[string, number]> = []
    for (const [id, row] of this.rowsOf(table)) {
      const score = row.index[index]
      if (score !== null && score <= max) hits.push([id, score])
    }
    hits.sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    return hits.slice(0, Math.max(0, limit)).map(([id]) => id)
  }

  /** Copy of the whole state. */
  snapshot(): MemoryKvSnapshot {
    const tables: MemoryKvSnapshot['tables'] = {}
    for (const [t, rows] of this.tables) {
      tables[t] = [...rows].map(([id, r]) => [id, r.value, r.version, r.index.due, r.index.done] as [string, string, number, number | null, number | null])
    }
    return { version: 1, tables }
  }

  /** Replace the whole state with `snapshot`. @throws {Error} on an invalid snapshot. */
  restore(snapshot: MemoryKvSnapshot): void {
    if (snapshot?.version !== 1 || typeof snapshot.tables !== 'object' || snapshot.tables === null) {
      throw new Error('invalid durability snapshot')
    }
    const tables = new Map<DurableTable, Map<string, MemoryRow>>()
    for (const [t, dump] of Object.entries(snapshot.tables)) {
      if (!Array.isArray(dump)) throw new Error('invalid durability snapshot')
      const rows = new Map<string, MemoryRow>()
      for (const row of dump as unknown[]) {
        // Checked before anything is replaced: a damaged row must not become a half-restored journal.
        if (!Array.isArray(row) || row.length !== 5) throw new Error(`invalid durability snapshot: a row of "${t}" is not [id, value, version, due, done]`)
        const [id, value, version, due, done] = row as unknown[]
        if (typeof id !== 'string' || typeof value !== 'string' || !Number.isSafeInteger(version) || !isScore(due) || !isScore(done)) {
          throw new Error(`invalid durability snapshot: malformed row in "${t}"`)
        }
        rows.set(id, { value, version: version as number, index: { due, done } })
      }
      tables.set(t, rows)
    }
    this.tables = tables
  }

  /** Apply a logged mutation without asking the backend to persist (append-only replay). */
  protected applyMutation(mutation: KvMutation): void {
    if (mutation.op === 'remove') {
      this.rowsOf(mutation.table).delete(mutation.id)
      return
    }
    this.rowsOf(mutation.table).set(mutation.id, {
      value: mutation.value,
      version: Number(mutation.version),
      index: { ...mutation.index },
    })
  }

  /** Called after every committed write (the file backend persists here). */
  protected async changed(_mutation?: KvMutation): Promise<void> {}
}

/** An index score: epoch ms, or `null` when the document is not in that index. */
function isScore(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

/**
 * Throw unless `value` is a {@link KvMutation} (what an append-only log replays): a
 * damaged log entry must be refused, never applied as a malformed row.
 *
 * @category Durability
 */
export function assertKvMutation(value: unknown): asserts value is KvMutation {
  const m = value as Partial<Record<keyof KvMutation | 'value' | 'version' | 'index', unknown>> | null
  if (typeof m !== 'object' || m === null || typeof m.table !== 'string' || typeof m.id !== 'string') {
    throw new Error('invalid durability log entry: expected { op, table, id }')
  }
  if (m.op === 'remove') return
  if (m.op !== 'insert' && m.op !== 'replace') throw new Error(`invalid durability log entry: unknown op ${JSON.stringify(m.op)}`)
  const index = m.index as Partial<DurableKvIndex> | null
  if (typeof m.value !== 'string' || typeof m.version !== 'string' || !Number.isSafeInteger(Number(m.version)) ||
      typeof index !== 'object' || index === null || !isScore(index.due) || !isScore(index.done)) {
    throw new Error(`invalid durability log entry: malformed ${m.op}`)
  }
}
