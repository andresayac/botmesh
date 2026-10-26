import { describe, expect, it } from 'vitest'
import { createTestBot } from '@botmesh/core/testing'
import { DialogflowClient, DialogflowContext, DialogflowError, ServiceAccountTokenSource, dialogflowPlugin, whenDialogflowIntent, type DialogflowPluginConfig } from '../src/index.js'
import { normalizeCxResult, normalizeEsResult, toSessionId } from '../src/internal.js'
import { FakeGoogle, credentials, esResponse, type RecordedRequest } from './fakes.js'

const flush = () => new Promise((r) => setTimeout(r, 20))
const textOf = (req: RecordedRequest) => (JSON.parse(req.body) as { queryInput: { text: { text: string } } }).queryInput.text.text

async function setup(extra: Partial<DialogflowPluginConfig> = {}) {
  const google = new FakeGoogle()
  google.detect = (req) => ({ json: esResponse(textOf(req) === 'hola' ? 'greeting' : 'Default Fallback Intent', {}, { fallback: textOf(req) !== 'hola' }) })
  const t = await createTestBot()
  t.bot.plug(dialogflowPlugin({ credentials, http: google.http, ...extra }))
  const df = t.bot.injectTools.dialogflow!
  return { ...t, google, df }
}

describe('token invalidation on 401', () => {
  it('drops the cached token and retries once with a fresh one', async () => {
    const google = new FakeGoogle()
    let n = 0
    google.detect = (req) => {
      n++
      if (req.headers.authorization === 'Bearer tok-1') return { status: 401, json: { error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED' } } }
      return { json: esResponse('greeting') }
    }
    const client = new DialogflowClient({ credentials, http: google.http })
    const r = await client.detectIntent('s', 'hola')
    expect(r.intent).toBe('greeting')
    expect(n).toBe(2)
    expect(google.tokenCalls).toBe(2)
  })

  it('a second 401 surfaces as UNAUTHENTICATED without looping', async () => {
    const google = new FakeGoogle()
    google.detect = () => ({ status: 401, json: { error: { code: 401, message: 'nope', status: 'UNAUTHENTICATED' } } })
    const client = new DialogflowClient({ credentials, http: google.http })
    await expect(client.detectIntent('s', 'hola')).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' })
    expect(google.detectRequests()).toHaveLength(2)
  })

  it('ServiceAccountTokenSource.invalidate() forces a refresh', async () => {
    const google = new FakeGoogle()
    const source = new ServiceAccountTokenSource(credentials, google.http)
    expect(await source.getAccessToken()).toBe('tok-1')
    source.invalidate()
    expect(await source.getAccessToken()).toBe('tok-2')
  })

  it('a token source that yields no token fails with a clear error', async () => {
    const google = new FakeGoogle()
    const client = new DialogflowClient({ projectId: 'p', tokenSource: { getAccessToken: async () => '' }, http: google.http })
    await expect(client.detectIntent('s', 'hola')).rejects.toMatchObject({ name: 'DialogflowError', code: 'INVALID_TOKEN' })
    expect(google.detectRequests()).toHaveLength(0)
  })
})

describe('oversized and unicode input', () => {
  it('does not send texts longer than maxTextLength (default 256 code points)', async () => {
    const { bot, chat, google } = await setup()
    bot.onMessage((ctx) => ctx.reply('fallback'))
    await chat.send('x'.repeat(257))
    await chat.expectReply('fallback')
    await chat.send('😀'.repeat(256)) // 512 UTF-16 units, 256 code points
    await chat.expectReply('fallback')
    expect(google.detectRequests().map((r) => [...textOf(r)].length)).toEqual([256])
    await bot.stop()
  })

  it('maxTextLength is configurable and validated', async () => {
    const { bot, chat, google } = await setup({ maxTextLength: 5 })
    await chat.send('hola')
    await chat.send('holaaa')
    await flush()
    expect(google.detectRequests().map(textOf)).toEqual(['hola'])
    await bot.stop()
    const t = await createTestBot()
    expect(() => t.bot.plug(dialogflowPlugin({ credentials, maxTextLength: 0 }))).toThrow(/maxTextLength/)
    await t.bot.stop()
  })
})

describe('user callbacks that throw', () => {
  it('a throwing filter is reported and the message still reaches other handlers', async () => {
    const errors: unknown[] = []
    const { bot, chat, google } = await setup({ filter: () => { throw new Error('bad filter') }, onError: (e) => errors.push(e) })
    bot.onMessage((ctx) => ctx.reply('sigo vivo'))
    await chat.send('hola')
    await chat.expectReply('sigo vivo')
    expect(errors).toHaveLength(1)
    expect(google.detectRequests()).toHaveLength(0)
    await bot.stop()
  })
})

describe('config validation (clear errors at plug time)', () => {
  const cases: Array<[string, Partial<DialogflowPluginConfig>, RegExp]> = [
    ['minConfidence as a percentage', { minConfidence: 80 }, /minConfidence must be a number between 0 and 1/],
    ['unknown fulfillment mode', { fulfillment: 'yes' as never }, /fulfillment must be 'off', 'unrouted' or 'all'/],
    ['empty commandPrefix', { commandPrefix: '' }, /commandPrefix/],
    ['unknown sessionScope', { sessionScope: 'user' as never }, /sessionScope must be 'chat' or 'participant'/],
    ['ES location with spaces', { location: 'us central1' }, /location/],
    ['CX location with a slash', { cx: { agentId: 'a', location: 'us-central1/x' } }, /cx\.location/],
  ]
  for (const [label, extra, re] of cases) {
    it(label, async () => {
      const { bot } = await createTestBot()
      let error: unknown
      try { bot.plug(dialogflowPlugin({ credentials, ...extra })) } catch (e) { error = e }
      expect(error).toBeInstanceOf(DialogflowError)
      expect((error as DialogflowError).code).toBe('INVALID_CONFIG')
      expect((error as Error).message).toMatch(re)
      await bot.stop()
    })
  }

  it('credentials passed as a JSON string point at JSON.parse', () => {
    expect(() => new DialogflowClient({ credentials: JSON.stringify(credentials) as never })).toThrow(/JSON\.parse/)
  })

  it('DialogflowContext validates minConfidence too', () => {
    expect(() => new DialogflowContext({ credentials }, { minConfidence: Number.NaN })).toThrow(/minConfidence/)
    const df = new DialogflowContext({ credentials })
    expect(() => whenDialogflowIntent({ when: () => () => {} }, df, 'x', () => {}, { minConfidence: 1.5 })).toThrow(/minConfidence/)
  })
})

describe('sessions in groups', () => {
  it('default to one Dialogflow session per participant (like conversations)', async () => {
    const { bot, provider, google } = await setup()
    provider.incoming('hola', { from: 'g1', sender: 'u1', isGroup: true })
    provider.incoming('hola', { from: 'g1', sender: 'u2', isGroup: true })
    provider.incoming('hola', { from: 'dm1', sender: 'dm1' })
    await flush()
    const urls = google.detectRequests().map((r) => r.url)
    expect(new Set(urls).size).toBe(3)
    expect(urls.some((u) => u.includes(`/sessions/${toSessionId('dm1')}:`))).toBe(true)
    expect(urls.some((u) => u.includes(`/sessions/${toSessionId('g1\u0000u1')}:`))).toBe(true)
    expect(urls.some((u) => u.includes(`/sessions/${toSessionId('g1')}:`))).toBe(false)
    await bot.stop()

    const s2 = await setup({ sessionScope: 'chat' })
    s2.provider.incoming('hola', { from: 'g1', sender: 'u1', isGroup: true })
    s2.provider.incoming('hola', { from: 'g1', sender: 'u2', isGroup: true })
    await flush()
    const [x, y] = s2.google.detectRequests().map((r) => r.url)
    expect(x).toBe(y)
    expect(x).toContain(`/sessions/${toSessionId('g1')}:detectIntent`)
    await s2.bot.stop()
  })
})

describe('ES platform-specific responses', () => {
  it('keeps only the default-platform texts when the agent also has platform responses', () => {
    const r = normalizeEsResult({
      intent: { displayName: 'greeting' },
      fulfillmentMessages: [
        { text: { text: ['Hola'] } },
        { platform: 'TELEGRAM', text: { text: ['Hola Telegram'] } },
        { platform: 'PLATFORM_UNSPECIFIED', text: { text: ['¿En qué ayudo?'] } },
      ],
    })
    expect(r.messages).toEqual(['Hola', '¿En qué ayudo?'])
  })

  it('falls back to the platform texts when there is no default one', () => {
    const r = normalizeEsResult({ intent: { displayName: 'g' }, fulfillmentMessages: [{ platform: 'FACEBOOK', text: { text: ['Hi FB'] } }] })
    expect(r.messages).toEqual(['Hi FB'])
  })
})

describe('normalizers — seeded fuzzing', () => {
  function rng(seed: number) {
    let s = seed >>> 0
    return () => {
      s = (s + 0x6d2b79f5) >>> 0
      let t = s
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  const KEYS = ['intent', 'match', 'parameters', 'fulfillmentText', 'fulfillmentMessages', 'responseMessages', 'text', 'displayName', 'name', 'isFallback', 'matchType', 'confidence', 'intentDetectionConfidence', 'currentPage', 'action', 'allRequiredParamsPresent', '__proto__', 'constructor', 'platform']
  function value(r: () => number, depth: number): unknown {
    const k = Math.floor(r() * 9)
    if (depth > 4 || k < 2) return [null, true, 0, -1, Number.NaN, 1e309, 'NO_MATCH', '💥\u0000', ''][Math.floor(r() * 9)]
    if (k < 4) return Array.from({ length: Math.floor(r() * 4) }, () => value(r, depth + 1))
    const o: Record<string, unknown> = {}
    for (let i = Math.floor(r() * 5); i > 0; i--) o[KEYS[Math.floor(r() * KEYS.length)]] = value(r, depth + 1)
    return JSON.parse(JSON.stringify(o)) as unknown // own "__proto__" keys, like a parsed response
  }

  it('never throws and always returns a well-typed result', () => {
    const r = rng(20261026)
    for (let i = 0; i < 3000; i++) {
      const input = value(r, 0)
      for (const out of [normalizeEsResult(input), normalizeCxResult(input)]) {
        expect(out.intent === null || typeof out.intent === 'string').toBe(true)
        expect(Number.isFinite(out.confidence)).toBe(true)
        expect(typeof out.isFallback).toBe('boolean')
        expect(Array.isArray(out.messages) && out.messages.every((m) => typeof m === 'string')).toBe(true)
        expect(typeof out.fulfillmentText).toBe('string')
        expect(Object.getPrototypeOf(out.parameters)).toBe(Object.prototype)
        expect(Object.hasOwn(out.parameters, '__proto__')).toBe(false)
        expect(Object.hasOwn(out.parameters, 'constructor')).toBe(false)
      }
    }
  })
})

describe('lifecycle', () => {
  it('keeps working across stop/start cycles and leaves no timers behind', async () => {
    const before = new Set(process.getActiveResourcesInfo())
    const { bot, chat, google, df } = await setup()
    whenDialogflowIntent(bot, df, 'greeting', (ctx) => ctx.reply('saludo'))
    for (let i = 0; i < 3; i++) {
      await chat.send('hola')
      await chat.expectReply('saludo')
      await bot.stop()
      await bot.start()
    }
    await bot.stop()
    expect(google.tokenCalls).toBe(1)
    await flush()
    const leaked = process.getActiveResourcesInfo().filter((x) => !before.has(x) && x !== 'Timeout')
    expect(leaked).toEqual([])
  })

  it('a hung detectIntent times out (http.timeoutMs), is reported and does not block the chat', async () => {
    const errors: unknown[] = []
    const google = new FakeGoogle()
    const hung = new FakeGoogle()
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes(':detectIntent')) return new Promise<Response>(() => {})
      return hung.fetch(input, init)
    }) as typeof globalThis.fetch
    void google
    const { bot, chat } = await createTestBot()
    bot.plug(dialogflowPlugin({ credentials, http: { fetch, resolver: async () => ['142.250.0.10'], timeoutMs: 100 }, onError: (e) => errors.push(e) }))
    bot.onMessage((ctx) => ctx.reply('sigo vivo'))
    await chat.send('hola')
    await chat.expectReply('sigo vivo')
    expect(errors).toHaveLength(1)
    expect((errors[0] as { code?: string }).code).toBe('TIMEOUT')
    await bot.stop()
  })
})

describe('more user mistakes', () => {
  it('whenDialogflowIntent rejects an empty intent name or list', () => {
    const df = new DialogflowContext({ credentials })
    const bot = { when: () => () => {} }
    expect(() => whenDialogflowIntent(bot, df, '', () => {})).toThrow(/non-empty/)
    expect(() => whenDialogflowIntent(bot, df, [], () => {})).toThrow(/non-empty/)
  })

  it('a custom tokenSource without invalidate() is not retried on 401', async () => {
    const google = new FakeGoogle()
    google.detect = () => ({ status: 401, json: { error: { message: 'expired', status: 'UNAUTHENTICATED' } } })
    const client = new DialogflowClient({ projectId: 'p', tokenSource: { getAccessToken: async () => 'static' }, http: google.http })
    await expect(client.detectIntent('s', 'hola')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    expect(google.detectRequests()).toHaveLength(1)
  })

  it('a stale 401 does not discard a newer token (invalidate(token))', async () => {
    const google = new FakeGoogle()
    const source = new ServiceAccountTokenSource(credentials, google.http)
    expect(await source.getAccessToken()).toBe('tok-1')
    source.invalidate('tok-1')
    expect(await source.getAccessToken()).toBe('tok-2')
    source.invalidate('tok-1')
    expect(await source.getAccessToken()).toBe('tok-2')
    expect(google.tokenCalls).toBe(2)
  })
})
