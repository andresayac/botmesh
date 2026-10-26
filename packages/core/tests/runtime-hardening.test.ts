/**
 * Release-readiness hardening of the core runtime: user mistakes that used to be silent
 * (or crash with an unrelated message) now fail fast with an actionable error, and the
 * engine's own error logs keep the error when the logger is pino (object first).
 */
import { describe, expect, it } from 'vitest'

import { Bot } from '../src/core/Bot.js'
import { flow } from '../src/flows/FlowBuilder.js'
import { Scheduler } from '../src/scheduler/Scheduler.js'
import { assertCron } from '../src/scheduler/cron.js'
import { parseDuration } from '../src/utils/duration.js'
import { MockProvider } from '../src/testing/MockProvider.js'
import { createTestBot } from '../src/testing/createTestBot.js'

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms))

/** A pino-shaped logger that records every call (pino drops a non-placeholder 2nd argument). */
function recordingLogger() {
  const lines: Array<{ level: string; args: unknown[] }> = []
  const make = (bindings: Record<string, unknown>): any => ({
    level: 'debug',
    child: (b: Record<string, unknown>) => make({ ...bindings, ...b }),
    trace: () => {},
    fatal: () => {},
    debug: (...args: unknown[]) => lines.push({ level: 'debug', args }),
    info: (...args: unknown[]) => lines.push({ level: 'info', args }),
    warn: (...args: unknown[]) => lines.push({ level: 'warn', args }),
    error: (...args: unknown[]) => lines.push({ level: 'error', args }),
  })
  return { logger: make({}), lines }
}

/** pino reads the merge object only from the FIRST argument; the message is the string after it. */
function pinoView(line: { args: unknown[] }): { obj?: Record<string, unknown>; msg?: string } {
  const [first, second] = line.args
  if (typeof first === 'string') return { msg: first }
  return { obj: first as Record<string, unknown>, msg: second as string }
}

describe('engine error logs are pino-shaped (object first, message second)', () => {
  it('a handler error is logged with its err, not dropped as an extra argument', async () => {
    const { logger, lines } = recordingLogger()
    const { bot, chat } = await createTestBot({ logger })
    bot.on('error', () => {})
    const boom = new Error('boom')
    bot.when('x', () => { throw boom })
    await chat.send('x')
    await tick(50)
    const line = lines.find((l) => l.level === 'error' && pinoView(l).msg === 'dispatch error')
    expect(line, JSON.stringify(lines.map((l) => l.args.map(String)))).toBeDefined()
    expect(pinoView(line!).obj?.err).toBe(boom)
    await bot.stop()
  })

  it('a conversation error is logged with its err', async () => {
    const { logger, lines } = recordingLogger()
    const { bot, chat } = await createTestBot({ logger })
    bot.on('error', () => {})
    const boom = new Error('conv boom')
    bot.conversation('c', async () => { throw boom }, { trigger: 'c' })
    await chat.send('c')
    await tick(50)
    const line = lines.find((l) => l.level === 'error' && pinoView(l).msg === 'conversation error')
    expect(line).toBeDefined()
    expect(pinoView(line!).obj?.err).toBe(boom)
    await bot.stop()
  })

  it('no core log call puts a string first and an object after it', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const files = ['../src/core/Dispatcher.ts', '../src/conversations/ConversationRuntime.ts']
    for (const f of files) {
      const src = readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8')
      const bad = src.match(/logger\?*\.(?:error|warn|info|debug)\?*\.?\(\s*(?:['`][^'`]*['`]|failure)\s*,/g)
      expect(bad, f).toBeNull()
    }
  })
})

describe('provider shape is checked when the bot is built', () => {
  it('a class instead of an instance', () => {
    expect(() => new Bot({ provider: MockProvider as any })).toThrow(/instance.*new MockProvider/)
  })
  it('a promise of a provider', () => {
    expect(() => new Bot({ provider: Promise.resolve(new MockProvider()) as any })).toThrow(/Promise.*await/)
  })
  it('an object that is not an IProvider names the missing methods', () => {
    expect(() => new Bot({ provider: {} as any })).toThrow(/start, stop, send, onEvent/)
  })
})

describe('scheduler durations and cron fields are validated', () => {
  it('every() rejects a non-positive or non-finite interval (it used to spin on a 1 ms timer)', () => {
    const bot = new Bot({ provider: new MockProvider() })
    expect(() => bot.every('0s', () => {})).toThrow(RangeError)
    expect(() => bot.every(0, () => {})).toThrow(RangeError)
    expect(() => bot.every(-5, () => {})).toThrow(RangeError)
    expect(() => bot.every(Number.NaN, () => {})).toThrow(RangeError)
    expect(() => bot.every('1s', () => {})).not.toThrow()
  })

  it('delay() rejects a negative or non-finite duration; 0 is allowed', () => {
    const s = new Scheduler()
    expect(() => s.delay(-1, () => {})).toThrow(RangeError)
    expect(() => s.delay(Number.POSITIVE_INFINITY, () => {})).toThrow(RangeError)
    expect(() => s.delay(0, () => {}).cancel()).not.toThrow()
  })

  it('cron fields out of range or with a zero step are rejected (they never fired)', () => {
    for (const bad of ['61 * * * *', '0 24 * * *', '0 9 0 * *', '0 9 32 * *', '0 9 * 13 *', '0 9 * 0 *', '0 9 * * 8', '*/0 * * * *', '5-1 * * * *', '0,60 * * * *']) {
      expect(() => assertCron(bad), bad).toThrow(TypeError)
    }
    for (const ok of ['0 9 * * 1-5', '*/15 * * * *', '0 0 1 1 *', '59 23 31 12 7', '0 9 13 * 5', '5/15 * * * *', '0-30/10 0,12 * * *']) {
      expect(() => assertCron(ok), ok).not.toThrow()
    }
  })

  it('parseDuration names the bad value for a non-string, non-number input', () => {
    expect(() => parseDuration(undefined as any)).toThrow(/Invalid duration: undefined/)
  })
})

