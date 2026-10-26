/**
 * Durability × coordination: the replica that takes a parked conversation feeds it the
 * waking message as the answer of the parked wait. The sends that answer makes must be
 * keyed by the waking message (like a live delivery), not continue the previous turn's
 * causation at a sequence whose prompt was never re-sent: that collided with the prompt's
 * outbox record, so `onDiverged: 'skip'` swallowed the reply (and `'send'` counted a
 * false divergence and logged a warning).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  Bot,
  MemoryDurability,
  MemoryStore,
  flow,
  type BotConfig,
} from '../src/index.js'
import {
  MemoryCoordinationHub,
  MemoryCoordinator,
} from '../src/testing/index.js'
import { MockProvider } from '../src/testing/index.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
function silent(): BotConfig['logger'] {
  const noop = () => {}
  const l = { debug: noop, info: noop, warn: noop, error: noop, trace: noop, fatal: noop, child: () => l, level: 'silent' }
  return l as unknown as BotConfig['logger']
}
const texts = (p: MockProvider) => p.outbox.map((m) => (m.content.kind === 'text' ? m.content.text : m.content.kind))

const bots: Bot[] = []
afterEach(async () => { for (const b of bots.splice(0)) await Promise.race([b.stop().catch(() => {}), sleep(500)]) })

describe.each([
  ['a persistent flow', { persistent: true, forward: false }],
  ["a flow forwarded by handover.flows: 'forward'", { persistent: false, forward: true }],
])('hand-over of %s keeps the answer\'s sends apart from the prompt\'s', (_label, mode) => {
  it.each(['skip', 'send'] as const)("onDiverged: '%s'", async (onDiverged) => {
    const hub = new MemoryCoordinationHub()
    const store = new MemoryStore()
    const journal = new MemoryDurability()
    const replica = (id: string) => {
      const provider = new MockProvider()
      const bot = new Bot({
        provider, store, botId: 'shop', logger: silent(),
        coordination: {
          coordinator: new MemoryCoordinator({ hub, replicaId: id }),
          ...(mode.forward ? { handover: { flows: 'forward' as const } } : {}),
        },
        durability: { journal, instanceId: id, pollMs: 10, outbox: { onDiverged } },
      })
      const f = flow('signup').say('hi').ask('name?', 'name').ask('email?', 'email')
        .say((_ctx, c) => `done ${String(c.state.name)} ${String(c.state.email)}`)
      bot.use(mode.persistent ? f.persistent() : f)
      bots.push(bot)
      return { bot, provider }
    }
    const a = replica('a')
    const b = replica('b')
    await a.bot.start()
    await b.bot.start()
    a.provider.incoming('signup', { from: 'c1', id: 'w1' })
    await vi.waitFor(() => expect(texts(a.provider)).toEqual(['hi', 'name?']))
    await sleep(150) // the parked marker lands
    b.provider.incoming('Ana', { from: 'c1', id: 'w2' })
    await vi.waitFor(() => expect(texts(b.provider)).toEqual(['email?']))
    b.provider.incoming('ana@x.co', { from: 'c1', id: 'w3' })
    await vi.waitFor(() => expect(texts(b.provider)).toEqual(['email?', 'done Ana ana@x.co']))
    expect(b.bot.durability!.metrics().outboxDiverged).toBe(0)
    expect(texts(a.provider)).toEqual(['hi', 'name?'])
  })
})
