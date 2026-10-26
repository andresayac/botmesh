/**
 * The `GenerateInput.onStreamEnd` contract, the same for every built-in provider and for
 * `MockAIProvider`:
 *
 * - called exactly once per `stream()` call, after the last chunk was yielded and before the
 *   iteration completes, with the provider's stop reason (and usage when the provider streams it);
 * - never called when the stream fails, nor when the consumer stops iterating early;
 * - an exception thrown by the callback reaches the consumer's iteration.
 */
import { describe, expect, it } from 'vitest'

import { AnthropicProvider, type AnthropicLike } from '../src/providers/anthropic.js'
import { GeminiProvider, type GeminiLike } from '../src/providers/gemini.js'
import { OllamaProvider } from '../src/providers/ollama.js'
import { OpenAIProvider, type OpenAILike } from '../src/providers/openai.js'
import { MockAIProvider } from '../src/MockAIProvider.js'
import type { AIProvider, AIStreamEndInfo, GenerateInput } from '../src/index.js'

const boom = () => new Error('stream broke')

/** Builds a provider whose stream yields `chunks` and then ends (or throws when `fail`). */
type Factory = (chunks: string[], fail: boolean) => AIProvider

async function* anthropicEvents(chunks: string[], fail: boolean) {
  yield { type: 'message_start', message: { usage: { input_tokens: 4 } } }
  for (const text of chunks) yield { type: 'content_block_delta', delta: { type: 'text_delta', text } }
  if (fail) throw boom()
  yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } }
}

async function* openaiChunks(chunks: string[], fail: boolean) {
  for (const content of chunks) yield { choices: [{ delta: { content } }] }
  if (fail) throw boom()
  yield { choices: [{ delta: {}, finish_reason: 'stop' }] }
}

async function* geminiChunks(chunks: string[], fail: boolean) {
  for (const [i, t] of chunks.entries()) {
    if (fail && i === chunks.length - 1) { yield { text: () => t }; throw boom() }
    yield {
      text: () => t,
      ...(i === chunks.length - 1 ? { candidates: [{ finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 } } : {}),
    }
  }
}

function ollamaFetch(chunks: string[], fail: boolean): typeof fetch {
  return async () => {
    const enc = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(ctrl) {
        for (const content of chunks) ctrl.enqueue(enc.encode(JSON.stringify({ message: { content } }) + '\n'))
        if (fail) ctrl.enqueue(enc.encode(JSON.stringify({ error: 'model crashed' }) + '\n'))
        else ctrl.enqueue(enc.encode(JSON.stringify({ done: true, done_reason: 'stop' }) + '\n'))
        ctrl.close()
      },
    })
    return new Response(body, { status: 200 })
  }
}

const providers: Array<[string, Factory, string]> = [
  ['anthropic', (c, f) => {
    const client: AnthropicLike = {
      messages: {
        create: async () => ({ content: [], model: 'm' }),
        stream: () => anthropicEvents(c, f),
      },
    }
    return new AnthropicProvider(client, { model: 'claude-test' })
  }, 'end_turn'],
  ['openai', (c, f) => {
    const client: OpenAILike = { chat: { completions: { create: async () => openaiChunks(c, f) } } }
    return new OpenAIProvider(client, { model: 'gpt-test' })
  }, 'stop'],
  ['gemini', (c, f) => {
    const client: GeminiLike = {
      getGenerativeModel: () => ({
        generateContent: async () => ({ response: { text: () => '' } }),
        generateContentStream: async () => ({ stream: geminiChunks(c, f) }),
      }),
    }
    return new GeminiProvider(client, { model: 'gemini-test' })
  }, 'STOP'],
  ['ollama', (c, f) => new OllamaProvider({ model: 'llama', baseUrl: 'http://h:11434' }, ollamaFetch(c, f)), 'stop'],
  ['mock', (c, f) => new MockAIProvider({
    reply: () => { if (f) throw boom(); return { text: c.join(''), stopReason: 'end_turn' } },
  }), 'end_turn'],
]

const input = (onStreamEnd: (info: AIStreamEndInfo) => void): GenerateInput => ({
  messages: [{ role: 'user', content: 'hi' }],
  onStreamEnd,
})

describe.each(providers)('%s: onStreamEnd', (_name, make, stopReason) => {
  it('is called once, after the last chunk and before the iteration completes', async () => {
    const log: string[] = []
    const ends: AIStreamEndInfo[] = []
    for await (const t of make(['Ho', 'la'], false).stream(input((info) => { ends.push(info); log.push('end') }))) log.push(t)
    expect(ends).toHaveLength(1)
    expect(log.join('')).toBe('Hola' + 'end')
    expect(log.at(-1)).toBe('end')
    expect(ends[0]!.stopReason).toBe(stopReason)
  })

  it('is not called when the consumer stops early', async () => {
    let calls = 0
    for await (const _ of make(['a', 'b', 'c'], false).stream(input(() => { calls++ }))) break
    expect(calls).toBe(0)
  })

  it('is not called when the stream fails', async () => {
    let calls = 0
    const it = make(['a', 'b'], true).stream(input(() => { calls++ }))
    await expect((async () => { for await (const _ of it) { /* drain */ } })()).rejects.toThrow()
    expect(calls).toBe(0)
  })

  it("a callback that throws fails the consumer's iteration", async () => {
    const it = make(['a'], false).stream(input(() => { throw new Error('callback failed') }))
    await expect((async () => { for await (const _ of it) { /* drain */ } })()).rejects.toThrow('callback failed')
  })
})

describe('onStreamEnd usage', () => {
  it('carries the streamed token usage where the provider reports it (Anthropic, Gemini)', async () => {
    for (const [name, make] of providers.filter(([n]) => n === 'anthropic' || n === 'gemini')) {
      let end: AIStreamEndInfo | undefined
      for await (const _ of make(['x'], false).stream(input((info) => { end = info }))) { /* drain */ }
      expect(end?.usage, name).toEqual({ input: 4, output: 2 })
    }
  })
})
