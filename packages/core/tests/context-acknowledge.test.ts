/**
 * `ctx.acknowledge` is always present on a message context (a no-op without an interaction
 * or on a transport without acks), so its type is a required method, not an optional one.
 * The `expectTypeOf` line is enforced by `pnpm typecheck`.
 */
import { describe, it, expect, expectTypeOf, vi } from 'vitest'
import type { MessageContext } from '../src/index.js'
import { createTestBot } from '../src/testing/createTestBot.js'

describe('ctx.acknowledge', () => {
  it('is a required method in the type', () => {
    expectTypeOf<MessageContext['acknowledge']>().toEqualTypeOf<(text?: string) => Promise<void>>()
  })

  it('exists (and is a no-op) on a plain message context', async () => {
    const { bot, chat } = await createTestBot()
    let seen: MessageContext | undefined
    bot.when('hola', async (ctx) => { seen = ctx; await ctx.acknowledge() })
    await chat.send('hola')
    await vi.waitFor(() => expect(seen).toBeDefined())
    expect(typeof seen!.acknowledge).toBe('function')
    await bot.stop()
  })
})
