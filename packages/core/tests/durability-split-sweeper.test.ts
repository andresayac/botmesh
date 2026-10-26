/**
 * Long text in the durable outbox (`bot.enqueue`, records swept in the background):
 *
 * - the parts of a split text go out in order even when an earlier part fails and is
 *   retried later (a later part waits for it instead of overtaking it);
 * - a journaled record whose text is over the transport's limit (journaled by an older
 *   version, or under a larger limit) is split by the sweeper with the same splitter as a
 *   live send: the first part goes out under the record's key and the rest is journaled as
 *   `<key>#2`, `<key>#3`… (deterministic, so a retry or a second pass journals nothing new).
 */
import { describe, expect, it, vi } from 'vitest'
import { Bot, ProviderError, UnsupportedContentError } from '../src/index.js'
import { KvDurability, MemoryKv } from '../src/spi.js'
import { MockProvider } from '../src/testing/index.js'

const LONG = 'Primera frase del mensaje. Segunda frase que sigue. Tercera frase final aquí. Cuarta y última.'
const PARTS = ['Primera frase del mensaje.', 'Segunda frase que sigue.', 'Tercera frase final aquí.', 'Cuarta y última.']
const texts = (provider: MockProvider): string[] =>
  provider.outbox.map((o) => (o.content.kind === 'text' ? o.content.text : `<${o.content.kind}>`))
const fast = { pollMs: 20, outbox: { backoff: { baseMs: 40, capMs: 40 } } }

/** The first `n` sends reject with a transient (retryable) provider error. */
function failFirst(provider: MockProvider, n: number): void {
  const send = provider.send.bind(provider)
  let left = n
  provider.send = async (chatId, content, options) => {
    if (left > 0) { left--; throw new ProviderError('transient') }
    return send(chatId, content, options)
  }
}

describe('durable outbox: split text keeps its order', () => {
  it('a later part waits for an earlier part that failed and is retried', async () => {
    const provider = new MockProvider({ maxTextLength: 30 })
    failFirst(provider, 1)
    const bot = new Bot({ provider, durability: fast })
    bot.on('error', () => {})
    await bot.start()
    await bot.enqueue('user-1', LONG, { idempotencyKey: 'rem-1' })
    await vi.waitFor(() => expect(texts(provider)).toHaveLength(PARTS.length), { timeout: 3_000 })
    expect(texts(provider)).toEqual(PARTS)
    const states = (await bot.durability!.outbox.list()).map((r) => [r.key, r.state])
    expect(states).toEqual([['rem-1', 'sent'], ['rem-1#2', 'sent'], ['rem-1#3', 'sent'], ['rem-1#4', 'sent']])
    await bot.stop()
  })
})

describe('durable outbox: the sweeper splits an over-limit record', () => {
  /** Journal LONG as one record (a transport without a limit that is down), then stop. */
  async function journalWhole(kv: MemoryKv): Promise<void> {
    const down = new MockProvider()
    failFirst(down, Number.MAX_SAFE_INTEGER)
    const old = new Bot({ provider: down, durability: { backend: new KvDurability(kv), ...fast } })
    old.on('error', () => {})
    await old.start()
    await old.enqueue('user-1', LONG, { idempotencyKey: 'rem-9' })
    await vi.waitFor(async () => expect((await old.durability!.outbox.get('rem-9'))?.attempts).toBeGreaterThan(0))
    await old.stop()
  }

  it('sends the parts in order under deterministic keys', async () => {
    const kv = new MemoryKv()
    await journalWhole(kv)
    const provider = new MockProvider({ maxTextLength: 30 })
    const bot = new Bot({ provider, durability: { backend: new KvDurability(kv), ...fast } })
    bot.on('error', () => {})
    await bot.start()
    await vi.waitFor(() => expect(texts(provider)).toHaveLength(PARTS.length), { timeout: 3_000 })
    expect(texts(provider)).toEqual(PARTS)
    for (const t of texts(provider)) expect(t.length).toBeLessThanOrEqual(30)
    const records = await bot.durability!.outbox.list()
    expect(records.map((r) => r.key)).toEqual(['rem-9', 'rem-9#2', 'rem-9#3', 'rem-9#4'])
    expect(records.every((r) => r.state === 'sent')).toBe(true)
    await bot.stop()
  })

  it('a failed first part is retried without journaling or sending any part twice', async () => {
    const kv = new MemoryKv()
    await journalWhole(kv)
    const provider = new MockProvider({ maxTextLength: 30 })
    failFirst(provider, 2)
    const bot = new Bot({ provider, durability: { backend: new KvDurability(kv), ...fast } })
    bot.on('error', () => {})
    await bot.start()
    await vi.waitFor(() => expect(texts(provider)).toHaveLength(PARTS.length), { timeout: 3_000 })
    await new Promise((r) => setTimeout(r, 150))   // a few more sweeps: nothing else goes out
    expect(texts(provider)).toEqual(PARTS)
    expect((await bot.durability!.outbox.list()).map((r) => r.key)).toEqual(['rem-9', 'rem-9#2', 'rem-9#3', 'rem-9#4'])
    await bot.stop()
  })

  it('a journal failure while splitting is retried later (the claim is released, never left to expire)', async () => {
    const kv = new MemoryKv()
    await journalWhole(kv)
    const backend = new KvDurability(kv)
    const scope = backend.scope.bind(backend)
    let failures = 1
    backend.scope = (name) => {
      // The bot journals under its namespace scope: the first part journal write fails once.
      const scoped = scope(name)
      const put = scoped.outbox.put.bind(scoped.outbox)
      scoped.outbox.put = async (record, now, lease) => {
        if (record.key.includes('#') && failures > 0) { failures--; throw new Error('journal down') }
        return put(record, now, lease)
      }
      return scoped
    }
    const provider = new MockProvider({ maxTextLength: 30 })
    const bot = new Bot({ provider, durability: { backend, ...fast } })
    bot.on('error', () => {})
    await bot.start()
    await vi.waitFor(() => expect(texts(provider)).toHaveLength(PARTS.length), { timeout: 3_000 })
    expect(texts(provider)).toEqual(PARTS)
    expect(failures).toBe(0)
    expect((await bot.durability!.outbox.list()).every((r) => r.state === 'sent')).toBe(true)
    await bot.stop()
  })
})


