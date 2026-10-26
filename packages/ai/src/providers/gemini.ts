/**
 * GeminiProvider — native Google Gemini. The client is `@google/genai` (optional peer
 * dependency, loaded lazily and adapted with {@link fromGoogleGenAI}); the deprecated
 * `@google/generative-ai` SDK is still accepted as a fallback. Gemini is not
 * OpenAI-compatible at the message-shape level (it uses `parts` and the `model` role),
 * so it gets its own provider rather than a preset.
 */

import type { AIProvider, GenerateInput, GenerateResult, AIProviderConfig, AIChatMessage } from '../types.js'
import type { AIToolCall, JSONSchema } from '../tools/types.js'
import { endStream } from './streamEnd.js'

/**
 * A Gemini model handle (`getGenerativeModel()` of {@link GeminiLike}): `generateContent` and,
 * when present, `generateContentStream`. The request/response shapes are written inline (their
 * names, such as `GeminiResponse`, live in `@botmesh/ai/internal`); only the fields the provider
 * reads are listed.
 */
export interface GeminiModelLike {
  generateContent(args: Record<string, unknown>, requestOptions?: { signal?: AbortSignal }): Promise<{
    response: {
      text(): string
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
      functionCalls?(): Array<{ name: string; args?: unknown }> | undefined
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string
            functionCall?: { name: string; args?: unknown }
            functionResponse?: { name: string; response: Record<string, unknown> }
            /** Opaque signature of a thinking model's reasoning; must be replayed with its part. */
            thoughtSignature?: string
            thought?: boolean
          }>
        }
        finishReason?: string
      }>
      /** Set when the prompt itself was blocked (then there are no candidates). */
      promptFeedback?: { blockReason?: string }
    }
  }>
  generateContentStream?(args: Record<string, unknown>, requestOptions?: { signal?: AbortSignal }): Promise<{
    /** Stream chunks: the response fields above except `functionCalls`. */
    stream: AsyncIterable<Pick<Awaited<ReturnType<GeminiModelLike['generateContent']>>['response'], 'text' | 'candidates' | 'promptFeedback' | 'usageMetadata'>>
  }>
}
/**
 * The part of a Gemini client the provider uses. `fromGoogleGenAI(new GoogleGenAI(...))`
 * builds one from `@google/genai`; the legacy `GoogleGenerativeAI` of `@google/generative-ai`
 * already has this shape.
 */
export interface GeminiLike {
  getGenerativeModel(cfg: { model: string }): GeminiModelLike
}

/** Request options of {@link GeminiModelLike} calls (no semver: `@botmesh/ai/internal`). */
export type GeminiRequestOptions = NonNullable<Parameters<GeminiModelLike['generateContent']>[1]>
/** A `generateContent` response, as the provider reads it (no semver: `@botmesh/ai/internal`). */
export type GeminiResponse = Awaited<ReturnType<GeminiModelLike['generateContent']>>['response']
/** Token usage of {@link GeminiResponse} (no semver: `@botmesh/ai/internal`). */
export type GeminiUsage = NonNullable<GeminiResponse['usageMetadata']>
/** One content part of {@link GeminiResponse} (no semver: `@botmesh/ai/internal`). */
export type GeminiPart = NonNullable<NonNullable<NonNullable<GeminiResponse['candidates']>[number]['content']>['parts']>[number]
/** A function call of {@link GeminiPart} (no semver: `@botmesh/ai/internal`). */
export type GeminiFunctionCall = NonNullable<GeminiPart['functionCall']>

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
    private cfg: AIProviderConfig,
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
      endStream(input, { stopReason: r.stopReason, ...(r.usage ? { usage: r.usage } : {}) })
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
    endStream(input, { stopReason, ...(usage ? { usage } : {}) })
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

const isSchema = (v: unknown): v is JSONSchema => !!v && typeof v === 'object' && !Array.isArray(v)
const isNullSchema = (v: unknown): boolean => isSchema(v) && v.type === 'null'

/**
 * Convert a JSON Schema to the OpenAPI subset Gemini accepts: unsupported keywords are
 * dropped at every level (`properties`, `items`, `anyOf`/`oneOf`/`allOf`), `oneOf`
 * becomes `anyOf`, a one-element `allOf` is merged, and `null` alternatives (zod
 * `.nullable()`: `anyOf: [T, { type: 'null' }]` or `type: [T, 'null']`) become
 * `nullable: true`.
 */
