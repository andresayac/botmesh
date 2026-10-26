/**
 * The REAL provider SDKs, at both ends of each peer range (the current major from the
 * devDependencies and the oldest accepted version through an npm alias), against a local
 * fake of each HTTP API: request shape, tool calls and their
 * results, streaming and usage, through the providers and through `aiPlugin` with the
 * lazy SDK load (`resolveProvider`). No network, no credentials.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import AnthropicV0 from 'anthropic-sdk-v0'
import OpenAI from 'openai'
import OpenAIV6 from 'openai-v6'
import { GoogleGenAI } from '@google/genai'
import { GoogleGenAI as GoogleGenAIV2_0 } from 'google-genai-v2-0'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { createTestBot } from '@botmesh/core/testing'
import { AnthropicProvider, type AnthropicLike } from '../src/providers/anthropic.js'
import { OpenAIProvider, type OpenAILike } from '../src/providers/openai.js'
import { GeminiProvider, fromGoogleGenAI, type GeminiLike, type GoogleGenAILike } from '../src/providers/gemini.js'
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
  it.each([
    ['1.x (current)', Anthropic],
    ['0.68 (oldest accepted)', AnthropicV0],
  ] as const)('@anthropic-ai/sdk %s: messages, tool_use/tool_result, SSE stream', async (_v, Sdk) => {
    api.requests.length = 0
    const sdk = new Sdk({ apiKey: 'test-key', baseURL: api.base, maxRetries: 0 })
    const r = await roundTrip(new AnthropicProvider(sdk as unknown as AnthropicLike, { model: 'claude-haiku-4-5' }))
    expect(r).toMatchObject({ text: 'hola anthropic', usage: { input: 3, output: 2 }, after: 'tool said 12', streamed: 'Hola stream', end: 'end_turn' })
    expect(r.call).toMatchObject({ id: 'toolu_1', name: 'stock', args: { q: 'pan' } })
    const first = api.requests.find((q) => q.url.startsWith('/v1/messages'))!
    expect(first.body).toMatchObject({ model: 'claude-haiku-4-5', system: 'S', max_tokens: 4096 })
    expect(first.body).not.toHaveProperty('thinking') // Haiku 4.5 has no adaptive thinking
  })

  it.each([
    ['7.x (current)', OpenAI],
    ['6.48 (oldest accepted)', OpenAIV6],
  ] as const)('openai %s: chat completions, tool_calls/tool messages, SSE stream', async (_v, Sdk) => {
    api.requests.length = 0
    const sdk = new Sdk({ apiKey: 'test-key', baseURL: `${api.base}/v1`, maxRetries: 0 })
    const r = await roundTrip(new OpenAIProvider(sdk as unknown as OpenAILike, { model: 'gpt-x' }))
    expect(r).toMatchObject({ text: 'hola openai', usage: { input: 3, output: 2 }, after: 'tool said 12', streamed: 'Hola openai', end: 'stop' })
    expect(r.call).toMatchObject({ id: 'call_1', name: 'stock', args: { q: 'pan' } })
    const first = api.requests.find((q) => q.url.startsWith('/v1/chat/completions'))!
    expect(first.body).toMatchObject({ model: 'gpt-x', max_completion_tokens: 1024 })
  })

  it.each([
    ['2.x (current)', GoogleGenAI],
    ['2.0 (oldest accepted)', GoogleGenAIV2_0],
  ] as const)('@google/genai %s: generateContent, functionCall/functionResponse, SSE stream', async (_v, Sdk) => {
    api.requests.length = 0
    const sdk = new Sdk({ apiKey: 'test-key', httpOptions: { baseUrl: api.base } })
    const r = await roundTrip(new GeminiProvider(fromGoogleGenAI(sdk as unknown as GoogleGenAILike), { model: 'gemini-x' }))
    expect(r).toMatchObject({ text: 'hola gemini', usage: { input: 3, output: 2 }, after: 'tool said {"result":"12"}', streamed: 'Hola gemini', end: 'STOP' })
    expect(r.call).toMatchObject({ name: 'stock', args: { q: 'pan' } })
    const first = api.requests.find((q) => q.url.includes('gemini-x:generateContent'))!
    expect(first.body).toMatchObject({ systemInstruction: { parts: [{ text: 'S' }] }, generationConfig: { maxOutputTokens: 1024 } })
  })

  it('@google/generative-ai (deprecated, still accepted): generateContent, functionCall/functionResponse, SSE stream', async () => {
    const sdk = new GoogleGenerativeAI('test-key')
    const client: GeminiLike = { getGenerativeModel: (p) => sdk.getGenerativeModel(p, { baseUrl: api.base }) as never }
    const r = await roundTrip(new GeminiProvider(client, { model: 'gemini-x' }))
    expect(r).toMatchObject({ text: 'hola gemini', usage: { input: 3, output: 2 }, after: 'tool said {"result":"12"}', streamed: 'Hola gemini', end: 'STOP' })
    expect(r.call).toMatchObject({ name: 'stock', args: { q: 'pan' } })
  })

  it('aiPlugin resolves the real SDK lazily (anthropic, openai and gemini with baseUrl) and runs a tool turn', async () => {
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
      { provider: 'gemini' as const, apiKey: 'test-key', baseUrl: api.base, model: 'gemini-x' },
    ]) {
      const t = await createTestBot()
      t.bot.plug(aiPlugin({ ...cfg, tools: stock }))
      await t.chat.send('¿hay pan?')
      await t.chat.expectReply(cfg.provider === 'gemini' ? 'tool said {"result":"12"}' : 'tool said 12', 5000)
      await t.bot.stop()
    }
    expect(ran).toEqual(['pan', 'pan', 'pan'])
    // provider 'gemini' loaded the maintained @google/genai SDK (not the deprecated one).
    const gemini = api.requests.filter((q) => q.url.includes('gemini-x:generateContent'))
    expect(gemini.length).toBeGreaterThan(0)
    expect(String(gemini[0]!.headers['x-goog-api-client'])).toMatch(/google-genai-sdk/)
  })
})
