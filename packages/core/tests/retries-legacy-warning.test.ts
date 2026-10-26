/**
 * Soft path for the 2.0 change of `retries` (now "attempts after the first"; during the
 * alphas it meant total attempts): a wait, form or flow step that sets `retries` without
 * `maxAttempts` logs ONE warning per bot, so alpha users notice their budget grew by one.
 */
import { describe, it, expect, vi } from 'vitest'

import { flow } from '../src/index.js'
import { createTestBot } from '../src/testing/index.js'

function spyLogger() {
  const warn = vi.fn()
  const logger: any = {
    debug: vi.fn(), info: vi.fn(), warn, error: vi.fn(), trace: vi.fn(), fatal: vi.fn(),
    child() { return logger },
  }
  const retriesWarnings = () => warn.mock.calls.filter((call) => call.some((a) => typeof a === 'string' && a.includes('maxAttempts')))
  return { logger, retriesWarnings }
}

describe('legacy retries warning', () => {
  it('warns once per bot when a wait uses retries without maxAttempts', async () => {
    const { logger, retriesWarnings } = spyLogger()
    const { bot, chat } = await createTestBot({ logger })
    bot.registerFlow(flow('go').ask('Q?', 'v', { retries: 2 }).say('ok'))
    await chat.send('go')
    await chat.expectReply('Q?')
    await chat.send('a')
    await chat.expectReply('ok')
    await chat.send('go')
    await chat.expectReply('Q?')
    await chat.send('b')
    await chat.expectReply('ok')
    expect(retriesWarnings()).toHaveLength(1)
    await bot.stop()
  })

  it('warns for a form step with retries', async () => {
    const { logger, retriesWarnings } = spyLogger()
    const { bot, chat } = await createTestBot({ logger })
    bot.registerFlow(flow('f').form({ id: 'f', fields: [{ name: 'n', label: 'Name', type: 'text' }] }, { retries: 1, mode: 'degraded' }).say('done'))
    await chat.send('f')
    await expect.poll(() => retriesWarnings().length).toBe(1)
    await bot.stop()
  })

  it('stays quiet with maxAttempts (or both, agreeing) and with the default', async () => {
    const { logger, retriesWarnings } = spyLogger()
    const { bot, chat } = await createTestBot({ logger })
    bot.registerFlow(flow('a').ask('A?', 'v', { maxAttempts: 2 }).say('ok a'))
    bot.registerFlow(flow('b').ask('B?', 'v', { maxAttempts: 3, retries: 2 }).say('ok b'))
    bot.registerFlow(flow('c').ask('C?', 'v').say('ok c'))
    for (const k of ['a', 'b', 'c']) {
      await chat.send(k)
      await chat.expectReply(`${k.toUpperCase()}?`)
      await chat.send('x')
      await chat.expectReply(`ok ${k}`)
    }
    expect(retriesWarnings()).toHaveLength(0)
    await bot.stop()
  })
})
