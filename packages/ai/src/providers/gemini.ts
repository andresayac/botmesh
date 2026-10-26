/**
 * GeminiProvider — native Google Gemini. The client is `@google/genai` (optional peer
 * dependency, loaded lazily and adapted with {@link fromGoogleGenAI}); the deprecated
 * `@google/generative-ai` SDK is still accepted as a fallback. Gemini is not
 * OpenAI-compatible at the message-shape level (it uses `parts` and the `model` role),
 * so it gets its own provider rather than a preset.
 */

import type { AIProvider, GenerateInput, GenerateResult, AIConfig, AIChatMessage } from '../types.js'
import type { AIToolCall, JSONSchema } from '../tools/types.js'

export interface GeminiUsage {
  promptTokenCount?: number
  candidatesTokenCount?: number
}
export interface GeminiRequestOptions {
  signal?: AbortSignal
}
export interface GeminiFunctionCall {
  name: string
  args?: unknown
}
export interface GeminiPart {
  text?: string
  functionCall?: GeminiFunctionCall
  functionResponse?: { name: string; response: Record<string, unknown> }
  /** Opaque signature of a thinking model's reasoning; must be replayed with its part. */
  thoughtSignature?: string
  thought?: boolean
}
export interface GeminiResponse {
  text(): string
  usageMetadata?: GeminiUsage
  functionCalls?(): GeminiFunctionCall[] | undefined
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>
  /** Set when the prompt itself was blocked (then there are no candidates). */
  promptFeedback?: { blockReason?: string }
}
export interface GeminiModelLike {
  generateContent(args: Record<string, unknown>, requestOptions?: GeminiRequestOptions): Promise<{
    response: GeminiResponse
  }>
  generateContentStream?(args: Record<string, unknown>, requestOptions?: GeminiRequestOptions): Promise<{
    stream: AsyncIterable<Pick<GeminiResponse, 'text' | 'candidates' | 'promptFeedback'> & { usageMetadata?: GeminiUsage }>
  }>
}
export interface GeminiLike {
  getGenerativeModel(cfg: { model: string }): GeminiModelLike
}

type GeminiContent = { role: 'user' | 'model' | 'function'; parts: GeminiPart[] }

/** Default model when neither the config nor the call names one (outside semver: it follows Google's current Flash model). */
const DEFAULT_MODEL = 'gemini-3.8-flash'

/**
 * Finish / block reasons meaning the answer was withheld by Gemini's safety
 * filters. They are reported as `stopReason: 'refusal'` (the autoreply then
 * answers `refusalMessage`) instead of the SDK's `text()` exception.
 */
const BLOCKED = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY'])

