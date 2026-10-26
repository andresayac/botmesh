/**
 * Gemini through @google/genai (the maintained SDK; @google/generative-ai is deprecated
 * upstream). `provider: 'gemini'` loads @google/genai when it is installed and falls back
 * to @google/generative-ai otherwise; `fromGoogleGenAI()` adapts a `GoogleGenAI` client
 * (Gemini API or Vertex AI) to the provider.
 */
import { describe, expect, it, vi } from 'vitest'
import { GeminiProvider, fromGoogleGenAI, type GoogleGenAILike } from '../src/providers/gemini.js'
import { resolveGeminiClient } from '../src/providers/resolve.js'
import { GoogleGenAI } from '@google/genai'

type Params = { model: string; contents: unknown; config?: Record<string, unknown> }

function fakeGenAI(reply: (p: Params) => Record<string, unknown>, chunks?: Array<Record<string, unknown>>) {
  const calls: Params[] = []
  const ai: GoogleGenAILike = {
    models: {
      generateContent: vi.fn(async (p: Params) => { calls.push(p); return reply(p) }),
      generateContentStream: vi.fn(async (p: Params) => {
        calls.push(p)
        return (async function* () { for (const c of chunks ?? []) yield c })()
      }),
    },
  }
  return { ai, calls }
}

describe('fromGoogleGenAI', () => {
  it('sends model, contents and config (system, max tokens, tools, abort signal) and reads text, calls and usage', async () => {
    const { ai, calls } = fakeGenAI(() => ({
      candidates: [{ content: { role: 'model', parts: [{ text: 'hola ' }, { text: 'genai' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 },
    }))
    const p = new GeminiProvider(fromGoogleGenAI(ai), { model: 'gemini-x', maxTokens: 77 })
    const signal = new AbortController().signal
    const r = await p.generate({
      system: 'S', signal,
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'stock', description: 'Stock', parameters: { type: 'object', properties: { q: { type: 'string' } } } }],
    })
    expect(r).toMatchObject({ text: 'hola genai', usage: { input: 4, output: 2 }, stopReason: 'STOP', model: 'gemini-x' })
    expect(calls[0]).toMatchObject({
      model: 'gemini-x',
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      config: { systemInstruction: { text: 'S' }, maxOutputTokens: 77, abortSignal: signal, tools: [{ functionDeclarations: [{ name: 'stock' }] }] },
    })
  })

  it('reads function calls from the parts and sends tool results with the user role', async () => {
    const { ai, calls } = fakeGenAI((p) => {
      const last = (p.contents as Array<{ parts: Array<Record<string, unknown>> }>).at(-1)!
      return last.parts[0]!.functionResponse
        ? { candidates: [{ content: { role: 'model', parts: [{ text: 'tool said 12' }] }, finishReason: 'STOP' }] }
        : { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'stock', args: { q: 'pan' } }, thoughtSignature: 'sig' }] }, finishReason: 'STOP' }] }
    })
    const p = new GeminiProvider(fromGoogleGenAI(ai), { model: 'gemini-x' })
    const tools = [{ name: 'stock', description: 'Stock', parameters: { type: 'object' as const, properties: { q: { type: 'string' } } } }]
    const call = await p.generate({ messages: [{ role: 'user', content: 'stock?' }], tools })
    expect(call.toolCalls).toMatchObject([{ name: 'stock', args: { q: 'pan' } }])
    const after = await p.generate({
      messages: [
        { role: 'user', content: 'stock?' },
        { role: 'assistant', content: '', toolCalls: call.toolCalls!, providerData: call.providerData },
        { role: 'tool', content: '12', results: [{ callId: call.toolCalls![0]!.id, name: 'stock', content: '12' }] },
      ],
      tools,
    })
    expect(after.text).toBe('tool said 12')
    const sent = calls[1]!.contents as Array<{ role: string; parts: Array<Record<string, unknown>> }>
    expect(sent[1]).toEqual({ role: 'model', parts: [{ functionCall: { name: 'stock', args: { q: 'pan' } }, thoughtSignature: 'sig' }] })
    expect(sent[2]).toEqual({ role: 'user', parts: [{ functionResponse: { name: 'stock', response: { result: '12' } } }] })
  })

  it('a blocked answer (no text, finishReason SAFETY) is a refusal, not an empty reply', async () => {
    const { ai } = fakeGenAI(() => ({ candidates: [{ finishReason: 'SAFETY' }] }))
    const r = await new GeminiProvider(fromGoogleGenAI(ai), {}).generate({ messages: [{ role: 'user', content: 'x' }] })
    expect(r).toMatchObject({ text: '', stopReason: 'refusal' })
    const { ai: ai2 } = fakeGenAI(() => ({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }))
    const r2 = await new GeminiProvider(fromGoogleGenAI(ai2), {}).generate({ messages: [{ role: 'user', content: 'x' }] })
    expect(r2.stopReason).toBe('refusal')
  })

  it('streams text chunks, skipping thought parts, and reports the final usage', async () => {
    const { ai } = fakeGenAI(() => ({}), [
      { candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text: 'Ho' }] } }] },
      { candidates: [{ content: { parts: [{ text: 'la' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 } },
    ])
    let out = ''
    let end: unknown
    for await (const t of new GeminiProvider(fromGoogleGenAI(ai), {}).stream({ messages: [{ role: 'user', content: 'hi' }], onStreamEnd: (e) => { end = e } })) out += t
    expect(out).toBe('Hola')
    expect(end).toEqual({ stopReason: 'STOP', usage: { input: 3, output: 2 } })
  })

  it('accepts a real GoogleGenAI client (its types mark every FunctionCall field optional)', () => {
    // Type-level: the documented Vertex AI / custom-client path must compile without a cast.
    const ai: GoogleGenAILike = new GoogleGenAI({ apiKey: 'test-key' })
    expect(typeof fromGoogleGenAI(ai).getGenerativeModel).toBe('function')
  })

  it('drops a function call without a name (it could not be run)', async () => {
    const { ai } = fakeGenAI(() => ({
      candidates: [{ content: { role: 'model', parts: [{ functionCall: { args: { q: 'x' } } }, { functionCall: { name: 'stock', args: { q: 'pan' } } }] }, finishReason: 'STOP' }],
    }))
    const r = await new GeminiProvider(fromGoogleGenAI(ai), {}).generate({ messages: [{ role: 'user', content: 'x' }] })
    expect(r.toolCalls).toMatchObject([{ name: 'stock', args: { q: 'pan' } }])
  })

  it('defaults to a current Gemini model (gemini-2.0-flash is shut down)', async () => {
    const { ai, calls } = fakeGenAI(() => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }))
    await new GeminiProvider(fromGoogleGenAI(ai), {}).generate({ messages: [{ role: 'user', content: 'hi' }] })
    expect(calls[0]!.model).toBe('gemini-3.8-flash')
  })
})

