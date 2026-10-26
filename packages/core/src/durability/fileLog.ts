/**
 * Append-only log next to a file-backed journal (`<file>.log`): one newline-delimited
 * JSON entry per committed operation, each stamped with a sequence number, so a write
 * costs one `appendFile` instead of a rewrite of the whole snapshot. The snapshot keeps
 * the sequence it was taken at (`logSeq`); opening replays every complete entry beyond
 * it, so a crash between "snapshot written" and "log truncated" is harmless (those
 * entries are skipped by their sequence) and a torn last line (a crash mid-append) is
 * ignored and cut off. A bad line FOLLOWED by more entries is not a torn tail but
 * corruption: replaying past it would silently drop the later entries, so the replay
 * refuses with an {@link appendLogCorrupt} error and leaves the file untouched. It knows
 * nothing about what an entry means.
 *
 * `@botmesh/events` keeps a sibling copy (`packages/events/src/fileLog.ts`): the core must
 * not grow a public helper just for a private package. Keep the on-disk format in sync.
 */

import { appendFile, open, readFile, rm, stat, truncate } from 'node:fs/promises'
import { dirname } from 'node:path'

/** One replayed log entry: its sequence number and the payload the writer appended. */
export interface AppendLogEntry<T = unknown> {
  s: number
  entry: T
}

/** What {@link AppendLog.replay} found on disk. */
export interface AppendLogReplay<T = unknown> {
  /** Complete entries with a sequence beyond the one asked for, in file order. */
  entries: Array<AppendLogEntry<T>>
  /** Highest sequence seen in the log (`afterSeq` when the log is empty or missing). */
  lastSeq: number
  /** Bytes of complete entries in the log (what the next append grows). */
  bytes: number
  /** A torn tail (no final newline, or an unparsable last line) was found. */
  torn: boolean
}

/** Options of {@link AppendLog}. */
export interface AppendLogOptions {
  /** Compact (snapshot + truncate) once this many entries were appended since the last snapshot. Default 1000. */
  compactEvery?: number
  /** Compact once the log holds this many bytes. Default 4 MiB. */
  compactBytes?: number
  /** `fsync` every append (default `false`, like the snapshot writes). */
  fsync?: boolean
}

/**
 * The error a replay throws for a corrupt line in the middle of the log (`code:
 * 'APPEND_LOG_CORRUPT'`): names the file, the 1-based line and its byte offset.
 */
export function appendLogCorrupt(path: string, line: number, byteOffset: number): Error & { code: string } {
  const error = new Error(
    `append log ${path} is corrupt at line ${line} (byte ${byteOffset}): it is followed by more entries, so it is not a torn tail and replaying past it would silently lose the later entries. Restore the journal from a backup, or cut the log at that line to keep only the entries before it.`,
  ) as Error & { code: string }
  error.code = 'APPEND_LOG_CORRUPT'
  return error
}

/**
 * Write `text` to `path` (a temporary file the caller then renames over the snapshot). With
 * `fsync`, the data is flushed to disk before it returns, so a power loss after the rename
 * cannot leave an empty or partial snapshot.
 */
export async function writeSnapshotFile(path: string, text: string, fsync: boolean): Promise<void> {
  const handle = await open(path, 'w')
  try {
    await handle.writeFile(text, 'utf8')
    if (fsync) await handle.sync()
  } finally {
    await handle.close()
  }
}

/**
 * Best-effort `fsync` of the directory holding `filePath`, so a rename into it is durable.
 * Ignored where directories cannot be opened for sync (Windows).
 */
export async function syncDirectory(filePath: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(dirname(filePath), 'r')
    await handle.sync()
  } catch {
    // Not supported on this platform/filesystem: the rename is still atomic.
  } finally {
    await handle?.close().catch(() => {})
  }
}

export const DEFAULT_COMPACT_EVERY = 1000
export const DEFAULT_COMPACT_BYTES = 4 * 1024 * 1024

/** Normalise {@link AppendLogOptions} (`true` = defaults). @throws {TypeError} on an invalid value. */
export function appendLogOptions(value: boolean | AppendLogOptions | undefined, who: string): Required<AppendLogOptions> | undefined {
  if (value === undefined || value === false) return undefined
  const o = value === true ? {} : value
  if (typeof o !== 'object' || o === null) throw new TypeError(`${who}: appendLog must be a boolean or an options object`)
  const compactEvery = o.compactEvery ?? DEFAULT_COMPACT_EVERY
  const compactBytes = o.compactBytes ?? DEFAULT_COMPACT_BYTES
  if (!Number.isInteger(compactEvery) || compactEvery < 1) throw new TypeError(`${who}: appendLog.compactEvery must be a positive integer`)
  if (!Number.isFinite(compactBytes) || compactBytes < 1) throw new TypeError(`${who}: appendLog.compactBytes must be a positive number`)
  return { compactEvery, compactBytes, fsync: o.fsync === true }
}