/** The response (or stream chunk) was blocked by the safety filters. */
function blocked(r: Pick<GeminiResponse, 'candidates' | 'promptFeedback'>): boolean {
  const reason = r.candidates?.[0]?.finishReason
  return (reason !== undefined && BLOCKED.has(reason)) || !!r.promptFeedback?.blockReason
}

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini'
  private callSeq = 0
  constructor(
    private client: GeminiLike,
    private cfg: AIConfig,
  ) {}

  private contents(messages: AIChatMessage[]): GeminiContent[] {
    return messages.map(toGeminiContent)
  }

  private buildArgs(input: GenerateInput, withTools = true): Record<string, unknown> {
    const args: Record<string, unknown> = {
      contents: this.contents(input.messages),
      generationConfig: { maxOutputTokens: input.maxTokens ?? input.defaultMaxTokens ?? this.cfg.maxTokens ?? 1024 },
    }
    if (input.system) args.systemInstruction = { text: input.system }
    if (withTools && input.tools?.length) {
      args.tools = [{
        functionDeclarations: input.tools.map((t) => {
          const parameters = toGeminiSchema(t.parameters)
          const props = parameters.properties
          const hasProps = typeof props === 'object' && props !== null && Object.keys(props).length > 0
          // Gemini rejects an OBJECT schema with no properties: omit parameters for no-arg tools.
          return hasProps ? { name: t.name, description: t.description, parameters } : { name: t.name, description: t.description }
        }),
      }]
    }
    return args
  }

  private model(input: GenerateInput): GeminiModelLike {
    return this.client.getGenerativeModel({ model: input.model ?? this.cfg.model ?? DEFAULT_MODEL })
  }

  private reqOpts(input: GenerateInput): GeminiRequestOptions | undefined {
    return input.signal ? { signal: input.signal } : undefined
  }

  async generate(input: GenerateInput): Promise<GenerateResult> {
    const res = await this.model(input).generateContent(this.buildArgs(input), this.reqOpts(input))
    const usage = res.response.usageMetadata
    const parts = res.response.candidates?.[0]?.content?.parts
    const calls = res.response.functionCalls?.()
      ?? (parts ?? []).flatMap((p) => (p.functionCall ? [p.functionCall] : []))
    // Gemini does not id function calls; synthesize ids so results can be matched.
    const toolCalls: AIToolCall[] = calls.map((c) => ({ id: `gemini_call_${++this.callSeq}`, name: c.name, args: c.args ?? {} }))
    let text = ''
    let refused = false
    try {
      text = res.response.text()
    } catch (err) {
      // The SDK throws from text() for blocked responses (SAFETY, RECITATION, a blocked
      // prompt...): that is a refusal, not a failure. Only a pure function-call turn may
      // have no text; anything else stays an error.
      if (!toolCalls.length && blocked(res.response)) refused = true
      else if (!toolCalls.length) throw err
    }
    // @google/genai returns no text (instead of throwing) for a blocked answer.
    if (!text && !toolCalls.length && blocked(res.response)) refused = true
    const finish = refused ? 'refusal' : res.response.candidates?.[0]?.finishReason
    return {
      text,
      model: input.model ?? this.cfg.model ?? DEFAULT_MODEL,
      usage: usage ? { input: usage.promptTokenCount ?? 0, output: usage.candidatesTokenCount ?? 0 } : undefined,
      ...(finish ? { stopReason: finish } : {}),
      // Raw parts carry the thoughtSignature that thinking models (2.5 / 3) require
      // to be sent back unchanged in the next step of a function-calling loop.
      ...(toolCalls.length ? { toolCalls, ...(parts?.length ? { providerData: parts } : {}) } : {}),
    }
  }

  async *stream(input: GenerateInput): AsyncIterable<string> {
    const model = this.model(input)
    if (!model.generateContentStream) {
      const r = await this.generate(input)
      if (r.text) yield r.text
      input.onStreamEnd?.({ stopReason: r.stopReason, ...(r.usage ? { usage: r.usage } : {}) })
      return
    }
    const { stream } = await model.generateContentStream(this.buildArgs(input, false), this.reqOpts(input))
    let stopReason: string | undefined
    let usage: { input: number; output: number } | undefined
    for await (const chunk of stream) {
      // Each chunk may carry the running usage; the last one is the total.
      const u = chunk.usageMetadata
      if (u) usage = { input: u.promptTokenCount ?? 0, output: u.candidatesTokenCount ?? 0 }
      if (blocked(chunk)) {
        // The rest of the answer was withheld: report a refusal (the SDK's text() would throw).
        stopReason = 'refusal'
        break
      }
      stopReason = chunk.candidates?.[0]?.finishReason ?? stopReason
      const t = chunk.text()
      if (t) yield t
    }
    input.onStreamEnd?.({ stopReason, ...(usage ? { usage } : {}) })
  }
}

function toGeminiContent(m: AIChatMessage): GeminiContent {
  if (m.role === 'tool') {
    return {
      role: 'function',
      parts: m.results.map((r) => ({
        functionResponse: { name: r.name, response: r.isError ? { error: r.content } : { result: r.content } },
      })),
    }
  }
  if (m.role === 'assistant') {
    if (Array.isArray(m.providerData) && m.providerData.length) return { role: 'model', parts: m.providerData as GeminiPart[] }
    const parts: GeminiPart[] = []
    if (m.content || !m.toolCalls?.length) parts.push({ text: m.content })
    for (const c of m.toolCalls ?? []) parts.push({ functionCall: { name: c.name, args: c.args ?? {} } })
    return { role: 'model', parts }
  }
  return { role: 'user', parts: [{ text: m.content }] }
}

