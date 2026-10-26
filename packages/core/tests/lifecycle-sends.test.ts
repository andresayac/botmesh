/**
 * Sends need a running bot: before `start()` and after `stop()` they reject with a typed
 * `BotNotRunningError` and never reach the provider. Concurrent `start()` / `stop()` calls
 * run one at a time, in call order, so the last call decides the final state.
 */
import { describe, it, expect } from 'vitest'

import { Bot, BotNotRunningError } from '../src/index.js'
import { MockProvider } from '../src/testing/MockProvider.js'

function make() {
  const provider = new MockProvider()
  const bot = new Bot({ provider })
  const events: string[] = []
  bot.on('started', () => events.push('started'))
  bot.on('stopped', () => events.push('stopped'))
  return { bot, provider, events }
}

describe('sends outside start()/stop()', () => {
  it('bot.send() before start() rejects with BotNotRunningError and sends nothing', async () => {
    const { bot, provider } = make()
    const error = await bot.send('a@s', 'hi').then(() => undefined, (e: unknown) => e)
    expect(error).toBeInstanceOf(BotNotRunningError)
    expect((error as BotNotRunningError).code).toBe('BOT_NOT_RUNNING')
    expect(String((error as Error).message)).toMatch(/start\(\)/)
    expect(String((error as Error).message)).not.toContain('a@s')
    expect(provider.outbox).toHaveLength(0)
  })

  it('bot.send() after stop() rejects and sends nothing', async () => {
    const { bot, provider } = make()
    await bot.start()
    await bot.send('a@s', 'one')
    await bot.stop()
    await expect(bot.send('a@s', 'two')).rejects.toBeInstanceOf(BotNotRunningError)
    expect(provider.outbox).toHaveLength(1)
  })

  it('a send from a ready listener (while the transport connects) goes out', async () => {
    const { bot, provider } = make()
    const sent = new Promise<void>((resolve, reject) => {
      bot.on('ready', () => { bot.send('a@s', 'ready!').then(() => resolve(), reject) })
    })
    await bot.start()
    await sent
    expect(provider.outbox).toHaveLength(1)
    await bot.stop()
  })

  it('works again after a restart', async () => {
    const { bot, provider } = make()
    await bot.start()
    await bot.stop()
    await bot.start()
    await bot.send('a@s', 'back')
    expect(provider.outbox).toHaveLength(1)
    await bot.stop()
  })
})

describe('concurrent start()/stop()', () => {
  it('start, stop, start → running, events in call order', async () => {
    const { bot, provider, events } = make()
    await Promise.all([bot.start(), bot.stop(), bot.start()])
    expect(events).toEqual(['started', 'stopped', 'started'])
    expect(bot.getConnectionState()).toBe('ready')
    await bot.send('a@s', 'ok')
    expect(provider.outbox).toHaveLength(1)
    await bot.stop()
  })

  it('start, stop → stopped', async () => {
    const { bot, events } = make()
    await Promise.all([bot.start(), bot.stop()])
    expect(events).toEqual(['started', 'stopped'])
    expect(bot.getConnectionState()).toBe('closed')
    await expect(bot.send('a@s', 'no')).rejects.toBeInstanceOf(BotNotRunningError)
  })

  it('repeated start() calls start once; repeated stop() calls stop once', async () => {
    const { bot, events } = make()
    await Promise.all([bot.start(), bot.start(), bot.start()])
    await Promise.all([bot.stop(), bot.stop()])
    expect(events).toEqual(['started', 'stopped'])
  })

  it('a start() that fails leaves the bot stopped; sends keep rejecting', async () => {
    const provider = new MockProvider()
    provider.start = async () => { throw new Error('no network') }
    const bot = new Bot({ provider })
    await expect(bot.start()).rejects.toThrow('no network')
    await expect(bot.send('a@s', 'x')).rejects.toBeInstanceOf(BotNotRunningError)
  })
})