describe('resolveGeminiClient', () => {
  it('prefers @google/genai, with the api key and baseUrl', async () => {
    const made: unknown[] = []
    class GoogleGenAI { models = { generateContent: vi.fn(), generateContentStream: vi.fn() }; constructor(o: unknown) { made.push(o) } }
    const load = vi.fn(async (name: string) => {
      if (name === '@google/genai') return { GoogleGenAI }
      throw new Error(`unexpected ${name}`)
    })
    const client = await resolveGeminiClient({ apiKey: 'k', baseUrl: 'http://127.0.0.1:9/' }, load)
    expect(load).toHaveBeenCalledTimes(1)
    expect(made).toEqual([{ apiKey: 'k', httpOptions: { baseUrl: 'http://127.0.0.1:9/' } }])
    expect(typeof client.getGenerativeModel).toBe('function')
  })

  it('falls back to the deprecated @google/generative-ai when @google/genai is not installed', async () => {
    const legacy = { getGenerativeModel: vi.fn() }
    const keys: unknown[] = []
    class GoogleGenerativeAI { constructor(k: unknown) { keys.push(k); return legacy as never } }
    const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => {})
    try {
      const load = vi.fn(async (name: string) => {
        if (name === '@google/genai') throw new Error('This AI provider needs the package "@google/genai", which is not installed.', { cause: Object.assign(new Error('x'), { code: 'ERR_MODULE_NOT_FOUND' }) })
        return { GoogleGenerativeAI }
      })
      const client = await resolveGeminiClient({ apiKey: 'k' }, load)
      expect(client).toBe(legacy)
      expect(keys).toEqual(['k'])
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/@google\/generative-ai is deprecated/), expect.objectContaining({ type: 'DeprecationWarning' }))
    } finally {
      warn.mockRestore()
    }
  })

  it('asks for @google/genai when neither SDK is installed', async () => {
    // Same message as loadModule: the hint comes from the caller.
    const missing = (name: string, hint: string) => new Error(`This AI provider needs the package "${name}", which is not installed. Install it: ${hint}`, { cause: Object.assign(new Error('x'), { code: 'ERR_MODULE_NOT_FOUND' }) })
    const load = vi.fn(async (name: string, hint: string) => { throw missing(name, hint) })
    await expect(resolveGeminiClient({ apiKey: 'k' }, load)).rejects.toThrow(/pnpm add @google\/genai/)
  })
})