/** Gemini accepts an OpenAPI subset of JSON Schema: drop the keywords it rejects. */
const GEMINI_UNSUPPORTED = new Set(['$schema', '$id', '$ref', '$defs', 'definitions', 'additionalProperties', 'default', 'examples', 'const'])

export function toGeminiSchema(schema: JSONSchema): JSONSchema {
  const out: JSONSchema = {}
  for (const [k, v] of Object.entries(schema)) {
    if (GEMINI_UNSUPPORTED.has(k)) continue
    if (k === 'properties' && v && typeof v === 'object') {
      out.properties = Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, pv && typeof pv === 'object' ? toGeminiSchema(pv as JSONSchema) : pv]),
      )
    } else if (k === 'items' && v && typeof v === 'object' && !Array.isArray(v)) {
      out.items = toGeminiSchema(v as JSONSchema)
    } else {
      out[k] = v
    }
  }
  return out
}

/* =============================================================================
 * @google/genai adapter
 * ========================================================================== */

/** A `GenerateContentResponse` of `@google/genai` (only the fields the provider reads). */
export interface GoogleGenAIResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>
  usageMetadata?: GeminiUsage
  promptFeedback?: { blockReason?: string }
}

/** The part of a `GoogleGenAI` client (`@google/genai`) the provider uses: `ai.models`. */
export interface GoogleGenAILike {
  models: {
    generateContent(params: { model: string; contents: unknown; config?: Record<string, unknown> }): Promise<GoogleGenAIResponse>
    generateContentStream(params: { model: string; contents: unknown; config?: Record<string, unknown> }): Promise<AsyncIterable<GoogleGenAIResponse>>
  }
}

/** Visible text of a response: the text parts, without thought summaries. */
function genaiText(r: GoogleGenAIResponse): string {
  return (r.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('')
}

function genaiResponse(r: GoogleGenAIResponse): GeminiResponse {
  return {
    text: () => genaiText(r),
    functionCalls: () => {
      const calls = (r.candidates?.[0]?.content?.parts ?? []).flatMap((p) => (p.functionCall ? [p.functionCall] : []))
      return calls.length ? calls : undefined
    },
    ...(r.candidates ? { candidates: r.candidates } : {}),
    ...(r.usageMetadata ? { usageMetadata: r.usageMetadata } : {}),
    ...(r.promptFeedback ? { promptFeedback: r.promptFeedback } : {}),
  }
}

/** The provider's request (the legacy SDK's `generateContent` arguments) in the `@google/genai` shape. */
function genaiParams(model: string, args: Record<string, unknown>, opts?: GeminiRequestOptions): { model: string; contents: unknown; config: Record<string, unknown> } {
  // Function results go back with the user role (the Gemini API only knows user/model).
  const contents = (args.contents as GeminiContent[]).map((c) => (c.role === 'function' ? { ...c, role: 'user' as const } : c))
  return {
    model,
    contents,
    config: {
      ...(args.generationConfig as Record<string, unknown> | undefined),
      ...(args.systemInstruction ? { systemInstruction: args.systemInstruction } : {}),
      ...(args.tools ? { tools: args.tools } : {}),
      ...(opts?.signal ? { abortSignal: opts.signal } : {}),
    },
  }
}

/**
 * Adapt a `GoogleGenAI` client from `@google/genai` (Gemini API or Vertex AI) to the
 * {@link GeminiLike} interface {@link GeminiProvider} takes:
 *
 * ```ts
 * import { GoogleGenAI } from '@google/genai'
 * const gemini = new GeminiProvider(fromGoogleGenAI(new GoogleGenAI({ vertexai: true, project, location })), { model })
 * ```
 *
 * `aiPlugin({ provider: 'gemini' })` does this by itself.
 */
export function fromGoogleGenAI(ai: GoogleGenAILike): GeminiLike {
  return {
    getGenerativeModel: ({ model }) => ({
      generateContent: async (args, opts) => ({ response: genaiResponse(await ai.models.generateContent(genaiParams(model, args, opts))) }),
      generateContentStream: async (args, opts) => {
        const chunks = await ai.models.generateContentStream(genaiParams(model, args, opts))
        return {
          stream: (async function* () {
            for await (const chunk of chunks) yield genaiResponse(chunk)
          })(),
        }
      },
    }),
  }
}