describe('triggers that can never be meant are rejected at registration', () => {
  it('undefined / null used to match the literal text "undefined" / "null"', async () => {
    const bot = new Bot({ provider: new MockProvider() })
    expect(() => bot.when(undefined as any, () => {})).toThrow(/Invalid trigger/)
    expect(() => bot.when(null as any, () => {})).toThrow(/Invalid trigger/)
    expect(() => bot.when(['ok', undefined] as any, () => {})).toThrow(/Invalid trigger/)
    expect(() => bot.when({ pattern: undefined } as any, () => {})).toThrow(/Invalid trigger/)
    expect(() => bot.use(flow(undefined as any).say('x'))).toThrow(/Invalid trigger/)
    expect(() => bot.conversation('c', async () => {}, { trigger: [undefined] as any })).toThrow(/Invalid trigger/)
  })

  it('every documented trigger form is still accepted', () => {
    const bot = new Bot({ provider: new MockProvider() })
    expect(() => {
      bot.when('hola', () => {})
      bot.when(/hi/i, () => {})
      bot.when(['a', /b/], () => {})
      bot.when([], () => {})
      bot.when({ pattern: 'x', match: 'contains', scope: 'dm' }, () => {})
      bot.when((ctx) => ctx.body.length > 3, () => {})
      bot.when(1 as any, () => {})
    }).not.toThrow()
  })
})

describe('flow state keys', () => {
  it('"__proto__" as a state key throws when the flow is built (the answer was silently lost)', () => {
    expect(() => flow('x').ask('q', '__proto__' as any)).toThrow(/__proto__/)
    expect(() => flow('x').choose('q', { a: 'A' }, '__proto__' as any)).toThrow(/__proto__/)
  })
})

describe('outbound content is checked before it reaches the provider', () => {
  async function attempt(send: (ctx: any) => Promise<unknown>) {
    const { bot, chat, provider } = await createTestBot()
    let error: unknown
    bot.when('go', async (ctx) => { try { await send(ctx) } catch (e) { error = e } await ctx.reply('end') })
    await chat.send('go')
    await chat.expectReply('end')
    const kinds = provider.outbox.map((o) => o.content.kind)
    await bot.stop()
    return { error: error as Error | undefined, kinds }
  }

  it.each([
    ['reply(undefined)', (ctx: any) => ctx.reply(undefined), /"text" must be a string, got undefined/],
    ['reply(object)', (ctx: any) => ctx.reply({ a: 1 }), /"text" must be a string, got an object/],
    ['photo(undefined)', (ctx: any) => ctx.photo(undefined), /"media" must be/],
    ['location(NaN)', (ctx: any) => ctx.location(Number.NaN, 1), /"lat" must be a number between -90 and 90/],
    ['location(lng 200)', (ctx: any) => ctx.location(1, 200), /"lng" must be a number between -180 and 180/],
    ['poll with no options', (ctx: any) => ctx.poll('q', []), /"options" must be a non-empty array/],
    ['buttons with no buttons', (ctx: any) => ctx.buttons('q', []), /"buttons" must be a non-empty array/],
  ])('%s rejects with a TypeError and sends nothing', async (_name, send, message) => {
    const { error, kinds } = await attempt(send)
    expect(error).toBeInstanceOf(TypeError)
    expect(error?.message).toMatch(message)
    expect(kinds).toEqual(['text'])   // only the final 'end'
  })

  it('valid content still goes out (empty text, Buffer media, edge coordinates, reaction removal)', async () => {
    const { error, kinds } = await attempt(async (ctx) => {
      await ctx.reply('')
      await ctx.photo(Buffer.from('x'))
      await ctx.location(-90, 180)
      await ctx.poll('q', ['a'])
      await ctx.react('')
    })
    expect(error).toBeUndefined()
    expect(kinds).toEqual(['text', 'image', 'location', 'poll', 'reaction', 'text'])
  })

  it('bot.send() is checked too, and a before(send) hook may still fix the content', async () => {
    const { bot } = await createTestBot()
    await expect(bot.send('a@s', { kind: 'text', text: undefined } as any)).rejects.toThrow(TypeError)
    bot.before('send', async (payload, next) => {
      if (payload.content.kind === 'text' && payload.content.text === undefined) payload.content.text = 'fixed'
      await next()
    })
    await expect(bot.send('a@s', { kind: 'text', text: undefined } as any)).resolves.toBeDefined()
    await bot.stop()
  })
})

describe('test kit', () => {
  it('expectReply skips outbox entries without text instead of crashing', async () => {
    const { bot, chat, provider } = await createTestBot()
    bot.when('go', (ctx) => bot.send(ctx.from, { kind: 'card', title: undefined } as any).then(() => {}))
    await chat.send('go')
    await tick(30)
    expect(provider.outbox).toHaveLength(1)
    await expect(chat.expectReply('nope', 50)).rejects.toThrow(/No reply matching/)
    await bot.stop()
  })
})
