import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRag, Rag } from '../src/Rag.js'
import { chunkText, chunkDocument, splitMarkdownSections } from '../src/chunking.js'
import { fromJson, loadFile } from '../src/loaders.js'
import { HashEmbedder } from '../src/embeddings/hash.js'
import { OllamaEmbedder } from '../src/embeddings/ollama.js'
import { resolveEmbedder } from '../src/embeddings/resolve.js'
import { VectorIndex } from '../src/VectorIndex.js'
import { RagError } from '../src/errors.js'
import type { Embedder, RagDocument } from '../src/types.js'

class CountingEmbedder implements Embedder {
  readonly seen: string[] = []
  private inner: HashEmbedder
  constructor(readonly id: string, dimensions = 64) { this.inner = new HashEmbedder({ dimensions }) }
  async embed(texts: readonly string[]): Promise<number[][]> {
    this.seen.push(...texts)
    return this.inner.embed(texts)
  }
}

let dir: string | undefined
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); dir = undefined })

describe('markdown headings', () => {
  it('parses a heading line padded with thousands of spaces in linear time (no ReDoS)', () => {
    const started = performance.now()
    const sections = splitMarkdownSections(`# Title${' '.repeat(20_000)}x\nbody`)
    expect(performance.now() - started).toBeLessThan(500)
    expect(sections).toHaveLength(1)
    expect(sections[0]!.path.startsWith('Title')).toBe(true)
  })

  it('keeps a trailing # that is part of the title ("C#") and strips a real closing sequence', () => {
    expect(splitMarkdownSections('## C#\nbody').map((s) => s.path)).toEqual(['C#'])
    expect(splitMarkdownSections('## Envíos ##   \nbody').map((s) => s.path)).toEqual(['Envíos'])
    expect(splitMarkdownSections('#\ttabbed\nbody').map((s) => s.path)).toEqual(['tabbed'])
  })
})

describe('chunking with unicode', () => {
  it('never cuts a surrogate pair when it has to split a long word', () => {
    for (const chunk of chunkText('😀'.repeat(300), { chunkSize: 101, chunkOverlap: 0 })) {
      expect(chunk).not.toMatch(/[\uD800-\uDBFF]$/)
      expect(chunk).not.toMatch(/^[\uDC00-\uDFFF]/)
    }
    expect(chunkText('😀'.repeat(300), { chunkSize: 101, chunkOverlap: 0 }).join('')).toBe('😀'.repeat(300))
  })
})

describe('JSON loader', () => {
  it('rejects absurdly nested JSON with a RagError instead of a stack overflow', async () => {
    let deep = '1'
    for (let i = 0; i < 20_000; i++) deep = `{"a":${deep}}`
    expect(() => fromJson(JSON.parse(deep), 'deep.json')).toThrow(RagError)
    dir = await mkdtemp(join(tmpdir(), 'rag-'))
    await writeFile(join(dir, 'deep.json'), deep)
    await expect(loadFile('deep.json', { cwd: dir })).rejects.toMatchObject({ code: 'LOAD_FAILED', message: expect.stringContaining('deep.json') })
  })

  it('still flattens ordinary nesting', () => {
    expect(fromJson({ a: { b: { c: [1, 2] } } }, 's')[0]!.text).toBe('a.b.c: 1, 2')
  })
})

describe('changing the embedder keeps the corpus', () => {
  it('re-embeds runtime documents with the new embedder instead of dropping them', async () => {
    dir = await mkdtemp(join(tmpdir(), 'rag-'))
    const persistPath = join(dir, 'index.json')
    const docs: RagDocument[] = [{ id: 'faq', source: 'faq.md', text: 'Los envíos tardan tres días.' }]
    const first = new Rag({ documents: docs, embeddings: new CountingEmbedder('old'), persistPath })
    await first.addText('El horario es de ocho a seis.', { source: 'horario' })

    const next = new CountingEmbedder('new', 32)
    const second = new Rag({ documents: docs, embeddings: next, persistPath })
    await second.ready()
    expect(second.size).toBe(2)
    expect(next.seen.sort()).toEqual(['El horario es de ocho a seis.', 'Los envíos tardan tres días.'])
    const [hit] = await second.retrieve('horario')
    expect(hit).toMatchObject({ source: 'horario' })
    const saved = JSON.parse(await readFile(persistPath, 'utf8'))
    expect(saved.embedder).toBe('new')
    expect(saved.entries).toHaveLength(2)
  })

  it('re-embeds a prebuilt index (no documents) built with another embedder instead of serving nothing', async () => {
    dir = await mkdtemp(join(tmpdir(), 'rag-'))
    const persistPath = join(dir, 'index.json')
    await new Rag({ documents: [{ id: 'a', source: 'a.md', text: 'Aceptamos pagos con tarjeta.' }], embeddings: new CountingEmbedder('old'), persistPath }).ready()
    const next = new CountingEmbedder('new', 32)
    const prebuilt = new Rag({ embeddings: next, persistPath })
    const [hit] = await prebuilt.retrieve('pagos con tarjeta')
    expect(hit).toMatchObject({ source: 'a.md' })
    expect(JSON.parse(await readFile(persistPath, 'utf8')).embedder).toBe('new')
  })
})