export function toGeminiSchema(schema: JSONSchema): JSONSchema {
  const out: JSONSchema = {}
  let nullable = false
  for (const [k, v] of Object.entries(schema)) {
    if (GEMINI_UNSUPPORTED.has(k)) continue
    if (k === 'properties' && v && typeof v === 'object') {
      out.properties = Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, isSchema(pv) ? toGeminiSchema(pv) : pv]),
      )
    } else if (k === 'items' && isSchema(v)) {
      out.items = toGeminiSchema(v)
    } else if ((k === 'anyOf' || k === 'oneOf') && Array.isArray(v)) {
      const options = v.filter((x) => !isNullSchema(x))
      if (options.length < v.length) nullable = true
      const mapped = options.map((x) => (isSchema(x) ? toGeminiSchema(x) : x))
      if (mapped.length === 1 && isSchema(mapped[0])) Object.assign(out, mapped[0])
      else if (mapped.length > 0) out.anyOf = mapped
    } else if (k === 'allOf' && Array.isArray(v)) {
      const mapped = v.map((x) => (isSchema(x) ? toGeminiSchema(x) : x))
      if (mapped.length === 1 && isSchema(mapped[0])) Object.assign(out, mapped[0])
      else out.allOf = mapped
    } else if (k === 'type' && Array.isArray(v)) {
      const types = v.filter((t) => t !== 'null')
      if (types.length < v.length) nullable = true
      out.type = types.length === 1 ? types[0] : types
    } else {
      out[k] = v
    }
  }
  if (nullable) out.nullable = true
  return out
}

/* =============================================================================
 * @google/genai adapter
 * ========================================================================== */

/**
 * The part of a `GoogleGenAI` client (`@google/genai`) the provider uses: `ai.models`.
 * Responses are written inline (their name, `GoogleGenAIResponse`, lives in
 * `@botmesh/ai/internal`); only the fields the provider reads are listed.
 */
export interface GoogleGenAILike {
  models: {
    generateContent(params: { model: string; contents: unknown; config?: object }): Promise<{
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string
            functionCall?: { name?: string; args?: unknown }
            functionResponse?: { name?: string; response?: Record<string, unknown> }
            thoughtSignature?: string
            thought?: boolean
          }>
        }
        finishReason?: string
      }>
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
      promptFeedback?: { blockReason?: string }
    }>
    /** Streams chunks shaped like a `generateContent` response. */
    generateContentStream(params: { model: string; contents: unknown; config?: object }): Promise<AsyncIterable<Awaited<ReturnType<GoogleGenAILike['models']['generateContent']>>>>
  }
}

/** A `GenerateContentResponse` of `@google/genai`, as the provider reads it (no semver: `@botmesh/ai/internal`). */
export type GoogleGenAIResponse = Awaited<ReturnType<GoogleGenAILike['models']['generateContent']>>
type GoogleGenAIPart = NonNullable<NonNullable<NonNullable<GoogleGenAIResponse['candidates']>[number]['content']>['parts']>[number]

/** Visible text of a response: the text parts, without thought summaries. */
function genaiText(r: GoogleGenAIResponse): string {
  return (r.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('')
}

/**
 * One `@google/genai` part in the provider's shape. That SDK types every `FunctionCall` /
 * `FunctionResponse` field as optional: a call without a name cannot be run, so it is dropped.
 */
function genaiPart(p: GoogleGenAIPart): GeminiPart {
  const { functionCall, functionResponse, ...rest } = p
  return {
    ...rest,
    ...(functionCall?.name ? { functionCall: { ...functionCall, name: functionCall.name } } : {}),
    ...(functionResponse?.name ? { functionResponse: { name: functionResponse.name, response: functionResponse.response ?? {} } } : {}),
  }
}

function genaiResponse(r: GoogleGenAIResponse): GeminiResponse {
  const candidates: GeminiResponse['candidates'] = r.candidates?.map(({ content, ...c }) => {
    if (!content) return c
    const { parts, ...rest } = content
    return { ...c, content: parts ? { ...rest, parts: parts.map(genaiPart) } : rest }
  })
  return {
    text: () => genaiText(r),
    functionCalls: () => {
      const calls = (candidates?.[0]?.content?.parts ?? []).flatMap((p) => (p.functionCall ? [p.functionCall] : []))
      return calls.length ? calls : undefined
    },
    ...(candidates ? { candidates } : {}),
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
