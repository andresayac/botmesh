/**
 * Presence hints while the transport is disconnected (IProvider contract, "PRESENCE WHILE
 * DISCONNECTED"): `ctx.typing()`, `ctx.recording()`, `ctx.markRead()` and the automatic
 * typing indicator are best-effort. While the provider's last connection update is not
 * `'ready'`, the bot does not call the provider: the hint resolves, is logged at debug and
 * counted in `metrics().presenceSkipped`. Before any connection update (a provider that never
 * reports one) the calls go through as before.
 */
import { describe, it, expect, vi } from 'vitest'
import { Writable } from 'node:stream'
import pino from 'pino'
import { Bot, toPrometheus, type MessageContext } from '../src/index.js'
import { MockProvider } from '../src/testing/MockProvider.js'
import type { ChatId, IProvider, MessageRef } from '../src/core/provider.js'

function capture() {
  const lines: Array<Record<string, unknown>> = []
  const stream = new Writable({ write(chunk, _enc, cb) { lines.push(JSON.parse(String(chunk))); cb() } })
  return { lines, logger: pino({ level: 'debug' }, stream) }
}

function make(typing?: { enabled: boolean; minMs: number; maxMs: number }) {
  const provider = new MockProvider()
  const typingCalls: Array<[ChatId, string | undefined]> = []
  const readCalls: MessageRef[][] = []
  ;(provider as IProvider).typing = async (chatId, state) => { typingCalls.push([chatId, state]) }
  ;(provider as IProvider).markRead = async (refs) => { readCalls.push(refs) }
  const { lines, logger } = capture()
  const bot = new Bot({ provider, logger, ...(typing ? { typing } : {}) })
  const connection = (state: 'ready' | 'closed' | 'connecting') =>
    (provider as unknown as { emitEvent(e: unknown): void }).emitEvent({ kind: 'connection', update: { state } })
  return { bot, provider, typingCalls, readCalls, lines, connection }
}

describe('presence hints while the transport is disconnected', () => {
  it('ctx.typing / ctx.markRead are skipped (no provider call, no throw), logged at debug and counted', async () => {
    const { bot, provider, typingCalls, readCalls, lines, connection } = make()
    let ctxRef: MessageContext | undefined
    bot.when('hola', (ctx) => { ctxRef = ctx })
    await bot.start()
    provider.incoming('hola', { from: 'u1' })
    await vi.waitFor(() => expect(ctxRef).toBeDefined())
    const ctx = ctxRef!

    connection('closed')
    await expect(ctx.typing()).resolves.toBeUndefined()
    await expect(ctx.recording()).resolves.toBeUndefined()
    await expect(ctx.markRead()).resolves.toBeUndefined()
    expect(typingCalls).toEqual([])
    expect(readCalls).toEqual([])
    expect(bot.metrics().presenceSkipped).toEqual({ typing: 2, markRead: 1 })
    const skipped = lines.filter((l) => l.msg === 'presence hint skipped: transport not connected')
    expect(skipped.map((l) => [l.level, l.kind, l.connection])).toEqual([
      [20, 'typing', 'closed'], [20, 'typing', 'closed'], [20, 'markRead', 'closed'],
    ])
    // Chat ids follow the logIds policy (hashed). Compare whole values: a random hash can
    // contain the two characters "u1" as a substring.
    expect(ctx.chat.id).toBe('u1')
    for (const l of skipped) expect(l.chatId).not.toBe(ctx.chat.id)
    expect(JSON.stringify(skipped)).not.toContain(JSON.stringify(ctx.chat.id))

    connection('connecting')
    await ctx.typing()
    expect(typingCalls).toEqual([])

    connection('ready')
    await ctx.typing()
    await ctx.markRead()
    expect(typingCalls).toHaveLength(1)
    expect(readCalls).toHaveLength(1)
    expect(bot.metrics().presenceSkipped).toEqual({ typing: 3, markRead: 1 })
    expect(toPrometheus(bot.metrics())).toContain('botmesh_presence_skipped_total{kind="typing"} 3')
    bot.resetMetrics()
    expect(bot.metrics().presenceSkipped).toEqual({ typing: 0, markRead: 0 })
    await bot.stop()
  })

  it('the automatic typing indicator of a paced reply is skipped too; the reply still goes out', async () => {
    const { bot, provider, typingCalls, connection } = make({ enabled: true, minMs: 5, maxMs: 5 })
    bot.when('hola', async (ctx) => { await ctx.reply('hi there') })
    await bot.start()
    connection('closed')
    provider.incoming('hola', { from: 'u1' })
    await vi.waitFor(() => expect(provider.outbox).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 10))
    expect(typingCalls).toEqual([])
    expect(bot.metrics().presenceSkipped.typing).toBeGreaterThan(0)
    await bot.stop()
  })

  it('a provider that never reports its connection is not gated', async () => {
    const provider = new MockProvider()
    provider.start = async () => {}   // no 'ready' event
    const typingCalls: string[] = []
    ;(provider as IProvider).typing = async (chatId) => { typingCalls.push(chatId) }
    const bot = new Bot({ provider })
    let ctxRef: MessageContext | undefined
    bot.when('hola', (ctx) => { ctxRef = ctx })
    await bot.start()
    provider.incoming('hola', { from: 'u1' })
    await vi.waitFor(() => expect(ctxRef).toBeDefined())
    await ctxRef!.typing()
    expect(typingCalls).toEqual(['u1'])
    expect(bot.metrics().presenceSkipped).toEqual({ typing: 0, markRead: 0 })
    await bot.stop()
  })
})
