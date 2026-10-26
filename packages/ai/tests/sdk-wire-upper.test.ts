/**
 * The same wire round trip as `sdk-wire.test.ts` (text, tool call + tool result, SSE
 * stream with stop reason), against the NEWEST SDK versions the peer ranges accept.
 * The repo installs the oldest ones, so this suite is opt-in: install the upper end in a
 * scratch folder and point `BOTWA_TEST_SDK_UPPER_DIR` at it.
 *
 *   mkdir sdk-upper && cd sdk-upper && npm init -y
 *   npm install --ignore-scripts @anthropic-ai/sdk@^1 openai@^7 @google/generative-ai@0.24
 *   BOTWA_TEST_SDK_UPPER_DIR=$PWD pnpm --filter @botmesh/ai exec vitest run tests/sdk-wire-upper.test.ts
 *
 * No network beyond that install, no credentials: the SDKs talk to local fakes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { AnthropicProvider, type AnthropicLike } from '../src/providers/anthropic.js'
import { OpenAIProvider, type OpenAILike } from '../src/providers/openai.js'
import { GeminiProvider, type GeminiLike } from '../src/providers/gemini.js'
import type { AIProvider } from '../src/types.js'
import type { AIToolDefinition } from '../src/tools/types.js'
import { startFakeApis, type FakeApis } from './fixtures/fakeApis.js'

const DIR = process.env.BOTWA_TEST_SDK_UPPER_DIR

/** Import `name` as installed in DIR (not the repo's devDependency). */
async function load<T>(name: string): Promise<{ mod: T; version: string }> {
  const req = createRequire(join(DIR!, 'package.json'))
  const mod = (await import(pathToFileURL(req.resolve(name)).href)) as T
  // Not `require(name/package.json)`: the SDKs' `exports` do not list it.
  const version = (JSON.parse(readFileSync(join(DIR!, 'node_modules', name, 'package.json'), 'utf8')) as { version: string }).version
  return { mod, version }
}

let api: FakeApis
beforeAll(async () => { if (DIR) api = await startFakeApis() })
afterAll(async () => { await api?.close() })

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

describe.skipIf(!DIR)('newest SDKs in the peer ranges against local API fakes', () => {
  it('@anthropic-ai/sdk (upper range): messages, tool_use/tool_result, SSE stream', async () => {
    const { mod, version } = await load<{ default: new (o: object) => unknown }>('@anthropic-ai/sdk')
    expect(version).toMatch(/^1\./)
    const sdk = new mod.default({ apiKey: 'test-key', baseURL: api.base, maxRetries: 0 })
    const r = await roundTrip(new AnthropicProvider(sdk as AnthropicLike, { model: 'claude-haiku-4-5' }))
    expect(r).toMatchObject({ text: 'hola anthropic', usage: { input: 3, output: 2 }, after: 'tool said 12', streamed: 'Hola stream', end: 'end_turn' })
    expect(r.call).toMatchObject({ id: 'toolu_1', name: 'stock', args: { q: 'pan' } })
  })

  it('openai (upper range): chat completions, tool_calls/tool messages, SSE stream', async () => {
    const { mod, version } = await load<{ default: new (o: object) => unknown }>('openai')
    expect(version).toMatch(/^7\./)
    const sdk = new mod.default({ apiKey: 'test-key', baseURL: `${api.base}/v1`, maxRetries: 0 })
    const r = await roundTrip(new OpenAIProvider(sdk as OpenAILike, { model: 'gpt-x' }))
    expect(r).toMatchObject({ text: 'hola openai', usage: { input: 3, output: 2 }, after: 'tool said 12', streamed: 'Hola openai', end: 'stop' })
    expect(r.call).toMatchObject({ id: 'call_1', name: 'stock', args: { q: 'pan' } })
  })

  it('@google/generative-ai (upper range): generateContent, functionCall/functionResponse, SSE stream', async () => {
    const { mod, version } = await load<{ GoogleGenerativeAI: new (key: string) => { getGenerativeModel(p: unknown, o: unknown): unknown } }>('@google/generative-ai')
    expect(version).toMatch(/^0\.24\./)
    const sdk = new mod.GoogleGenerativeAI('test-key')
    const client: GeminiLike = { getGenerativeModel: (p) => sdk.getGenerativeModel(p, { baseUrl: api.base }) as never }
    const r = await roundTrip(new GeminiProvider(client, { model: 'gemini-x' }))
    expect(r).toMatchObject({ text: 'hola gemini', usage: { input: 3, output: 2 }, after: 'tool said {"result":"12"}', streamed: 'Hola gemini', end: 'STOP' })
    expect(r.call).toMatchObject({ name: 'stock', args: { q: 'pan' } })
  })
})
