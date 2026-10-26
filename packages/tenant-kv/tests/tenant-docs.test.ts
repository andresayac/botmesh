/** TenantDocs unit tests: table naming, option validation, contention and disjointness from core's journal tables. */
import { describe, expect, it } from 'vitest'
import { type DurableKv } from '@botmesh/core'
import { KvDurability, MemoryKv, type DurableKvIndex } from '@botmesh/core/spi'
import { CorruptDocumentError, InvalidDocumentError, KvContentionError, PRODUCT_TABLE_PREFIX, TenantDocs, assertTenantId, encodeSegment } from '../src/index.js'

interface Doc { v: number }
const parse = (value: unknown): Doc => {
  if (typeof value !== 'object' || value === null || typeof (value as Doc).v !== 'number') throw new TypeError('bad doc')
  return { v: (value as Doc).v }
}
const make = (kv: DurableKv = new MemoryKv(), attempts?: number) =>
  new TenantDocs<Doc>(kv, { family: ['inbox', 'conv'], parse, order: (d) => d.v, ...(attempts !== undefined ? { attempts } : {}) })

/** A kv whose replace never matches (someone else always wins). */
class LosingKv extends MemoryKv {
  override async replace(): Promise<string | undefined> { return undefined }
}

describe('table names', () => {
  it('are product/<family>/<encoded tenant>[/<encoded sub>…]', () => {
    const docs = make()
    expect(docs.tableName('acme')).toBe('product/inbox/conv/acme')
    expect(docs.tableName('a/b', 'c:d')).toBe('product/inbox/conv/a%2Fb/c%3Ad')
    expect(docs.tableName('}{')).toBe('product/inbox/conv/%7D%7B')
    expect(docs.tableName("x*!'()~")).toBe('product/inbox/conv/x%2A%21%27%28%29%7E')
    expect(docs.in('acme', 'conv-1').table).toBe('product/inbox/conv/acme/conv-1')
    expect(PRODUCT_TABLE_PREFIX).toBe('product/')
  })

  it('never contain a separator, brace or glob character coming from the caller', () => {
    for (const hostile of ['a/b', '{durable:inbox}', 'x:y', '*', '?', '[a]', 'ñ 🦜']) {
      const name = make().tableName(hostile, hostile)
      expect(name.slice('product/inbox/conv/'.length)).not.toMatch(/[:{}*?[\] ]/)
      expect(name.split('/')).toHaveLength(5)
    }
  })

  it('reject an empty tenant id, bad sub-scopes and bad families', () => {
    expect(() => make().tableName('')).toThrow(TypeError)
    expect(() => make().in(undefined as unknown as string)).toThrow(TypeError)
    expect(() => make().in('a', 1 as unknown as string)).toThrow(TypeError)
    expect(() => new TenantDocs(new MemoryKv(), { family: [], parse, order: () => 0 })).toThrow(TypeError)
    expect(() => new TenantDocs(new MemoryKv(), { family: ['a/b'], parse, order: () => 0 })).toThrow(TypeError)
    expect(() => new TenantDocs(new MemoryKv(), { family: ['a'], parse, order: () => 0, attempts: 0 })).toThrow(RangeError)
    expect(() => assertTenantId(42)).toThrow(/tenantId/)
    expect(() => assertTenantId('x', 'botId')).not.toThrow()
  })

  it('are disjoint from the tables of a KvDurability sharing the same kv (any scope)', async () => {
    const kv = new MemoryKv()
    const journal = new KvDurability(kv).scope('bot-a').scope('x')
    await journal.inbox.append({ id: 'e1', partitionKey: 'p', kind: 'message', payload: {}, receivedAt: 1 }, 1)
    await journal.outbox.put({ key: 'k', chatId: 'c', content: 'x', createdAt: 1 }, 1)
    await new KvDurability(kv).inbox.append({ id: 'e2', partitionKey: 'p', kind: 'message', payload: {}, receivedAt: 1 }, 1)
    const docs = make(kv)
    await docs.in('inbox').insert('e1', { v: 1 })
    await docs.in('inbox:bot-a:x').insert('e1', { v: 2 })
    const snapshot = kv.snapshot()
    const journalTables = Object.keys(snapshot.tables).filter((t) => !t.startsWith(PRODUCT_TABLE_PREFIX))
    expect(journalTables.sort()).toEqual(['inbox', 'inbox:bot-a:x', 'outbox:bot-a:x'])
    // Journal records are untouched and the product documents live in their own tables.
    expect(await journal.inbox.get('e1')).toMatchObject({ id: 'e1', state: 'pending' })
    expect((await docs.in('inbox').get('e1'))?.doc).toEqual({ v: 1 })
    expect((await docs.in('inbox:bot-a:x').get('e1'))?.doc).toEqual({ v: 2 })
    // Purging the journal never reaches the product tables.
    await journal.inbox.purge({ doneBefore: Number.POSITIVE_INFINITY, includeDead: true })
    expect((await docs.in('inbox:bot-a:x').get('e1'))?.doc).toEqual({ v: 2 })
  })
})

