/**
 * `@botmesh/ai/internal` — the plugin's building blocks and the SDK wire shapes.
 *
 * Helpers the autoresponder, the tool loop, memory and RAG are made of (tool schema and
 * presentation helpers, the tool ledger, the memory-extraction parser, the RAG prompt and
 * citation helpers, the i18n lookup, the Gemini schema converter and their defaults), plus the
 * names of the request/response shapes of the SDK clients (`AnthropicMessage`,
 * `OpenAIChatCompletion`, `GeminiResponse`…; the client contracts themselves, `AnthropicLike`,
 * `OpenAILike`, `GeminiLike`, `GoogleGenAILike`, stay on the main entry). **No semver
 * guarantee:** any of them may change or disappear in a minor release. Applications use
 * `aiPlugin`, `AIClient` and the providers from `@botmesh/ai`; test doubles live in
 * `@botmesh/ai/testing`.
 *
 * @example
 * ```ts
 * import { toolDefinitions, citedChunks } from '@botmesh/ai/internal'
 * ```
 *
 * @packageDocumentation
 */

// i18n lookup
export { aiText } from './i18n.js'

// Tool loop defaults and helpers
export { defaultConfirmPrompt, DEFAULT_MAX_STEPS, DEFAULT_TOOL_TIMEOUT_MS } from './tools/runner.js'
export { toolDefinitions, parametersOf } from './tools/schema.js'
export { isAffirmative } from './tools/confirm.js'
export { humanizeName, toolTitle } from './tools/present.js'
export { ToolLedger, stableKey, DEFAULT_DEDUPE_WINDOW_MS, DEFAULT_LEDGER_RETENTION_MS } from './tools/ledger.js'

// Providers
export { toGeminiSchema } from './providers/gemini.js'
export { openAIMaxTokensField } from './providers/resolve.js'
export type {
  AnthropicRequestOptions, AnthropicMessage, AnthropicContentBlock, AnthropicUsage, AnthropicStreamEvent,
} from './providers/anthropic.js'
export type {
  OpenAIRequestOptions, OpenAIChatCompletion, OpenAIChoice, OpenAIStreamChunk, OpenAIToolCall,
} from './providers/openai.js'
export type {
  GeminiRequestOptions, GeminiResponse, GeminiUsage, GeminiFunctionCall, GeminiPart, GoogleGenAIResponse,
} from './providers/gemini.js'

// Memory
export { DEFAULT_MEMORY_NAMESPACE } from './memory/MemoryManager.js'
export { factsSchema, parseFacts } from './memory/extract.js'

// RAG
export { DEFAULT_RAG_INSTRUCTIONS, ragContextBlock, citedChunks, citedPassages, formatSources } from './rag.js'
