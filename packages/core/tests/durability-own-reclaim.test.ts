/**
 * A restarted replica's first sweep reclaims the sends its dead incarnation left `sending`
 * (`reclaimOwn`). It runs right after the recovered messages start replaying, so it can
 * also re-claim a send THIS incarnation just claimed inline (same `instanceId`). Before the
 * fix the inline send's completion then carried a superseded fencing token: the provider
 * delivered the message but the record stayed `sending` (leased for 60 s), so the crash
 * matrix on Redis Cluster timed out now and then. Here the interleaving is forced.
 */
import { describe, expect, it } from 'vitest'
import { Bot, KvDurability, MemoryKv, MemoryStore, type DurabilityBackend, type OutboxJournal } from '../src/index.js'
import { MockProvider, crashable } from '../src/testing/index.js'

function silentLogger(): never {
  const noop = () => {}
  const l: Record<string, unknown> = { debug: noop, info: noop, warn: noop, error: noop, trace: noop, fatal: noop, level: 'silent' }
  l.child = () => l
  return l as never
}

interface Gate { promise: Promise<void>; resolve: () => void }

function deferred(): Gate {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

/** The second `reclaimOwn` claim (the first sweep) waits for the inline put; it then unblocks the provider. */
function gated(inner: DurabilityBackend, gates: { put: Gate; swept: Gate }): DurabilityBackend {
  let reclaims = 0
  const outbox = new Proxy(inner.outbox, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown
      if (typeof value !== 'function') return value
      const fn = value as (...a: unknown[]) => Promise<unknown>
      if (prop === 'put') return async (...args: unknown[]) => { const out = await fn.apply(target, args); gates.put.resolve(); return out }
      if (prop === 'claimDue') {
        return async (...args: unknown[]) => {
          const o = args[0] as { reclaimOwn?: boolean }
          if (o.reclaimOwn && ++reclaims === 2) {
            await gates.put.promise
            const out = await fn.apply(target, args)
            gates.swept.resolve()
            return out
          }
          return fn.apply(target, args)
        }
      }
      return fn.bind(target)
    },
  }) as OutboxJournal
  return {
    inbox: inner.inbox,
    outbox,
    ...(inner.exclusive !== undefined ? { exclusive: inner.exclusive } : {}),
    ...(inner.scope ? { scope: (name: string) => gated(inner.scope!(name), gates) } : {}),
    ...(inner.start ? { start: () => inner.start!() } : {}),
    ...(inner.stop ? { stop: () => inner.stop!() } : {}),
  }
}

/** A provider whose sends wait until `gate` opens. */
class GatedProvider extends MockProvider {
  constructor(private readonly gate: Promise<unknown>) { super() }
  override async send(...args: Parameters<MockProvider['send']>): ReturnType<MockProvider['send']> {
    await this.gate
    return super.send(...args)
  }
}

describe('durability: the first sweep of a restarted replica and its own inline sends', () => {
  it('a send re-claimed by our own reclaimOwn sweep still ends `sent`', async () => {
    const kv = new MemoryKv()
    const store = new MemoryStore()
    const config = { instanceId: 'replica-1', pollMs: 20 }

    // Incarnation A dies while replying to m1: the inbound stays leased to replica-1.
    const a = crashable(new KvDurability(kv))
    a.crashBefore('outbox.put', 1)
    const pa = new MockProvider()
    const botA = new Bot({ provider: pa, store, logger: silentLogger(), durability: { journal: a, ...config } })
    botA.on('error', () => {})
    botA.when('hola', async (ctx) => { await ctx.reply('hola!') })
    await botA.start()
    pa.incoming('hola', { from: 'u1', id: 'm1' })
    await a.whenCrashed

    // Incarnation B: the replay of m1 claims its reply inline, then the first sweep runs.
    const gates = { put: deferred(), swept: deferred() }
    const pb = new GatedProvider(gates.swept.promise)
    const backend = gated(new KvDurability(kv), gates)
    const botB = new Bot({ provider: pb, store, logger: silentLogger(), durability: { journal: backend, ...config } })
    botB.on('error', () => {})
    botB.when('hola', async (ctx) => { await ctx.reply('hola!') })
    await botB.start()

    const view = botB.durability!
    const deadline = Date.now() + 5_000
    let states: string[] = []
    while (Date.now() < deadline) {
      states = (await view.outbox.list()).map((r) => r.state)
      if (states.length === 1 && states[0] === 'sent') break
      await new Promise((r) => setTimeout(r, 10))
    }
    expect(states).toEqual(['sent'])
    expect(pb.outbox.map((m) => (m.content as { text?: string }).text)).toEqual(['hola!'])
    await botB.stop()
  })
})