describe('user mistakes get clear errors', () => {
  it('documents must be an array', () => {
    expect(() => createRag({ documents: './docs' as unknown as string[] })).toThrow(/documents must be an array/)
  })

  it('validates minScore and maxFileBytes', () => {
    expect(() => createRag({ minScore: 'x' as unknown as number })).toThrow(/minScore/)
    expect(() => createRag({ minScore: Number.NaN })).toThrow(/minScore/)
    expect(() => createRag({ maxFileBytes: 0 })).toThrow(/maxFileBytes/)
    expect(() => createRag({ maxFileBytes: -1 })).toThrow(/maxFileBytes/)
  })

  it('validates per-call topK and minScore', async () => {
    const rag = createRag({ documents: [{ id: 'a', source: 'a', text: 'hola mundo' }] })
    await expect(rag.retrieve('hola', { topK: Number.NaN })).rejects.toMatchObject({ code: 'INVALID_OPTIONS', message: expect.stringContaining('topK') })
    await expect(rag.retrieve('hola', { topK: 1.5 })).rejects.toMatchObject({ code: 'INVALID_OPTIONS' })
    await expect(rag.retrieve('hola', { minScore: Number.NaN })).rejects.toMatchObject({ code: 'INVALID_OPTIONS', message: expect.stringContaining('minScore') })
    expect(await rag.retrieve('hola', { topK: 1, minScore: -1 })).toHaveLength(1)
  })

  it('addText explains a missing source or a non-string text', async () => {
    const rag = createRag()
    await expect((rag.addText as (t: unknown) => Promise<number>)('hola')).rejects.toMatchObject({ code: 'INVALID_OPTIONS', message: expect.stringContaining('source') })
    await expect(rag.addText(42 as unknown as string, { source: 'x' })).rejects.toMatchObject({ code: 'INVALID_OPTIONS', message: expect.stringContaining('text') })
    await expect(rag.addDocuments('x' as unknown as RagDocument[])).rejects.toMatchObject({ code: 'INVALID_OPTIONS' })
  })

  it('an unknown embeddings provider lists the valid ones', () => {
    expect(() => resolveEmbedder({ provider: 'opena' } as never)).toThrow(/'local', 'openai' or 'ollama'/)
    expect(() => resolveEmbedder('opeanai' as never)).toThrow(/'local', 'openai' or 'ollama'/)
    expect(() => resolveEmbedder({ embed: async () => [] } as never)).toThrow(/custom Embedder needs a non-empty string id/)
  })

  it('a connection failure names the endpoint origin (never its path or query) and the cause code', async () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    const fetch = (async () => { throw new TypeError('fetch failed', { cause: refused }) }) as unknown as typeof globalThis.fetch
    const e = new OllamaEmbedder({ baseUrl: 'http://ollama.internal:11434/x?token=secret', http: { fetch, resolver: async () => ['10.0.0.5'] } })
    const err = (await e.embed(['x']).then(() => undefined, (x: unknown) => x)) as RagError
    expect(err).toBeInstanceOf(RagError)
    expect(err.message).toContain('http://ollama.internal:11434')
    expect(err.message).toContain('ECONNREFUSED')
    expect(err.message).not.toContain('secret')
  })
})

describe('retrieve results are copies', () => {
  it('mutating a hit metadata does not change the index', async () => {
    const rag = createRag({ documents: [{ id: 'a', source: 'a', text: 'hola mundo', metadata: { lang: 'es' } }] })
    const [hit] = await rag.retrieve('hola')
    hit!.metadata!.lang = 'en'
    const [again] = await rag.retrieve('hola')
    expect(again!.metadata).toEqual({ lang: 'es' })
  })
})

describe('persisted index without hashes', () => {
  it('a hand-built index missing the hash field is repaired on load', () => {
    const idx = VectorIndex.fromJSON({ version: 1, embedder: 'x', dimensions: 2, entries: [{ id: 'a#0', docId: 'a', source: 'a', index: 0, text: 'hola', vector: [1, 0] }] })
    expect(typeof idx.get('a#0')!.hash).toBe('string')
    expect(idx.get('a#0')!.hash).toHaveLength(64)
  })
})

describe('bursts', () => {
  it('many concurrent addText/retrieve/removeDocument calls stay consistent and persist once settled', async () => {
    dir = await mkdtemp(join(tmpdir(), 'rag-'))
    const persistPath = join(dir, 'index.json')
    const rag = createRag({ documents: [{ id: 'base', source: 'base', text: 'documento base' }], persistPath })
    const ops: Promise<unknown>[] = []
    for (let i = 0; i < 60; i++) {
      ops.push(rag.addText(`nota número ${i} 🚀`, { source: `n${i}` }))
      ops.push(rag.retrieve(`nota ${i}`))
      if (i % 3 === 0) ops.push(rag.removeDocument(`n${i}`))
    }
    await Promise.all(ops)
    const saved = JSON.parse(await readFile(persistPath, 'utf8'))
    expect(saved.entries).toHaveLength(rag.size)
    expect(rag.size).toBe(1 + 60 - 20)
    const docs = chunkDocument({ id: 'x', source: 'x', text: 'y' })
    expect(docs).toHaveLength(1)
  })
})
