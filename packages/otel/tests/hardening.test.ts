import { afterEach, describe, expect, it, vi } from 'vitest'
import { Bot, flow } from '@botmesh/core'
import { MockProvider } from '@botmesh/core/testing'

import { bridgeMetrics, createOtelTracer, lazyOtelTracer, otelMetricsPlugin, otelTracer } from '../src/index.js'
import { api, memoryMetrics, memoryTracing, tick } from './helpers.js'

let env: ReturnType<typeof memoryTracing> | undefined
afterEach(async () => { await env?.close(); env = undefined })

type Hist = { value: { count: number; sum: number; buckets: { boundaries: number[]; counts: number[] } }; attributes: Record<string, unknown> }

describe('histogram buckets fit their units', () => {
  it('second-based latency histograms use sub-second boundaries (not the millisecond defaults)', async () => {
    env = memoryTracing()
    const m = memoryMetrics()
    const tracer = otelTracer({ api, tracerProvider: env.provider, spanMetrics: { meterProvider: m.meterProvider } })
    for (const name of ['bot.inbound', 'bot.dispatch', 'bot.send', 'bot.lifecycle']) {
      tracer.startSpan(name, { attributes: { 'bot.queue.wait_ms': 20 } }).end()
    }
    tracer.startSpan('chat m', { attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.usage.input_tokens': 300 } }).end()
    for (const metric of ['botmesh.inbound.duration', 'botmesh.dispatch.duration', 'botmesh.queue.wait', 'botmesh.send.duration', 'botmesh.lifecycle.duration', 'gen_ai.client.operation.duration']) {
      const [p] = await m.points(metric) as Hist[]
      expect(p, metric).toBeDefined()
      const b = p!.value.buckets.boundaries
      // A 20 ms wait / sub-millisecond span must not fall in the same bucket as a 4 s one.
      expect(b[0], metric).toBeLessThanOrEqual(0.01)
      expect(b.some((x) => x > 0.01 && x < 1), metric).toBe(true)
      expect(b[b.length - 1], metric).toBeGreaterThanOrEqual(10)
    }
    const [tokens] = await m.points('gen_ai.client.token.usage') as Hist[]
    const tb = tokens!.value.buckets.boundaries
    expect(tb[tb.length - 1]).toBeGreaterThan(100_000)
    expect(tb.filter((x) => x <= 10_000).length).toBeGreaterThan(3)
  })

  it('the conversation duration histogram covers seconds to hours', async () => {
    const m = memoryMetrics()
    const provider = new MockProvider()
    const bot = new Bot({ provider })
    await bot.start()
    const dispose = bridgeMetrics(api, bot, { meterProvider: m.meterProvider })
    bot.use(flow('hola').say('hola'))
    provider.incoming('hola', { from: 'u1' })
    await tick()
    const [p] = await m.points('botmesh.conversation.duration') as Hist[]
    const b = p!.value.buckets.boundaries
    expect(b[0]).toBeLessThanOrEqual(1)
    expect(b).toContain(60)
    expect(b[b.length - 1]).toBeGreaterThanOrEqual(3600)
    dispose()
    await bot.stop()
  })
})

describe('span timing', () => {
  it('span metrics honour startTimeMs / endTimeMs (epoch milliseconds)', async () => {
    env = memoryTracing()
    const m = memoryMetrics()
    const tracer = otelTracer({ api, tracerProvider: env.provider, spanMetrics: { meterProvider: m.meterProvider } })
    tracer.startSpan('bot.send', { startTimeMs: Date.now() - 2000 }).end()
    const start = Date.now()
    tracer.startSpan('bot.dispatch', { startTimeMs: start }).end(start + 1500)
    const [send] = await m.points('botmesh.send.duration') as Hist[]
    expect(send!.value.sum).toBeGreaterThanOrEqual(1.9)
    expect(send!.value.sum).toBeLessThan(3)
    const [dispatch] = await m.points('botmesh.dispatch.duration') as Hist[]
    expect(dispatch!.value.sum).toBeCloseTo(1.5, 2)
  })

  it('a wall-clock step does not leak into span metric durations (no mixed clocks)', async () => {
    env = memoryTracing()
    const m = memoryMetrics()
    const tracer = otelTracer({ api, tracerProvider: env.provider, spanMetrics: { meterProvider: m.meterProvider } })
    // The wall clock steps 120 s back (NTP correction / resume from sleep) relative to the monotonic anchor.
    const stepped = Date.now() - 120_000
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => stepped)
    try {
      // startTimeMs given, end() without argument: both ends on the caller's (wall) clock.
      tracer.startSpan('bot.send', { startTimeMs: Date.now() }).end()
      // endTimeMs given without startTimeMs: same.
      tracer.startSpan('bot.dispatch').end(Date.now() + 250)
      // Neither given: a pure monotonic difference, immune to the step.
      const s = tracer.startSpan('bot.inbound')
      spy.mockImplementation(() => stepped + 3_600_000)
      s.end()
    } finally { spy.mockRestore() }
    const [send] = await m.points('botmesh.send.duration') as Hist[]
    expect(send!.value.sum).toBeLessThan(0.1)
    expect(send!.value.sum).toBeGreaterThanOrEqual(0)
    const [dispatch] = await m.points('botmesh.dispatch.duration') as Hist[]
    expect(dispatch!.value.sum).toBeCloseTo(0.25, 1)
    const [inbound] = await m.points('botmesh.inbound.duration') as Hist[]
    expect(inbound!.value.sum).toBeLessThan(0.1)
  })

  it('a negative explicit duration (end before start) records 0, never a negative value', async () => {
    env = memoryTracing()
    const m = memoryMetrics()
    const tracer = otelTracer({ api, tracerProvider: env.provider, spanMetrics: { meterProvider: m.meterProvider } })
    const start = Date.now()
    tracer.startSpan('bot.send', { startTimeMs: start }).end(start - 500)
    const [send] = await m.points('botmesh.send.duration') as Hist[]
    expect(send!.value.sum).toBe(0)
  })
})

describe('option validation', () => {
  it('an invalid metric prefix fails fast with a clear message', async () => {
    const m = memoryMetrics()
    const bot = new Bot({ provider: new MockProvider() })
    expect(() => bridgeMetrics(api, bot, { meterProvider: m.meterProvider, prefix: 'my bot!' }))
      .toThrow(/prefix.*"my bot!".*letter/)
    expect(() => otelTracer({ api, spanMetrics: { meterProvider: m.meterProvider, prefix: '1x' } }))
      .toThrow(/spanMetrics\.prefix.*"1x"/)
    await expect(createOtelTracer({ api, spanMetrics: { prefix: 'a b' } })).rejects.toThrow(/prefix/)
    await expect(lazyOtelTracer({ api, spanMetrics: { prefix: 'a b' } }).ready).rejects.toThrow(/prefix/)
    // Valid ones (dots, dashes, underscores, slashes) pass.
    expect(() => bridgeMetrics(api, bot, { meterProvider: m.meterProvider, prefix: 'acme.bot_v2-x/y' })).not.toThrow()
  })
})

describe('otelMetricsPlugin (lazy path)', () => {
  it('a bridge that fails after @opentelemetry/api loads is logged, never an unhandled rejection', async () => {
    const errors: unknown[][] = []
    const logger = { debug() {}, info() {}, warn() {}, error: (...a: unknown[]) => { errors.push(a) } }
    const bot = new Bot({ provider: new MockProvider(), logger })
    const unhandled: unknown[] = []
    const onUnhandled = (e: unknown) => { unhandled.push(e) }
    process.on('unhandledRejection', onUnhandled)
    try {
      const meterProvider = { getMeter: () => { throw new Error('meter boom') } }
      bot.plug(otelMetricsPlugin({ meterProvider: meterProvider as never }))
      await vi.waitFor(() => expect(errors.length).toBe(1))
      await tick(30)
      expect(unhandled).toEqual([])
      expect(String(errors[0]![1])).toMatch(/otel metrics/)
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})

describe('seeded fuzzing of the tracer surface', () => {
  it('random names, attributes, events, links and statuses never throw and always export', async () => {
    env = memoryTracing()
    const m = memoryMetrics()
    const tracer = otelTracer({ api, tracerProvider: env.provider, spanMetrics: { meterProvider: m.meterProvider } })
    let seed = 0x5eed
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
    const pickOne = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!
    const strings = ['', 'a', '🎉👋🏽', 'ñandú', '\u0000\uffff', '__proto__', 'constructor', 'x'.repeat(10_000), 'bot.send', 'chat m', '\ud800']
    const values: unknown[] = [...strings, 0, -1, NaN, Infinity, 1e308, true, false, undefined, ['a', 'b'], [1, 2], [true], []]
    const names = ['bot.inbound', 'bot.dispatch', 'bot.send', 'bot.lifecycle', ...strings]
    const attrs = () => Object.fromEntries(Array.from({ length: Math.floor(rnd() * 6) }, () => [pickOne([...strings, 'gen_ai.operation.name', 'bot.queue.wait_ms', 'gen_ai.usage.input_tokens']), pickOne(values)])) as never
    let parent: ReturnType<typeof tracer.startSpan> | undefined
    for (let i = 0; i < 500; i++) {
      const span = tracer.startSpan(pickOne(names), {
        kind: pickOne(['internal', 'server', 'client', 'producer', 'consumer'] as const),
        attributes: attrs(),
        parent: pickOne([undefined, null, parent]),
        links: rnd() < 0.3 ? [{ context: { traceId: pickOne(['0'.repeat(32), 'zz', 'a'.repeat(32)]), spanId: pickOne(['1'.repeat(16), '']), traceState: pickOne([undefined, 'k=v', '=,=,bad', 'x'.repeat(600)]), isRemote: rnd() < 0.5 } }] : undefined,
        startTimeMs: rnd() < 0.2 ? Date.now() - rnd() * 1e6 : undefined,
      })
      span.setAttribute(pickOne(strings), pickOne(values) as never)
      span.setAttributes(attrs())
      span.addEvent(pickOne(strings), attrs())
      if (rnd() < 0.3) span.recordException({ name: pickOne(strings), code: pickOne([undefined, 'E', 42]) as never })
      span.setStatus({ code: pickOne(['ok', 'error', 'unset'] as const) })
      tracer.withSpan!(span, () => undefined)
      expect(span.spanContext()).toBeDefined()
      span.end(rnd() < 0.2 ? Date.now() : undefined)
      if (rnd() < 0.5) parent = span
    }
    expect(env.spans()).toHaveLength(500)
    await m.collect()
  })
})
