/**
 * A provider that emits an event breaking the normalized contract gets ONE clear
 * `InvalidProviderEventError` on the bot `'error'` event (naming the provider and the
 * broken field), instead of a generic `TypeError` from deep inside the pipeline. The event
 * is dropped; the bot keeps working.
 */
import { describe, it, expect } from 'vitest'

import { InvalidProviderEventError } from '../src/index.js'
import type { InboundEvent } from '../src/index.js'
import { createTestBot } from '../src/testing/index.js'

async function setup() {
  const t = await createTestBot()
  const errors: unknown[] = []
  t.bot.on('error', ({ error }) => errors.push(error))
  const handled: string[] = []
  t.bot.onMessage(async (ctx) => { handled.push(ctx.body); await ctx.reply('ok') })
  // Straight to the bot's listener, as a buggy provider would.
  const emit = (event: unknown) => {
    for (const listener of (t.provider as unknown as { listeners: Set<(e: InboundEvent) => void> }).listeners) listener(event as InboundEvent)
  }
  return { ...t, errors, handled, emit }
}

const good = {
  ref: { id: 'm1', chatId: 'c@s' }, chat: { id: 'c@s', kind: 'dm', isGroup: false, isBroadcast: false },
  senderInfo: { id: 'c@s' }, from: 'c@s', sender: 'c@s', chatId: 'c@s', senderId: 'c@s',
  isGroup: false, isBroadcast: false, fromMe: false, type: 'text', body: 'hi', timestamp: 0, mentions: [], raw: {},
}

describe('malformed provider events', () => {
  it.each([
    ['null', null, /not an object/],
    ['a string', 'message', /not an object/],
    ['a kind that is not a string', { kind: 7 }, /kind must be a string/],
    ['a message event without message', { kind: 'message' }, /message must be an object/],
    ['a message without chatId', { kind: 'message', message: { ...good, chatId: undefined } }, /message\.chatId/],
    ['a message without ref', { kind: 'message', message: { ...good, ref: undefined } }, /message\.ref/],
    ['a message with a non-string body', { kind: 'message', message: { ...good, body: 42 } }, /message\.body/],
    ['an interaction without data', { kind: 'interaction', interaction: { ref: { id: 'i', chatId: 'c@s' }, chatId: 'c@s', senderId: 'c@s' } }, /interaction\.data/],
    ['a connection event without update', { kind: 'connection' }, /update must be an object/],
    ['a status event without status', { kind: 'status' }, /status must be an object/],
  ])('%s raises one InvalidProviderEventError', async (_name, event, reason) => {
    const { bot, errors, handled, emit } = await setup()
    emit(event)
    await expect.poll(() => errors.length).toBe(1)
    const error = errors[0] as InvalidProviderEventError
    expect(error).toBeInstanceOf(InvalidProviderEventError)
    expect(error.message).toMatch(/^provider "mock" emitted an invalid event: /)
    expect(error.reason).toMatch(reason)
    expect(error.message).not.toContain('c@s')
    expect(handled).toEqual([])
    await bot.stop()
  })

  it('the bot keeps working after a bad event', async () => {
    const { bot, chat, errors, emit } = await setup()
    emit({ kind: 'message', message: { ...good, senderId: 7 } })
    await expect.poll(() => errors.length).toBe(1)
    await chat.send('hello')
    await chat.expectReply('ok')
    expect(errors).toHaveLength(1)
    await bot.stop()
  })

  it('a well-formed event is not reported', async () => {
    const { bot, errors, handled, emit } = await setup()
    emit({ kind: 'message', message: good })
    await expect.poll(() => handled).toEqual(['hi'])
    expect(errors).toEqual([])
    await bot.stop()
  })

  it('an event of an unknown kind (a newer provider) is ignored: no error, nothing routed', async () => {
    const { bot, chat, errors, handled, emit } = await setup()
    emit({ kind: 'future-thing', payload: { x: 1 } })
    await chat.send('hello')
    await chat.expectReply('ok')
    expect(handled).toEqual(['hello'])
    expect(errors).toEqual([])
    await bot.stop()
  })
})
