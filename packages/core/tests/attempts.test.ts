/**
 * `maxAttempts` = total answers a wait accepts (first included); `retries` = attempts AFTER
 * the first (`retries: N` ≡ `maxAttempts: N + 1`). Same meaning as `durability.outbox.retries`.
 */
import { describe, it, expect } from 'vitest'

import { flow } from '../src/index.js'
import { attemptBudget, DEFAULT_MAX_ATTEMPTS } from '../src/conversations/retry.js'
import { createTestBot } from '../src/testing/index.js'

const ENDED = '❌ Too many attempts. Conversation ended.'

describe('attempt budget', () => {
  it('resolves maxAttempts, retries + 1 and the default', () => {
    expect(DEFAULT_MAX_ATTEMPTS).toBe(3)
    expect(attemptBudget(undefined)).toBe(3)
    expect(attemptBudget({ maxAttempts: 2 })).toBe(2)
    expect(attemptBudget({ retries: 2 })).toBe(3)
    expect(attemptBudget({ retries: 0 })).toBe(1)
    expect(attemptBudget({ retries: Infinity })).toBe(Infinity)
    expect(attemptBudget({ retries: 1, maxAttempts: 2 })).toBe(2)
  })
})

describe('waits honour maxAttempts and retries', () => {
  async function invalidAnswersUntilEnd(opts: { maxAttempts?: number; retries?: number }): Promise<number> {
    const { bot, chat } = await createTestBot()
    bot.registerFlow(flow('go').ask('Q?', 'v', { ...opts, validate: () => 'again' }))
    await chat.send('go')
    await chat.expectReply('Q?')
    let answers = 0
    for (;;) {
      answers++
      await chat.send(`bad ${answers}`)
      const reply = await chat.expectReply(/^(again|❌ Too many attempts)/)
      if (reply === ENDED) break
      expect(reply).toBe('again')
      if (answers > 10) throw new Error('never ended')
    }
    await bot.stop()
    return answers
  }

  it('default: 3 answers in total', async () => {
    expect(await invalidAnswersUntilEnd({})).toBe(3)
  })

  it('maxAttempts: 2 accepts 2 answers', async () => {
    expect(await invalidAnswersUntilEnd({ maxAttempts: 2 })).toBe(2)
  })

  it('retries: 2 accepts the first answer plus 2 retries', async () => {
    expect(await invalidAnswersUntilEnd({ retries: 2 })).toBe(3)
  })

  it('retries: 0 ends on the first invalid answer', async () => {
    expect(await invalidAnswersUntilEnd({ retries: 0 })).toBe(1)
  })

  it('c.ask() with conflicting options rejects', async () => {
    const { bot, chat } = await createTestBot()
    const errors: unknown[] = []
    bot.on('error', ({ error }) => errors.push(error))
    bot.conversation('c', async (c) => { await c.ask('Q?', { maxAttempts: 4, retries: 1 }) }, { trigger: 'c' })
    await chat.send('c')
    await expect.poll(() => errors.length).toBe(1)
    expect(String(errors[0])).toMatch(/not both/)
    await bot.stop()
  })
})
