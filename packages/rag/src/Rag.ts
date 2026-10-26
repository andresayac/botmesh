/**
 * Rag — load → chunk → embed → index → retrieve, with optional JSON persistence.
 *
 * Construction is synchronous and cheap; the configured `documents` are
 * ingested lazily on the first {@link Rag.retrieve} (or eagerly through
 * {@link Rag.ready} / {@link Rag.warmup}). This keeps it usable from a
 * synchronous `Plugin.install()` such as `aiPlugin({ rag })`.
 *
 * With `persistPath`, the index is saved as JSON after every change and, on
 * the next start, vectors of unchanged chunks (same text, same embedder) are
 * reused, so only new or edited chunks hit the embedding API. Documents added
 * at runtime survive the rebuild; a corrupt file is set aside (`<path>.corrupt`)
 * and rebuilt from the configured documents.
 */

import { chunkDocument, resolveChunkOptions, type ChunkOptions } from './chunking.js'
import { resolveEmbedder, type EmbeddingsConfig } from './embeddings/resolve.js'
import { RagError } from './errors.js'
import { rename } from 'node:fs/promises'
import { loadPaths, type PdfParser } from './loaders.js'
import type { Embedder, RagChunk, RagDocument, RagMetadata, RetrievedChunk } from './types.js'
import { hashText, VectorIndex, type IndexEntry } from './VectorIndex.js'

export interface RagOptions extends ChunkOptions {
  /**
   * Initial corpus: file or directory paths (markdown, text, JSON, PDF) and/or
   * ready {@link RagDocument}s. Ingested on first use.
   */
  documents?: ReadonlyArray<string | RagDocument>
  /** Embedder (default `'local'`: deterministic hashing, offline). */
  embeddings?: EmbeddingsConfig
  /** Default number of chunks returned by {@link Rag.retrieve}. Default 3. */
  topK?: number
  /** Default minimum cosine score. Default 0. */
  minScore?: number
  /** JSON file to persist the index (and reuse vectors across restarts). */
  persistPath?: string
  /** Base directory for relative document paths. Default `process.cwd()`. */
  cwd?: string
  /** Custom PDF text extractor (default: optional `pdf-parse` peer). */
  pdf?: PdfParser
  /** Max bytes per loaded file. Default 20 MiB. */
  maxFileBytes?: number
  /**
   * After a failed ingest, {@link Rag.retrieve} rejects right away with the
   * same error for this long (ms) instead of re-embedding the whole corpus on
   * every query. `ready()` / `warmup()` always retry. Default 30000.
   */
  retryDelayMs?: number
  /** Non-fatal problems, e.g. a corrupt persisted index that was discarded and rebuilt. */
  onError?: (err: unknown) => void
  /** @internal clock (tests). */
  now?: () => number
}

export interface RetrieveOptions {
  topK?: number
  minScore?: number
  signal?: AbortSignal
  /** Only consider chunks for which this returns true. */
  filter?: (chunk: RagChunk) => boolean
}

export interface AddTextOptions {
  source: string
  /** Default: `source`. */
  id?: string
  /** `'markdown'` enables heading-aware chunking. Default `'text'`. */
  format?: 'markdown' | 'text'
  metadata?: RagMetadata
}

function assertTopK(topK: unknown): void {
  if (!Number.isSafeInteger(topK) || (topK as number) < 1) throw new RagError('INVALID_OPTIONS', `topK must be a positive integer (got ${String(topK)})`)
}

function assertMinScore(minScore: unknown): void {
  if (typeof minScore !== 'number' || !Number.isFinite(minScore)) {
    throw new RagError('INVALID_OPTIONS', `minScore must be a finite number, a cosine score in [-1, 1] (got ${String(minScore)})`)
  }
}

const citationOf = (c: RagChunk): string => (c.section ? `${c.source} › ${c.section}` : c.source)

/** Wait for `p`, but reject as soon as `signal` aborts (`p` keeps running). */
function abortable<T>(p: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return p
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v) },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e) },
    )
  })
}

