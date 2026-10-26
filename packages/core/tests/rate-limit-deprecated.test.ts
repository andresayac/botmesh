/** `BotConfig.rateLimit` never did anything in v2: it is deprecated and warns at construction. */
import { describe, expect, it } from 'vitest'
import { Bot, type LoggerLike } from '../src/index.js'
import { MockProvider } from '../src/testing/index.js'

function capture(): LoggerLike & { warns: unknown[][] } {
  const warns: unknown[][] = []
  const noop = () => {}
  const l = { debug: noop, info: noop, error: noop, warn: (...a: unknown[]) => { warns.push(a) }, child: () => l, warns }
  return l
}

const text = (warns: unknown[][]) => warns.map((a) => a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')).join('\n')

describe('BotConfig.rateLimit (deprecated, ignored)', () => {
  it('warns once that it is ignored and names the replacements', async () => {
    const logger = capture()
    const bot = new Bot({ provider: new MockProvider(), logger, rateLimit: { max: 10 } })
    const out = text(logger.warns)
    expect(out).toMatch(/BotConfig\.rateLimit is ignored/)
    expect(out).toMatch(/provider/)
    expect(out).toMatch(/rateLimitRetry/)
    expect(logger.warns.filter((w) => /rateLimit is ignored/.test(text([w])))).toHaveLength(1)
    await bot.stop()
  })

  it('says nothing when rateLimit is not set', async () => {
    const logger = capture()
    const bot = new Bot({ provider: new MockProvider(), logger })
    expect(text(logger.warns)).not.toMatch(/rateLimit is ignored/)
    await bot.stop()
  })
})
