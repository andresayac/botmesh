/**
 * The bot's own logs never carry raw chat or sender ids (phone numbers, emails…): they go
 * through the ids policy — hashed by default (HMAC, stable within the process, the same
 * hashes as the trace spans when tracing is on). `BotConfig.logIds: 'raw'` restores them
 * for local debugging, `'omit'` drops them.
 */
import { describe, it, expect, vi } from 'vitest'

import type { BotConfig } from '../src/index.js'
import { createRecordingTracer, createTestBot } from '../src/testing/index.js'

const SECRET = '573001234567@s.whatsapp.net'

function capture() {
  const lines: unknown[] = []
  const log = (level: string) => vi.fn((...args: unknown[]) => { lines.push([level, ...args]) })
  const logger = { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error'), trace: log('trace'), fatal: log('fatal'), child: () => logger, level: 'debug' }
  return { logger, text: () => JSON.stringify(lines) }
}

async function exercise(config: Omit<BotConfig, 'provider'>) {
  const { logger, text } = capture()
  const { bot, chat, dm, provider } = await createTestBot({ ...config, logger: logger as never })
  ;(provider as unknown as { typing: () => Promise<void> }).typing = async () => { throw new Error('typing down') }
  bot.when('hi', async (ctx) => { await ctx.typing(); await ctx.reply('hello') })
  const user = dm(SECRET)
  await user.send('hi')
  await user.expectReply('hello')
  bot.blacklist.add(SECRET)
  await user.send('hi')
  bot.blacklist.remove(SECRET)
  await bot.handoff(SECRET)
  await user.send('hi')
  await chat.send('hi')
  await chat.expectReply('hello')
  await bot.stop()
  return text()
}

describe('ids in logs', () => {
  it('debug logs carry hashed ids by default', async () => {
    const out = await exercise({ debug: true })
    expect(out).toContain('dispatching message')
    expect(out).toContain('inbound dropped by access list')
    expect(out).not.toContain(SECRET)
    expect(out).not.toContain('573001234567')
  })

  it("logIds: 'raw' keeps them (local debugging)", async () => {
    const out = await exercise({ debug: true, logIds: 'raw' })
    expect(out).toContain(SECRET)
  })

  it("logIds: 'omit' drops them", async () => {
    const out = await exercise({ debug: true, logIds: 'omit' })
    expect(out).toContain('dispatching message')
    expect(out).not.toContain(SECRET)
  })

  it("telemetry ids: 'raw' does not leak raw ids into the logs (logs keep hashing by default)", async () => {
    const out = await exercise({ debug: true, telemetry: { tracer: createRecordingTracer().tracer, ids: 'raw' } })
    expect(out).toContain('dispatching message')
    expect(out).not.toContain(SECRET)
  })

  it('rejects an unknown policy', async () => {
    await expect(createTestBot({ logIds: 'plain' as never })).rejects.toThrow(/logIds/)
  })
})