/**
 * The log file of one journal. Appends are the caller's to serialise (the journals run
 * every write through one queue, or under their cross-process mutex); this class only
 * owns the on-disk format and the compaction bookkeeping.
 */
export class AppendLog {
  /** Entries appended since the last compaction (or since open). */
  private count = 0
  /** Bytes the log holds (complete entries only). */
  private bytes = 0
  readonly path: string

  constructor(filePath: string, private readonly options: Required<AppendLogOptions>) {
    this.path = `${filePath}.log`
  }

  /** The log path of a journal file (what {@link replay} reads). */
  static pathOf(filePath: string): string { return `${filePath}.log` }

  /**
   * Read `<file>.log` and return every complete entry with `s > afterSeq`. A torn tail is
   * cut off the file (the writer serialises appends, so nothing else is writing it). A
   * missing log is an empty one.
   * @throws {Error} `code: 'APPEND_LOG_CORRUPT'` when a bad line is followed by more entries.
   */
  static async replay<T = unknown>(filePath: string, afterSeq: number): Promise<AppendLogReplay<T>> {
    const path = AppendLog.pathOf(filePath)
    const text = await readLog(path)
    if (text === undefined) return { entries: [], lastSeq: afterSeq, bytes: 0, torn: false }
    const result = scanLog<T>(text, path, afterSeq)
    if (result.torn) await truncate(path, result.bytes)
    return result
  }

  /**
   * Check `<file>.log` without changing it: throws the {@link appendLogCorrupt} error for a
   * bad line in the middle (a torn last line is fine: the next replay cuts it). For opening
   * a journal that other processes may be appending to.
   */
  static async verify(filePath: string): Promise<void> {
    const path = AppendLog.pathOf(filePath)
    const text = await readLog(path)
    if (text !== undefined) scanLog(text, path, Number.POSITIVE_INFINITY)
  }

  /** Adopt what {@link replay} found (so compaction thresholds count the existing tail). */
  adopt(replay: Pick<AppendLogReplay, 'entries' | 'bytes'>): void {
    this.count = replay.entries.length
    this.bytes = replay.bytes
  }

  /** Append one entry (`{"s":seq,"e":entry}` + newline). */
  async append(seq: number, entry: unknown): Promise<void> {
    const line = `${JSON.stringify({ s: seq, e: entry })}\n`
    if (this.options.fsync) {
      const handle = await open(this.path, 'a')
      try {
        await handle.writeFile(line, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
    } else {
      await appendFile(this.path, line, 'utf8')
    }
    this.count++
    this.bytes += Buffer.byteLength(line, 'utf8')
  }

  /** Whether the thresholds say the journal should snapshot and truncate now. */
  get due(): boolean {
    return this.count >= this.options.compactEvery || this.bytes >= this.options.compactBytes
  }

  /** Entries appended since the last compaction. */
  get pending(): number { return this.count }

  /** Delete the log (after the snapshot that holds its entries was written). */
  async truncate(): Promise<void> {
    await rm(this.path, { force: true })
    this.count = 0
    this.bytes = 0
  }

  /** Whether a log file exists on disk (a reopen decides whether to drain it). */
  static async exists(filePath: string): Promise<boolean> {
    return (await stat(AppendLog.pathOf(filePath)).catch(() => undefined)) !== undefined
  }
}

/** Read a log file; `undefined` when it does not exist. */
async function readLog(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Parse a log's text: every complete entry with `s > afterSeq`, the highest sequence, the
 * bytes of the complete lines and whether a torn last line follows them.
 * @throws {Error} `code: 'APPEND_LOG_CORRUPT'` for a bad line followed by more entries.
 */
function scanLog<T>(text: string, path: string, afterSeq: number): AppendLogReplay<T> {
  const entries: Array<AppendLogEntry<T>> = []
  let lastSeq = afterSeq
  let complete = 0 // bytes of the lines kept
  let torn = false
  let offset = 0
  let lineNo = 0
  while (offset < text.length) {
    lineNo++
    const nl = text.indexOf('\n', offset)
    if (nl < 0) { torn = true; break }
    const line = text.slice(offset, nl)
    let parsed: { s?: unknown; e?: unknown } | undefined
    try {
      parsed = JSON.parse(line) as { s?: unknown; e?: unknown }
    } catch {
      parsed = undefined
    }
    if (typeof parsed !== 'object' || parsed === null || typeof parsed.s !== 'number' || !('e' in parsed)) {
      // Only the last line can be torn (a crash mid-append); anything after it means corruption.
      if (text.slice(nl + 1).trim() !== '') throw appendLogCorrupt(path, lineNo, complete)
      torn = true
      break
    }
    offset = nl + 1
    // Running total (the line plus its newline): measuring the whole prefix again for
    // every line made a long log quadratic to read.
    complete += Buffer.byteLength(line, 'utf8') + 1
    if (parsed.s > lastSeq) lastSeq = parsed.s
    if (parsed.s > afterSeq) entries.push({ s: parsed.s, entry: parsed.e as T })
  }
  return { entries, lastSeq, bytes: complete, torn }
}