export class Rag {
  readonly embedder: Embedder
  private index: VectorIndex
  private readonly chunking: Required<ChunkOptions>
  private readonly topK: number
  private readonly minScore: number
  /** Vectors of the indexed chunks (and, while ingesting, of the persisted index), by chunk-text hash. */
  private cache = new Map<string, number[]>()
  private init?: Promise<void>
  /** Last failed ingest (drives the retrieve() fail-fast window). */
  private failure?: { at: number; error: unknown }
  private readonly retryDelayMs: number
  private readonly now: () => number
  /** Serialises mutations (ingest, add, remove, save). */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly options: RagOptions = {}) {
    this.embedder = resolveEmbedder(options.embeddings)
    this.chunking = resolveChunkOptions(options)
    this.topK = options.topK ?? 3
    this.minScore = options.minScore ?? 0
    if (options.documents !== undefined && !Array.isArray(options.documents)) {
      throw new RagError('INVALID_OPTIONS', "documents must be an array of paths and/or { id, text, source } objects, e.g. documents: ['./docs']")
    }
    assertTopK(this.topK)
    assertMinScore(this.minScore)
    if (options.maxFileBytes !== undefined && (!Number.isSafeInteger(options.maxFileBytes) || options.maxFileBytes < 1)) {
      throw new RagError('INVALID_OPTIONS', 'maxFileBytes must be a positive integer (bytes)')
    }
    this.retryDelayMs = options.retryDelayMs ?? 30_000
    if (!Number.isFinite(this.retryDelayMs) || this.retryDelayMs < 0) throw new RagError('INVALID_OPTIONS', 'retryDelayMs must be >= 0')
    this.now = options.now ?? Date.now
    this.index = new VectorIndex(this.embedder.id)
  }

  /** Number of indexed chunks (after {@link ready}). */
  get size(): number { return this.index.size }

  /** Ingest the configured documents once (memoised; a failure is retried on the next call). */
  ready(): Promise<void> {
    if (!this.init) {
      const init = this.serial(() => this.ingestInitial())
      this.init = init
      init.then(
        () => { this.failure = undefined },
        (error: unknown) => {
          if (this.init === init) this.init = undefined
          this.failure = { at: this.now(), error }
        },
      )
    }
    return this.init
  }

  /** Alias of {@link ready} (lets `aiPlugin` warm the index up at startup). */
  warmup(): Promise<void> { return this.ready() }

  private serial<T>(op: () => Promise<T>): Promise<T> {
    const run = this.queue.then(op, op)
    this.queue = run.catch(() => {})
    return run
  }

  /**
   * Load the persisted index. With configured documents it is only a vector
   * cache, so a corrupt file is moved aside and reported instead of failing.
   */
  private async loadPersisted(rebuildable: boolean): Promise<VectorIndex | undefined> {
    const path = this.options.persistPath
    if (!path) return undefined
    try {
      return await VectorIndex.load(path)
    } catch (err) {
      if (!rebuildable || !(err instanceof RagError) || err.code !== 'INVALID_INDEX') throw err
      await rename(path, `${path}.corrupt`).catch(() => {})
      try { this.options.onError?.(err) } catch { /* reporting must not break ingest */ }
      return undefined
    }
  }

  private async ingestInitial(): Promise<void> {
    const configured = this.options.documents ?? []
    const persisted = await this.loadPersisted(configured.length > 0)
    const sameSpace = persisted !== undefined && persisted.embedder === this.embedder.id
    if (persisted && sameSpace) for (const e of persisted.all()) this.cache.set(e.hash, e.vector)
    if (configured.length === 0) {
      // No corpus configured: serve the persisted index as-is (prebuilt index), re-embedding
      // its chunks when it was built with another embedder.
      if (persisted && sameSpace) this.index = persisted
      else if (persisted) {
        const next = new VectorIndex(this.embedder.id)
        next.upsert(await this.reembed(persisted.all()))
        this.index = next
      }
      this.pruneCache()
      if (persisted && !sameSpace) await this.persist()
      return
    }
    const docs = await this.loadDocuments(configured)
    const { entries, embedded } = await this.embedDocuments(docs)
    const next = new VectorIndex(this.embedder.id)
    next.upsert(entries)
    // Keep documents added at runtime (a configured document with the same id wins);
    // with another embedder their chunks are embedded again rather than lost.
    const configuredIds = new Set(docs.map((d) => d.id))
    const runtime = persisted ? persisted.all().filter((e) => e.runtime && !configuredIds.has(e.docId)) : []
    next.upsert(sameSpace ? runtime : await this.reembed(runtime))
    const usable = sameSpace ? persisted : undefined
    const changed = embedded > 0 || !usable || usable.size !== next.size || next.all().some((e) => usable.get(e.id)?.hash !== e.hash)
    this.index = next
    this.pruneCache()
    if (changed) await this.persist()
  }

  /** Index entries with vectors from this embedder (cached ones reused). */
  private async reembed(entries: readonly IndexEntry[]): Promise<IndexEntry[]> {
    const items = entries.map((e) => ({ hash: hashText(e.text), text: e.text }))
    await this.ensureVectors(items)
    return entries.map((e, i) => ({ ...e, hash: items[i]!.hash, vector: this.cache.get(items[i]!.hash)! }))
  }

  /** Embed the texts whose hash has no cached vector; returns how many were embedded. */
  private async ensureVectors(items: readonly { hash: string; text: string }[], signal?: AbortSignal): Promise<number> {
    const textByHash = new Map<string, string>()
    for (const { hash, text } of items) if (!this.cache.has(hash)) textByHash.set(hash, text)
    if (textByHash.size === 0) return 0
    const missing = [...textByHash.keys()]
    const vectors = await this.embedder.embed(missing.map((h) => textByHash.get(h)!), signal ? { signal } : {})
    if (!Array.isArray(vectors) || vectors.length !== missing.length) throw new RagError('EMBEDDING_FAILED', 'embedder returned a wrong number of vectors')
    missing.forEach((h, i) => this.cache.set(h, vectors[i]!))
    return missing.length
  }

  /**
   * Keep only the vectors of chunks still in the index: a replaced or removed chunk's vector
   * is dropped, so memory follows the index (a document re-added later is embedded again).
   */
  private pruneCache(): void {
    const live = new Set(this.index.all().map((e) => e.hash))
    for (const hash of this.cache.keys()) if (!live.has(hash)) this.cache.delete(hash)
  }

  private async loadDocuments(items: ReadonlyArray<string | RagDocument>): Promise<RagDocument[]> {
    if (!Array.isArray(items)) throw new RagError('INVALID_OPTIONS', 'expected an array of paths and/or { id, text, source } documents')
    const paths = items.filter((d): d is string => typeof d === 'string')
    const docs = items.filter((d): d is RagDocument => typeof d !== 'string')
    for (const d of docs) {
      if (!d || typeof d.id !== 'string' || typeof d.text !== 'string' || typeof d.source !== 'string') {
        throw new RagError('INVALID_OPTIONS', 'documents must be paths or { id, text, source } objects')
      }
    }
    const loaded = paths.length
      ? await loadPaths(paths, {
          ...(this.options.cwd ? { cwd: this.options.cwd } : {}),
          ...(this.options.pdf ? { pdf: this.options.pdf } : {}),
          ...(this.options.maxFileBytes ? { maxFileBytes: this.options.maxFileBytes } : {}),
        })
      : []
    return [...loaded, ...docs]
  }

  /** Chunk and embed documents, reusing cached vectors; returns entries + how many were newly embedded. */
  private async embedDocuments(docs: readonly RagDocument[], signal?: AbortSignal): Promise<{ entries: IndexEntry[]; embedded: number }> {
    const chunks = docs.flatMap((d) => chunkDocument(d, this.chunking))
    const hashes = chunks.map((c) => hashText(c.text))
    const embedded = await this.ensureVectors(chunks.map((c, i) => ({ hash: hashes[i]!, text: c.text })), signal)
    const entries = chunks.map((c, i) => ({ ...c, hash: hashes[i]!, vector: this.cache.get(hashes[i]!)! }))
    return { entries, embedded }
  }

  private async persist(): Promise<void> {
    if (this.options.persistPath) await this.index.save(this.options.persistPath)
  }

  /** Add (or replace, by id) documents. Resolves with the number of chunks indexed. */
  async addDocuments(docs: readonly RagDocument[]): Promise<number> {
    await this.ready()
    return this.serial(async () => {
      const valid = await this.loadDocuments(docs)
      const entries = (await this.embedDocuments(valid)).entries.map((e): IndexEntry => ({ ...e, runtime: true }))
      const ids = new Set(valid.map((d) => d.id))
      const replaced = this.index.all().filter((e) => ids.has(e.docId))
      this.index.removeWhere((e) => ids.has(e.docId))
      try {
        this.index.upsert(entries)
      } catch (error) {
        // All-or-nothing: a rejected batch (e.g. the embedder now returns another
        // dimension) must not lose the documents it was replacing.
        this.index.upsert(replaced)
        this.pruneCache()
        throw error
      }
      this.pruneCache()
      await this.persist()
      return entries.length
    })
  }

  /** Load files/directories and add them. Resolves with the number of chunks indexed. */
  async addFiles(paths: readonly string[]): Promise<number> {
    const docs = await this.loadDocuments(paths)
    return this.addDocuments(docs)
  }

  /** Add a string as a document. */
  addText(text: string, options: AddTextOptions): Promise<number> {
    if (typeof text !== 'string') return Promise.reject(new RagError('INVALID_OPTIONS', 'addText(text, { source }): text must be a string'))
    if (!options || typeof options.source !== 'string' || !options.source) {
      return Promise.reject(new RagError('INVALID_OPTIONS', 'addText(text, { source }): source (the citation label, e.g. a file name or URL) must be a non-empty string'))
    }
    const doc: RagDocument = { id: options.id ?? options.source, source: options.source, text, format: options.format ?? 'text' }
    if (options.metadata) doc.metadata = { ...options.metadata }
    return this.addDocuments([doc])
  }

  /** Remove a document's chunks by document id. Resolves `true` when something was removed. */
  async removeDocument(id: string): Promise<boolean> {
    await this.ready()
    return this.serial(async () => {
      const n = this.index.removeWhere((e) => e.docId === id)
      if (n > 0) this.pruneCache()
      if (n > 0) await this.persist()
      return n > 0
    })
  }

  /** Save the index now (to `path` or the configured `persistPath`). */
  async save(path?: string): Promise<void> {
    await this.ready()
    const target = path ?? this.options.persistPath
    if (!target) throw new RagError('INVALID_OPTIONS', 'save() needs a path (or persistPath)')
    await this.serial(() => this.index.save(target))
  }

  /** The `topK` chunks most similar to `query`, best first, with citation labels. */
  async retrieve(query: string, options: RetrieveOptions = {}): Promise<RetrievedChunk[]> {
    // Fail fast for a while after a failed ingest (don't re-embed the corpus per query).
    if (!this.init && this.failure && this.now() - this.failure.at < this.retryDelayMs) throw this.failure.error
    if (options.topK !== undefined) assertTopK(options.topK)
    if (options.minScore !== undefined) assertMinScore(options.minScore)
    await abortable(this.ready(), options.signal)
    if (typeof query !== 'string' || !query.trim() || this.index.size === 0) return []
    const [vector] = await this.embedder.embed([query], options.signal ? { signal: options.signal } : {})
    if (!vector) throw new RagError('EMBEDDING_FAILED', 'embedder returned no vector for the query')
    const filter = options.filter
    const hits = this.index.search(vector, {
      topK: options.topK ?? this.topK,
      minScore: options.minScore ?? this.minScore,
      ...(filter ? { filter: (e: IndexEntry) => filter(e) } : {}),
    })
    return hits.map(({ entry, score }) => {
      const { vector: _v, hash: _h, runtime: _r, ...chunk } = entry
      // A copy: a caller mutating the hit (or its metadata) must not change the index.
      if (chunk.metadata) chunk.metadata = { ...chunk.metadata }
      return { ...chunk, score, citation: citationOf(chunk) }
    })
  }
}

/** Create a {@link Rag} (sync; documents are ingested on first use). */
export function createRag(options: RagOptions = {}): Rag {
  return new Rag(options)
}

/**
 * Render retrieved chunks as a numbered context block for a prompt:
 * `[1] (faq.md › Envíos)\n…`. Handy with `ctx.tools.ai.ask()`.
 */
export function formatContext(chunks: readonly Pick<RetrievedChunk, 'text' | 'citation'>[]): string {
  return chunks.map((c, i) => `[${i + 1}] (${c.citation})\n${c.text}`).join('\n\n')
}
