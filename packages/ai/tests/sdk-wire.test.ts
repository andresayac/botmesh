/**
 * The REAL provider SDKs (the devDependency versions, i.e. the oldest the peer ranges
 * accept) against a local fake of each HTTP API: request shape, tool calls and their
 * results, streaming and usage, through the providers and through `aiPlugin` with the
 * lazy SDK load (`resolveProvider`). No network, no credentials.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { createTestBot } from '@botmesh/core/testing'
import { AnthropicProvider, type AnthropicLike } from '../src/providers/anthropic.js'
import { OpenAIProvider, type OpenAILike } from '../src/providers/openai.js'
import { GeminiProvider, type GeminiLike } from '../src/providers/gemini.js'
import { aiPlugin } from '../src/plugin.js'
import type { AIProvider } from '../src/types.js'
import type { AIToolDefinition } from '../src/tools/types.js'
import type { AIToolSet } from '../src/tools/types.js'
import { startFakeApis, type FakeApis } from './fixtures/fakeApis.js'

let api: FakeApis
beforeAll(async () => { api = await startFakeApis() })
afterAll(async () => { await api.close() })

const tools: AIToolDefinition[] = [{ name: 'stock', description: 'Stock', parameters: { type: 'object', properties: { q: { type: 'string' } } } }]

async function collect(it: AsyncIterable<string>): Promise<string> {
  let s = ''
  for await (const p of it) s += p
  return s
}

async function roundTrip(provider: AIProvider) {
  const text = await provider.generate({ system: 'S', messages: [{ role: 'user', content: 'hola' }] })
  const call = await provider.generate({ messages: [{ role: 'user', content: 'stock?' }], tools })
  const after = await provider.generate({
    messages: [
      { role: 'user', content: 'stock?' },
      { role: 'assistant', content: '', toolCalls: call.toolCalls!, providerData: call.providerData },
      { role: 'tool', content: '12', results: [{ callId: call.toolCalls![0]!.id, name: 'stock', content: '12' }] },
    ],
    tools,
  })
  let end: string | undefined
  const streamed = await collect(provider.stream({ messages: [{ role: 'user', content: 'hola' }], onStreamEnd: (e) => { end = e.stopReason } }))
  return { text: text.text, usage: text.usage, call: call.toolCalls?.[0], after: after.text, streamed, end }
}

describe('real SDKs against local API fakes', () => {
  it('@anthropic-ai/sdk: messages, tool_use/tool_result, SSE stream', async () => {
    const sdk = new Anthropic({ apiKey: 'test-key', baseURL: api.base, maxRetries: 0 })
    const r = await roundTrip(new AnthropicProvider(sdk as unknown as AnthropicLike, { model: 'claude-haiku-4-5' }))
    expect(r).toMatchObject({ text: 'hola anthropic', usage: { input: 3, output: 2 }, after: 'tool said 12', streamed: 'Hola stream', end: 'end_turn' })
    expect(r.call).toMatchObject({ id: 'toolu_1', name: 'stock', args: { q: 'pan' } })
    const first = api.requests.find((q) => q.url.startsWith('/v1/messages'))!
    expect(first.body).toMatchObject({ model: 'claude-haiku-4-5', system: 'S', max_tokens: 4096 })
    expect(first.body).not.toHaveProperty('thinking') // Haiku 4.5 has no adaptive thinking
  })

  it('openai: chat completions, tool_calls/tool messages, SSE stream', async () => {
    const sdk = new OpenAI({ apiKey: 'test-key', baseURL: `${api.base}/v1`, maxRetries: 0 })
    const r = await roundTrip(new OpenAIProvider(sdk as unknown as OpenAILike, { model: 'gpt-x' }))
    expect(r).toMatchObject({ text: 'hola openai', usage: { input: 3, output: 2 }, after: 'tool said 12', streamed: 'Hola openai', end: 'stop' })
    expect(r.call).toMatchObject({ id: 'call_1', name: 'stock', args: { q: 'pan' } })
    const first = api.requests.find((q) => q.url.startsWith('/v1/chat/completions'))!
    expect(first.body).toMatchObject({ model: 'gpt-x', max_completion_tokens: 1024 })
  })

  it('@google/generative-ai: generateContent, functionCall/functionResponse, SSE stream', async () => {
    const sdk = new GoogleGenerativeAI('test-key')
    const client: GeminiLike = { getGenerativeModel: (p) => sdk.getGenerativeModel(p, { baseUrl: api.base }) as never }
    const r = await roundTrip(new GeminiProvider(client, { model: 'gemini-x' }))
    expect(r).toMatchObject({ text: 'hola gemini', usage: { input: 3, output: 2 }, after: 'tool said {"result":"12"}', streamed: 'Hola gemini', end: 'STOP' })
    expect(r.call).toMatchObject({ name: 'stock', args: { q: 'pan' } })
  })

  it('aiPlugin resolves the real SDK lazily (anthropic and openai with baseUrl) and runs a tool turn', async () => {
    const ran: string[] = []
    const stock: AIToolSet = {
      stock: {
        description: 'Stock',
        schema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
        handler: ({ q }: { q: string }) => { ran.push(q); return '12' },
      },
    }
    for (const cfg of [
      { provider: 'anthropic' as const, apiKey: 'test-key', baseUrl: api.base, model: 'claude-haiku-4-5' },
      { provider: 'openai' as const, apiKey: 'test-key', baseUrl: `${api.base}/v1`, model: 'gpt-x' },
    ]) {
      const t = await createTestBot()
      t.bot.plug(aiPlugin({ ...cfg, tools: stock }))
      await t.chat.send('¿hay pan?')
      await t.chat.expectReply('tool said 12', 5000)
      await t.bot.stop()
    }
    expect(ran).toEqual(['pan', 'pan'])
  })
})
