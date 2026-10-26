/**
 * `@botmesh/ai` — multi-provider AI autoresponder plugin for `@botmesh/core`.
 *
 * Entries: this one (application API, semver), `@botmesh/ai/testing` (test doubles, semver)
 * and `@botmesh/ai/internal` (plugin helpers and SDK wire shapes, no semver).
 *
 * @packageDocumentation
 */
import type { AIClient } from './AIClient.js'

export { aiPlugin } from './plugin.js'
export type { AIPluginConfig } from './plugin.js'
export { AIClient, AITimeoutError } from './AIClient.js'
export type { AIClientOptions, AIToolCallOptions } from './AIClient.js'
export { ContextManager } from './ContextManager.js'
export type { ConvStore } from './ContextManager.js'
export { chatKeyOf } from './chatKey.js'
export { resolveProvider } from './providers/resolve.js'

// Providers and the client contracts they take (the wire shapes' names are in `/internal`)
export { AnthropicProvider } from './providers/anthropic.js'
export type { AnthropicLike } from './providers/anthropic.js'
export { anthropicModelSupport, type AnthropicModelSupport } from './providers/anthropicModels.js'
export { OpenAIProvider } from './providers/openai.js'
export type { OpenAIProviderOptions, OpenAILike } from './providers/openai.js'
export { OllamaProvider } from './providers/ollama.js'
export { GeminiProvider, fromGoogleGenAI } from './providers/gemini.js'
export type { GeminiLike, GeminiModelLike, GoogleGenAILike } from './providers/gemini.js'
export { LazyProvider } from './providers/LazyProvider.js'
export { PRESETS, isPreset } from './providers/presets.js'
export type { Preset, PresetName } from './providers/presets.js'
export type {
  AIProvider, AIProviderConfig, AIMessage, AIChatMessage, AIConfig, AIProviderName, GenerateInput, GenerateResult,
  AIStreamEndInfo, Effort, AIThinking, AIStreamConfig,
} from './types.js'

// Native tool / function calling
export { defineTool, AIToolCancelledError } from './tools/types.js'
export type {
  AITool, AIToolSet, AIToolContext, AIToolDefinition, AIToolCall, AIToolResult, AIToolEvent, AIToolEventType,
  AIToolLabels, ToolConfirmer, ToolConfirmRequest, ToolConfirmation, ToolConfirmReply, AIToolExecution, JSONSchema, SafeParseSchema, SafeParseResult, BivariantFn,
} from './tools/types.js'
export { AI_MESSAGES, AI_LOCALES, type AIMessageKey, type AITranslatable } from './i18n.js'
export { runToolLoop } from './tools/runner.js'
export type { ToolLoopOptions, ToolLoopResult } from './tools/runner.js'
export { confirmWith, classifyConfirmation, DEFAULT_YES, DEFAULT_NO } from './tools/confirm.js'
export type { ConfirmWithOptions, ConfirmVocabulary } from './tools/confirm.js'
export { argLines, summarizeValue } from './tools/present.js'
export type { ChatToolLedger } from './tools/ledger.js'
export { formatMarkdown, formatMarkdownStream } from './format.js'
export type { FormatMarkdownOptions, TextFormat } from './format.js'

// Long-term memory and RAG
export type { AIChatReply, AIAugmentStage, AIReplyOptions, AIStreamReplyOptions } from './AIClient.js'
export { MemoryManager } from './memory/MemoryManager.js'
export type { MemoryFact, AIMemoryConfig, AIMemoryExtractConfig, RememberOptions, UserDataAccessor } from './memory/MemoryManager.js'
export type { AIRetriever, AIRetrievedChunk, AIRagConfig, AICitedPassage } from './rag.js'

// Test doubles: their home is `@botmesh/ai/testing`.
export {
  /** @deprecated Import from '@botmesh/ai/testing'. This re-export goes away in the next major. */
  MockAIProvider,
  /** @deprecated Import from '@botmesh/ai/testing'. This re-export goes away in the next major. */
  type MockOptions,
  /** @deprecated Import from '@botmesh/ai/testing'. This re-export goes away in the next major. */
  type MockTurn,
} from './MockAIProvider.js'

/**
 * Augment `@botmesh/core` so `ctx.tools.ai` is typed as {@link AIClient} in
 * handlers (`bot.when`, `bot.onMessage`, `bot.command`, ...) — no casts needed.
 * It applies to any project that imports `@botmesh/ai`; the value exists at
 * runtime once `aiPlugin` is plugged into the Bot (and until it is unplugged).
 */
declare module '@botmesh/core' {
  interface DefaultTools {
    /** Injected by `aiPlugin` via `bot.provide('ai', client)`. */
    ai: AIClient
  }
}
