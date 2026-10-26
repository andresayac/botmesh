/**
 * Error quality: every user mistake in the configuration fails fast with a clear,
 * actionable message (at `aiPlugin()` / `plug()` time, not on the first message), and
 * the provider errors a user can hit read in English and say how to fix them.
 */
import { describe, it, expect } from 'vitest'
import { createTestBot } from '@botmesh/core/testing'
import { aiPlugin } from '../src/plugin.js'
import { MockAIProvider } from '../src/MockAIProvider.js'
import { resolveProvider } from '../src/providers/resolve.js'
import { OpenAIProvider, type OpenAILike } from '../src/providers/openai.js'
import { OllamaProvider } from '../src/providers/ollama.js'
import { loadModule } from '../src/providers/loadModule.js'
import type { AIPluginConfig } from '../src/plugin.js'

describe('aiPlugin config validation', () => {
  const bad: Array<[string, AIPluginConfig, RegExp]> = [
    ['timeoutMs NaN (e.g. Number(undefined env))', { timeoutMs: Number.NaN }, /timeoutMs/],
    ['timeoutMs above the timer limit', { timeoutMs: 2 ** 31 }, /timeoutMs.*24 days/],
    ['toolTimeoutMs Infinity', { toolTimeoutMs: Number.POSITIVE_INFINITY }, /toolTimeoutMs/],
    ['maxSteps NaN', { maxSteps: Number.NaN }, /maxSteps/],
    ['maxSteps Infinity', { maxSteps: Number.POSITIVE_INFINITY }, /maxSteps/],
    ['maxTokens 0', { maxTokens: 0 }, /maxTokens/],
    ['maxTokens string', { maxTokens: '1000' as unknown as number }, /maxTokens/],
    ['context.maxMessages NaN', { context: { maxMessages: Number.NaN } }, /context\.maxMessages/],
    ['context.maxMessages negative', { context: { maxMessages: -2 } }, /context\.maxMessages/],
    ['a tool timeoutMs NaN', { tools: { t: { description: 'd', handler: () => 0, timeoutMs: Number.NaN } } }, /tools\.t\.timeoutMs/],
    ['a tool dedupe window NaN', { tools: { t: { description: 'd', handler: () => 0, dedupe: { windowMs: Number.NaN } } } }, /tools\.t\.dedupe\.windowMs/],
    ['a tool without handler', { tools: { t: { description: 'd' } as never } }, /tools\.t.*handler/],
    ['toolConfirm.timeout unparsable', { toolConfirm: { timeout: 'dos minutos' } }, /toolConfirm\.timeout/],
    ['toolConfirm.timeout NaN', { toolConfirm: { timeout: Number.NaN } }, /toolConfirm\.timeout/],
    ['rag.timeoutMs NaN', { rag: { retriever: { retrieve: async () => [] }, timeoutMs: Number.NaN } }, /rag\.timeoutMs/],
  ]
  for (const [name, cfg, msg] of bad) {
    it(`rejects ${name} with a RangeError/TypeError naming the option`, () => {
      expect(() => aiPlugin(cfg)).toThrow(msg)
    })
  }

  it('accepts the documented values (0 disables the timeouts; 0 messages keeps no history)', () => {
    expect(() => aiPlugin({ timeoutMs: 0, toolTimeoutMs: 0, maxSteps: 1, maxTokens: 1, context: { maxMessages: 0 } })).not.toThrow()
    // Values that always worked keep working: a negative timeout disables it, maxSteps < 1 means 1.
    expect(() => aiPlugin({ timeoutMs: -1, maxSteps: 0 })).not.toThrow()
    expect(() => aiPlugin({ tools: { t: { description: 'd', handler: () => 0, timeoutMs: 0, dedupe: { windowMs: 0 } } } })).not.toThrow()
  })

  it('a config given at plug() time is validated too (and the plug is reverted)', async () => {
    const { bot } = await createTestBot()
    expect(() => bot.plug(aiPlugin(), { maxSteps: Number.NaN })).toThrow(/maxSteps/)
    expect('ai' in bot.injectTools).toBe(false)
    await bot.stop()
  })
})

describe('provider error messages', () => {
  it('unknown provider names the valid ones, in English', async () => {
    await expect(resolveProvider({ provider: 'opneai' as never })).rejects.toThrow(/Unknown AI provider "opneai".*anthropic, openai, ollama, gemini/)
  })

  it('a missing SDK says which package to install', async () => {
    await expect(loadModule('this-sdk-is-not-installed', 'pnpm add this-sdk-is-not-installed'))
      .rejects.toThrow(/needs the package "this-sdk-is-not-installed".*not installed.*pnpm add this-sdk-is-not-installed/)
  })

  it('openai / ollama without a model explain how to set it', async () => {
    const client: OpenAILike = { chat: { completions: { create: async () => ({ choices: [], model: 'x' }) } } }
    await expect(new OpenAIProvider(client, {}).generate({ messages: [{ role: 'user', content: 'x' }] }))
      .rejects.toThrow(/openai.*needs a `model`.*aiPlugin\(\{ model/)
    await expect(new OllamaProvider({}, (async () => new Response('{}')) as unknown as typeof fetch).generate({ messages: [{ role: 'user', content: 'x' }] }))
      .rejects.toThrow(/ollama.*needs a `model`.*aiPlugin\(\{ model/)
  })

  it('warns at install when openai / ollama are configured without a model', async () => {
    const warnings: string[] = []
    const logger = {
      debug: () => {}, info: () => {}, error: () => {},
      warn: (a: unknown, b?: unknown) => { warnings.push(typeof a === 'string' ? a : String(b)) },
      child() { return logger },
    }
    const { bot } = await createTestBot({ logger })
    bot.plug(aiPlugin({ provider: 'ollama' }))
    expect(warnings.some((w) => /ollama.*model/.test(w))).toBe(true)
    await bot.stop()
  })

  it('an injected instance does not warn about a missing model', async () => {
    const warnings: string[] = []
    const logger = {
      debug: () => {}, info: () => {}, error: () => {},
      warn: (a: unknown, b?: unknown) => { warnings.push(typeof a === 'string' ? a : String(b)) },
      child() { return logger },
    }
    const { bot } = await createTestBot({ logger })
    bot.plug(aiPlugin({ provider: 'openai', instance: new MockAIProvider() }))
    expect(warnings).toEqual([])
    await bot.stop()
  })
})
