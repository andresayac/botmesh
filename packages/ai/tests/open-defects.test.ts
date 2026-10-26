/**
 * Low-severity defects left open by the alpha exit review (docs/release-readiness.md).
 */
import { describe, it, expect, vi } from 'vitest'
import { MemoryStore } from '@botmesh/core'

vi.mock('openai', () => ({
  default: class {
    constructor(readonly opts: { apiKey?: string; baseURL?: string }) {}
    chat = { completions: { create: async () => ({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }) } }
  },
}))

import { aiPlugin } from '../src/plugin.js'
import { AIClient } from '../src/AIClient.js'
import { ContextManager } from '../src/ContextManager.js'
import { toGeminiSchema } from '../src/providers/gemini.js'
import { resolveProvider } from '../src/providers/resolve.js'
import { argLines } from '../src/tools/present.js'
import type { AIProvider } from '../src/types.js'

describe('toGeminiSchema: nested schema keywords', () => {
  it('maps a nullable property (zod .nullable(): anyOf with null) to nullable: true', () => {
    expect(toGeminiSchema({
      type: 'object',
      properties: { note: { anyOf: [{ type: 'string', default: 'x' }, { type: 'null' }] } },
    })).toEqual({ type: 'object', properties: { note: { type: 'string', nullable: true } } })
  })

  it('maps a type array with "null" to the type plus nullable: true', () => {
    expect(toGeminiSchema({ type: ['integer', 'null'] })).toEqual({ type: 'integer', nullable: true })
  })

  it('recurses into anyOf / oneOf (as anyOf) and merges a single allOf', () => {
    expect(toGeminiSchema({
      oneOf: [
        { type: 'object', additionalProperties: false, properties: { a: { type: 'string', $ref: '#/x' } } },
        { type: 'number', const: 3 },
      ],
    })).toEqual({ anyOf: [{ type: 'object', properties: { a: { type: 'string' } } }, { type: 'number' }] })
    expect(toGeminiSchema({ allOf: [{ type: 'string', examples: ['a'] }], description: 'd' })).toEqual({ type: 'string', description: 'd' })
  })

  it('a nullable union of several types keeps the anyOf and marks it nullable', () => {
    expect(toGeminiSchema({ anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }] }))
      .toEqual({ anyOf: [{ type: 'string' }, { type: 'number' }], nullable: true })
  })
})

describe('openai with a custom baseUrl', () => {
  const field = (p: AIProvider) => (p as unknown as { maxTokensField: string }).maxTokensField

  it('sends max_tokens to an OpenAI-compatible server (vLLM, LM Studio, a gateway)', async () => {
    expect(field(await resolveProvider({ provider: 'openai', model: 'm', baseUrl: 'http://127.0.0.1:8000/v1' }))).toBe('max_tokens')
  })

  it('keeps max_completion_tokens for OpenAI itself and Azure OpenAI', async () => {
    expect(field(await resolveProvider({ provider: 'openai', model: 'm' }))).toBe('max_completion_tokens')
    expect(field(await resolveProvider({ provider: 'openai', model: 'm', baseUrl: 'https://api.openai.com/v1' }))).toBe('max_completion_tokens')
    expect(field(await resolveProvider({ provider: 'openai', model: 'm', baseUrl: 'https://acme.openai.azure.com/openai/v1' }))).toBe('max_completion_tokens')
  })

  it('maxTokensField overrides the guess (also for presets)', async () => {
    expect(field(await resolveProvider({ provider: 'openai', model: 'm', baseUrl: 'http://127.0.0.1:8000/v1', maxTokensField: 'max_completion_tokens' }))).toBe('max_completion_tokens')
    expect(field(await resolveProvider({ provider: 'groq', apiKey: 'k', maxTokensField: 'max_completion_tokens' }))).toBe('max_completion_tokens')
  })

  it('aiPlugin rejects an unknown maxTokensField', () => {
    expect(() => aiPlugin({ maxTokensField: 'tokens' as never })).toThrow(/maxTokensField/)
  })
})

describe('memory options are validated by aiPlugin()', () => {
  const bad: Array<[string, object, RegExp]> = [
    ['maxFactLength 0', { maxFactLength: 0 }, /memory\.maxFactLength/],
    ['maxFactLength NaN', { maxFactLength: Number.NaN }, /memory\.maxFactLength/],
    ['maxFactLength 2.5', { maxFactLength: 2.5 }, /memory\.maxFactLength/],
    ['maxFacts 0', { maxFacts: 0 }, /memory\.maxFacts/],
    ['ttl unparsable', { ttl: 'un mes' }, /memory\.ttl/],
    ['ttl negative', { ttl: -5 }, /memory\.ttl/],
  ]
  for (const [name, memory, msg] of bad) {
    it(`rejects ${name} when the plugin is built, not at plug()`, () => {
      expect(() => aiPlugin({ memory })).toThrow(msg)
    })
  }
  it('accepts the documented values', () => {
    expect(() => aiPlugin({ memory: { maxFactLength: 120, maxFacts: 10, ttl: '30d' } })).not.toThrow()
    expect(() => aiPlugin({ memory: true })).not.toThrow()
  })
})

describe('confirmation prompt: argument names stay on one visible line', () => {
  it('turns NEL / line and paragraph separators into spaces and drops bidi controls', () => {
    const c = (...cps: number[]) => String.fromCodePoint(...cps)
    const lines = argLines({ ['a' + c(0x85) + '¿Confirmas?' + c(0x2028) + 'b']: 1, ['x' + c(0x202e) + 'evil' + c(0x202c) + 'y' + c(0x2066) + 'z' + c(0x2069)]: 2 })
    const forbidden = new RegExp('[' + c(0x85, 0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x200e, 0x200f, 0x61c) + ']')
    for (const line of lines) {
      expect(line).not.toMatch(forbidden)
    }
    expect(lines).toHaveLength(2)
  })
})

describe('a caller abort releases the caller even when the provider ignores the signal', () => {
  it('ask() rejects with AbortError after signal.abort() (timeoutMs: 0)', async () => {
    const deaf: AIProvider = { name: 'deaf', generate: () => new Promise(() => {}), async *stream() { yield '' } }
    const client = new AIClient(deaf, new ContextManager(new MemoryStore({})), { timeoutMs: 0 })
    const ctrl = new AbortController()
    const p = client.ask('x', { signal: ctrl.signal })
    ctrl.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('replyInChat() rejects too (a /reset of the autoreply turn)', async () => {
    const deaf: AIProvider = { name: 'deaf', generate: () => new Promise(() => {}), async *stream() { yield '' } }
    const client = new AIClient(deaf, new ContextManager(new MemoryStore({})), { timeoutMs: 0 })
    const ctrl = new AbortController()
    const p = client.replyInChat('k', 'x', { signal: ctrl.signal })
    setTimeout(() => ctrl.abort(), 5)
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })
})
