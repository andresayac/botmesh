// A stopped provider must not acknowledge webhooks with 200: the message would be lost.
import { describe, expect, it, vi } from 'vitest'
import { Bot, type LoggerLike } from '@botmesh/core'
import { MessengerProvider } from '../src/MessengerProvider.js'

const silent = { trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return silent } } as unknown as LoggerLike
const cfg = { accessToken: 'TOK', verifyToken: 'vt', allowUnsignedWebhooks: true, logger: silent }

describe('stop', () => {
  it('ingest answers 503 while stopped (Meta redelivers) and 200 again after start', async () => {
    const p = new MessengerProvider(cfg)
    const bot = new Bot({ provider: p, logger: silent })
    const seen: string[] = []
    bot.onMessage((ctx) => { seen.push(ctx.body) })
    const hook = (t: string, id: string) => p.ingest({ object: 'page', entry: [{ messaging: [{ sender: { id: 'U' }, recipient: { id: 'P' }, timestamp: Date.now(), message: { mid: id, text: t } }] }] })
    await bot.start()
    expect(hook('a', 'x1')).toBe(200)
    await vi.waitFor(() => expect(seen).toEqual(['a']))
    await bot.stop()
    expect(hook('b', 'x2')).toBe(503)
    await bot.start()
    expect(hook('c', 'x3')).toBe(200)
    await vi.waitFor(() => expect(seen).toEqual(['a', 'c']))
    await bot.stop()
  })
})
