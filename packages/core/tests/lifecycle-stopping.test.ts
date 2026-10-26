/**
 * `'stopping'`: emitted once per `stop()` of a running bot, as soon as inbound is closed and
 * BEFORE the drain and the transport stop, so plugins can cancel long work (model calls,
 * downloads) while the transport can still deliver what is already in flight. `'stopped'`
 * still comes last. A throwing listener never breaks the stop.
 */
import { describe, it, expect } from 'vitest'

import { Bot } from '../src/index.js'
import { MockProvider } from '../src/testing/MockProvider.js'

function make() {
  const provider = new MockProvider()
  const bot = new Bot({ provider })
  const events: string[] = []
  const stop = provider.stop.bind(provider)
  provider.stop = async () => { events.push('provider.stop'); await stop() }
  bot.on('stopping', () => events.push('stopping'))
  bot.on('stopped', () => events.push('stopped'))
  return { bot, provider, events }
}

describe("bot 'stopping' event", () => {
  it('fires before the transport stops, then stopped', async () => {
    const { bot, events } = make()
    await bot.start()
    await bot.stop()
    expect(events).toEqual(['stopping', 'provider.stop', 'stopped'])
  })

  it('fires before the drain waits for in-flight sends', async () => {
    const { bot, provider, events } = make()
    await bot.start()
    let release!: () => void
    const send = provider.send.bind(provider)
    provider.send = async (...args) => {
      events.push('send:start')
      await new Promise<void>((r) => { release = r })
      events.push('send:end')
      return send(...args)
    }
    const inflight = bot.send('a@s', 'slow')
    await new Promise((r) => setTimeout(r, 0))
    bot.once('stopping', () => { setTimeout(() => release(), 5) })
    await bot.stop({ drain: true })
    await inflight
    expect(events).toEqual(['send:start', 'stopping', 'send:end', 'provider.stop', 'stopped'])
  })

  it('is not emitted by stop() on a bot that is not running, and fires again on each stop', async () => {
    const { bot, events } = make()
    await bot.stop()
    expect(events).toEqual([])
    await bot.start(); await bot.stop()
    await bot.start(); await bot.stop()
    expect(events.filter((e) => e === 'stopping')).toHaveLength(2)
  })

  it('a throwing listener is reported on error and the stop completes', async () => {
    const { bot, events } = make()
    const errors: unknown[] = []
    bot.on('error', ({ error }) => errors.push(error))
    bot.on('stopping', () => { throw new Error('listener boom') })
    await bot.start()
    await bot.stop()
    expect(events).toEqual(['stopping', 'provider.stop', 'stopped'])
    expect(errors.map((e) => (e as Error).message)).toContain('listener boom')
  })
})