describe('encodeSegment', () => {
  it('matches the alphabet of @botmesh/redis-store', () => {
    expect(encodeSegment("a:b{c}*!'()~ /")).toBe('a%3Ab%7Bc%7D%2A%21%27%28%29%7E%20%2F')
    expect(decodeURIComponent(encodeSegment('ñandú 🦜'))).toBe('ñandú 🦜')
  })
})

describe('update loop', () => {
  it('throws KvContentionError after `attempts` lost compare-and-sets', async () => {
    const kv = new LosingKv()
    const docs = make(kv, 3)
    const t = docs.in('a')
    await t.insert('x', { v: 1 })
    const error = await t.update('x', (cur) => ({ v: (cur?.v ?? 0) + 1 })).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(KvContentionError)
    expect(error).toMatchObject({ name: 'KvContentionError', table: 'product/inbox/conv/a', id: 'x', attempts: 3 })
    expect((await t.get('x'))?.doc).toEqual({ v: 1 })
  })

  it('creates the document when fn is called with undefined', async () => {
    const t = make().in('a')
    expect(await t.update('x', (cur) => ({ v: (cur?.v ?? 0) + 5 }))).toMatchObject({ doc: { v: 5 } })
    expect(await t.update('x', (cur) => ({ v: (cur?.v ?? 0) + 5 }))).toMatchObject({ doc: { v: 10 } })
  })
})

describe('validation', () => {
  it('rejects a document whose order() is not a number before writing', async () => {
    const docs = new TenantDocs<Doc>(new MemoryKv(), { family: ['x'], parse, order: () => Number.NaN })
    await expect(docs.in('a').insert('x', { v: 1 })).rejects.toThrow(TypeError)
    expect(await docs.in('a').get('x')).toBeUndefined()
  })

  it('wraps parse failures in CorruptDocumentError with the cause', async () => {
    const kv = new MemoryKv()
    const index: DurableKvIndex = { due: 0, done: null }
    await kv.insert('product/inbox/conv/a', 'x', '{"v":"nope"}', index)
    const error = await make(kv).in('a').get('x').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(CorruptDocumentError)
    expect((error as Error).cause).toBeInstanceOf(TypeError)
  })

  it('rejects a bad list limit', async () => {
    await expect(make().in('a').list({ limit: -1 })).rejects.toThrow(RangeError)
    await expect(make().in('a').list({ limit: 1.5 })).rejects.toThrow(RangeError)
  })
})

describe('write validation (a write can never poison a table)', () => {
  it('refuses to insert, replace or update a document its own parse() would reject', async () => {
    const kv = new MemoryKv()
    const table = make(kv).in('a')
    await expect(table.insert('x', { v: 'nope' } as unknown as Doc)).rejects.toBeInstanceOf(InvalidDocumentError)
    expect(await kv.get('product/inbox/conv/a', 'x')).toBeUndefined()
    const created = await table.insert('x', { v: 1 })
    await expect(table.replace('x', created!.version, { v: Number.NaN })).rejects.toBeInstanceOf(InvalidDocumentError)
    await expect(table.update('x', () => ({ v: undefined }) as unknown as Doc)).rejects.toThrow(TypeError)
    expect((await table.get('x'))?.doc).toEqual({ v: 1 })
    expect(await table.list()).toEqual([{ v: 1 }])
  })

  it('never puts the document contents in the error message', async () => {
    const error = await make().in('a').insert('x', { v: 'secret-555' } as unknown as Doc).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TypeError)
    expect((error as Error).message).not.toContain('secret-555')
    expect((error as Error).message).toContain('"x"')
  })
})

describe('document ids', () => {
  it('must be non-empty strings without NUL (PostgreSQL TEXT cannot store it)', async () => {
    const table = make().in('a')
    await expect(table.insert('a\u0000b', { v: 1 })).rejects.toThrow(TypeError)
    await expect(table.insert('', { v: 1 })).rejects.toThrow(TypeError)
    await expect(table.get(42 as unknown as string)).rejects.toThrow(TypeError)
    await expect(table.update('a\u0000', () => ({ v: 1 }))).rejects.toThrow(TypeError)
    await expect(table.insert('🦜 ñ/x:{y}', { v: 1 })).resolves.toBeDefined()
  })
})

describe('unbounded listings', () => {
  it('pass a finite limit to the backend when limit is Infinity (real backends reject Infinity)', async () => {
    const seen: number[] = []
    class FiniteKv extends MemoryKv {
      override async range(table: string, index: 'due' | 'done', max: number, limit: number): Promise<string[]> {
        if (!Number.isSafeInteger(limit)) throw new Error(`backend rejects limit ${limit}`)
        seen.push(limit)
        return super.range(table, index, max, limit)
      }
    }
    const table = make(new FiniteKv()).in('a')
    await table.insert('x', { v: 1 })
    expect(await table.list({ limit: Number.POSITIVE_INFINITY })).toEqual([{ v: 1 }])
    expect(seen).toEqual([Number.MAX_SAFE_INTEGER])
  })
})