/** Sends whose text satisfies `match` reject with a transient error, `n` times. */
function failText(provider: MockProvider, match: (text: string) => boolean, n: number, error: () => Error = () => new ProviderError('transient')): void {
  const send = provider.send.bind(provider)
  let left = n
  provider.send = async (chatId, content, options) => {
    if (left > 0 && content.kind === 'text' && match(content.text)) { left--; throw error() }
    return send(chatId, content, options)
  }
}

describe('durable outbox: waiting behind an earlier part costs no retry budget', () => {
  it('a part deferred while the earlier part retries keeps its own retries', async () => {
    const provider = new MockProvider({ maxTextLength: 30 })
    // Part 1 fails 4 times (sent at its 5th attempt), then part 2 fails twice.
    failText(provider, (t) => t === PARTS[0], 4)
    failText(provider, (t) => t === PARTS[1], 2)
    const bot = new Bot({ provider, durability: fast })
    bot.on('error', () => {})
    await bot.start()
    await bot.enqueue('user-1', LONG, { idempotencyKey: 'k' })
    await vi.waitFor(() => expect(texts(provider)).toHaveLength(PARTS.length), { timeout: 5_000 })
    expect(texts(provider)).toEqual(PARTS)
    const records = await bot.durability!.outbox.list()
    expect(records.map((r) => [r.key, r.state, r.attempts])).toEqual([
      ['k', 'sent', 5], ['k#2', 'sent', 3], ['k#3', 'sent', 1], ['k#4', 'sent', 1],
    ])
    await bot.stop()
  })

  it('a deferral gives the claimed attempt back (KvOutbox markFailed refund)', async () => {
    const backend = new KvDurability(new MemoryKv())
    const lease = { owner: 'a', leaseMs: 1_000, now: 0 }
    const { record } = await backend.outbox.put({ key: 'x', chatId: 'c', content: 'hi', createdAt: 0 }, 0, lease)
    expect(record.attempts).toBe(1)
    await backend.outbox.markFailed('x', record.fencingToken, { name: 'SendDeferredError', message: 'waiting' }, { now: 0, retryAt: 10, refund: true })
    expect((await backend.outbox.get('x'))?.attempts).toBe(0)
  })
})

describe('durable outbox: user keys ending in #<n> are not split parts', () => {
  it("enqueue('order#3') is not coupled to a dead 'order#2'", async () => {
    const provider = new MockProvider()
    failText(provider, (t) => t === 'first', Number.MAX_SAFE_INTEGER, () => new UnsupportedContentError('text'))
    const bot = new Bot({ provider, durability: fast })
    bot.on('error', () => {})
    await bot.start()
    await bot.enqueue('u', 'first', { idempotencyKey: 'order#2' })
    await vi.waitFor(async () => expect((await bot.durability!.outbox.get('order#2'))?.state).toBe('dead'))
    await bot.enqueue('u', 'second', { idempotencyKey: 'order#3' })
    await vi.waitFor(() => expect(texts(provider)).toEqual(['second']), { timeout: 3_000 })
    expect((await bot.durability!.outbox.get('order#3'))?.state).toBe('sent')
    await bot.stop()
  })

  it("enqueue('invoice#2') does not wait behind a retrying 'invoice'", async () => {
    const provider = new MockProvider()
    failText(provider, (t) => t === 'first', Number.MAX_SAFE_INTEGER)
    const bot = new Bot({ provider, durability: { pollMs: 20, outbox: { backoff: { baseMs: 10_000, capMs: 10_000 } } } })
    bot.on('error', () => {})
    await bot.start()
    await bot.enqueue('u', 'first', { idempotencyKey: 'invoice' })
    await vi.waitFor(async () => expect((await bot.durability!.outbox.get('invoice'))?.state).toBe('failed'))
    await bot.enqueue('u', 'second', { idempotencyKey: 'invoice#2' })
    await vi.waitFor(() => expect(texts(provider)).toEqual(['second']), { timeout: 3_000 })
    await bot.stop()
  })

  it('split parts record the part they follow', async () => {
    const provider = new MockProvider({ maxTextLength: 30 })
    const bot = new Bot({ provider, durability: fast })
    bot.on('error', () => {})
    await bot.start()
    await bot.enqueue('user-1', LONG, { idempotencyKey: 'p' })
    await vi.waitFor(() => expect(texts(provider)).toHaveLength(PARTS.length), { timeout: 3_000 })
    const records = await bot.durability!.outbox.list()
    expect(records.map((r) => [r.key, r.previousPart])).toEqual([
      ['p', undefined], ['p#2', 'p'], ['p#3', 'p#2'], ['p#4', 'p#3'],
    ])
    await bot.stop()
  })
})
