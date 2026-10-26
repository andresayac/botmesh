import type { AIProvider, GenerateInput, GenerateResult, AIProviderConfig, AIChatMessage } from '../types.js'
import type { AIToolCall } from '../tools/types.js'
import { endStream } from './streamEnd.js'

type ChatMessage = Record<string, unknown>

/**
 * The part of an OpenAI client (`openai`, or any OpenAI-compatible SDK) the provider uses:
 * `chat.completions.create`, which returns a completion, or an async iterable of chunks
 * when called with `stream: true`. The request/response shapes are written inline (their
 * names, such as `OpenAIChatCompletion`, live in `@botmesh/ai/internal`); only the fields
 * the provider reads are listed.
 */
export interface OpenAILike {
  chat: {
    completions: {
      create(args: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<{
        choices: Array<{
          /** `refusal` is set (and `content` null) when the model declined to answer. */
          message?: {
            content?: string | null
            tool_calls?: Array<{ id: string; type?: string; function: { name: string; arguments: string } }>
            refusal?: string | null
          }
          finish_reason?: string
        }>
        model: string
        usage?: { prompt_tokens: number; completion_tokens: number }
      } | AsyncIterable<{
        choices: Array<{ delta?: { content?: string | null; refusal?: string | null }; finish_reason?: string | null }>
      }>>
    }
  }
}

type OpenAICreateResult = Awaited<ReturnType<OpenAILike['chat']['completions']['create']>>
/** Request options of {@link OpenAILike} calls (no semver: `@botmesh/ai/internal`). */
export type OpenAIRequestOptions = NonNullable<Parameters<OpenAILike['chat']['completions']['create']>[1]>
/** A non-streamed chat completion (no semver: `@botmesh/ai/internal`). */
export type OpenAIChatCompletion = Exclude<OpenAICreateResult, AsyncIterable<unknown>>
/** One choice of {@link OpenAIChatCompletion} (no semver: `@botmesh/ai/internal`). */
export type OpenAIChoice = OpenAIChatCompletion['choices'][number]
/** One tool call of {@link OpenAIChoice} (no semver: `@botmesh/ai/internal`). */
export type OpenAIToolCall = NonNullable<NonNullable<OpenAIChoice['message']>['tool_calls']>[number]
/** One streamed chunk (no semver: `@botmesh/ai/internal`). */
export type OpenAIStreamChunk = Extract<OpenAICreateResult, AsyncIterable<unknown>> extends AsyncIterable<infer C> ? C : never

export interface OpenAIProviderOptions {
  /** Provider display name (defaults to 'openai'; presets pass their own). */
  name?: string
  /**
   * Which field carries the output-token cap. Current OpenAI chat models
   * (o-series, gpt-5 family) reject `max_tokens` and need `max_completion_tokens`;
   * nearly every OpenAI-compatible clone wants plain `max_tokens`.
   */
  maxTokensField?: 'max_tokens' | 'max_completion_tokens'
}

export class OpenAIProvider implements AIProvider {
  readonly name: string
  private callSeq = 0
  private readonly maxTokensField: 'max_tokens' | 'max_completion_tokens'
  constructor(
    private client: OpenAILike,
    private cfg: AIProviderConfig,
    opts: OpenAIProviderOptions = {},
  ) {
    this.name = opts.name ?? 'openai'
    this.maxTokensField = opts.maxTokensField ?? 'max_completion_tokens'
  }

  private messagesFor(input: GenerateInput): ChatMessage[] {
    const out: ChatMessage[] = input.system ? [{ role: 'system', content: input.system }] : []
    for (const m of input.messages) out.push(...toOpenAIMessages(m))
    return out
  }
  private model(input: GenerateInput): string {
    const m = input.model ?? this.cfg.model
    if (!m) throw new Error(`${this.name}: the provider needs a \`model\` (it has no default): set aiPlugin({ model: '...' }) or pass one per call`)
    return m
  }
  private baseArgs(input: GenerateInput): Record<string, unknown> {
    const args: Record<string, unknown> = {
      model: this.model(input),
      messages: this.messagesFor(input),
      [this.maxTokensField]: input.maxTokens ?? input.defaultMaxTokens ?? this.cfg.maxTokens ?? 1024,
    }
    if (input.tools?.length) {
      args.tools = input.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }))
    }
    return args
  }

  private reqOpts(input: GenerateInput): OpenAIRequestOptions | undefined {
    return input.signal ? { signal: input.signal } : undefined
  }

  async generate(input: GenerateInput): Promise<GenerateResult> {
    const res = (await this.client.chat.completions.create(this.baseArgs(input), this.reqOpts(input))) as OpenAIChatCompletion
    const choice = res.choices?.[0]
    // Some OpenAI-compatible gateways answer an upstream failure with HTTP 200 and `{ error }`.
    if (!choice) {
      const error = (res as { error?: { message?: unknown } | string }).error
      if (error) {
        const message = typeof error === 'string' ? error : String(error.message ?? JSON.stringify(error))
        throw new Error(`${this.name}: ${message}`)
      }
    }
    const toolCalls: AIToolCall[] = (choice?.message?.tool_calls ?? [])
      .filter((c) => typeof c.function?.name === 'string')
      // Some OpenAI-compatible servers omit the call id: synthesize one so results still match.
      .map((c) => ({ id: c.id || `call_${++this.callSeq}`, name: c.function.name, args: parseArguments(c.function.arguments) }))
    // A declined answer comes as `message.refusal` (content null): report it like the
    // other providers do, so the autoreply answers `refusalMessage`.
    const refused = !!choice?.message?.refusal && !choice.message.content && !toolCalls.length
    return {
      text: choice?.message?.content ?? '',
      model: res.model,
      stopReason: refused ? 'refusal' : choice?.finish_reason,
      usage: res.usage ? { input: res.usage.prompt_tokens, output: res.usage.completion_tokens } : undefined,
      ...(toolCalls.length ? { toolCalls } : {}),
    }
  }

  async *stream(input: GenerateInput): AsyncIterable<string> {
    // Streaming is text-only: tool definitions are not sent.
    const { tools: _tools, ...textOnly } = input
    const s = (await this.client.chat.completions.create({
      ...this.baseArgs(textOnly),
      stream: true,
    }, this.reqOpts(input))) as AsyncIterable<OpenAIStreamChunk>
    let stopReason: string | undefined
    let refused = false
    for await (const chunk of s) {
      // Some compatible servers send keep-alive / usage chunks without `choices`.
      const choice = chunk.choices?.[0]
      if (choice?.delta?.refusal) refused = true
      const d = choice?.delta?.content
      if (d) yield d
      stopReason = choice?.finish_reason ?? stopReason
    }
    endStream(input, { stopReason: refused ? 'refusal' : stopReason })
  }
}

/** Parse a function-call `arguments` JSON string; an unparseable payload is passed raw (validation reports it). */
function parseArguments(raw: string | undefined): unknown {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

/** Map a provider-neutral turn to OpenAI chat-completions messages (a tool turn → one message per result). */
function toOpenAIMessages(m: AIChatMessage): ChatMessage[] {
  if (m.role === 'tool') {
    return m.results.map((r) => ({ role: 'tool', tool_call_id: r.callId, content: r.content }))
  }
  if (m.role === 'assistant' && m.toolCalls?.length) {
    return [{
      role: 'assistant',
      content: m.content || null,
      tool_calls: m.toolCalls.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
      })),
    }]
  }
  return [{ role: m.role, content: m.content }]
}
