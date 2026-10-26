import type { AIProvider, AIConfig } from '../types.js'
import { loadModule } from './loadModule.js'
import { AnthropicProvider } from './anthropic.js'
import type { AnthropicLike } from './anthropic.js'
import { OpenAIProvider } from './openai.js'
import type { OpenAILike } from './openai.js'
import { OllamaProvider } from './ollama.js'
import { GeminiProvider, fromGoogleGenAI } from './gemini.js'
import type { GeminiLike, GoogleGenAILike } from './gemini.js'
import { PRESETS, isPreset } from './presets.js'

/**
 * Resolve the configured AI backend. Preset names (deepseek, qwen, glm, kimi,
 * groq, openrouter, mistral, grok, together) map to the OpenAI client pointed
 * at that vendor's endpoint — no extra dependency beyond `openai`. API keys
 * fall back to each preset's conventional env var.
 */
/**
 * Token-cap field for `provider: 'openai'`: OpenAI itself (and Azure OpenAI) wants
 * `max_completion_tokens`; any other `baseUrl` is an OpenAI-compatible server, and those
 * nearly all want `max_tokens`.
 */
function openAIMaxTokensField(baseUrl: string | undefined): 'max_tokens' | 'max_completion_tokens' {
  if (!baseUrl) return 'max_completion_tokens'
  let host: string
  try { host = new URL(baseUrl).hostname.toLowerCase() } catch { return 'max_tokens' }
  return host === 'api.openai.com' || host.endsWith('.openai.azure.com') ? 'max_completion_tokens' : 'max_tokens'
}

export async function resolveProvider(cfg: AIConfig): Promise<AIProvider> {
  const name = cfg.provider ?? 'anthropic'

  if (isPreset(name)) {
    const preset = PRESETS[name]
    const mod = await loadModule<{ default: new (o: { apiKey?: string; baseURL?: string }) => OpenAILike }>(
      'openai',
      'pnpm add openai',
    )
    const apiKey = cfg.apiKey ?? process.env[preset.env]
    const baseURL = cfg.baseUrl ?? preset.baseUrl
    const client = new mod.default({ apiKey, baseURL })
    // Default the model to the preset's unless the caller overrode it.
    const presetCfg: AIConfig = cfg.model ? cfg : { ...cfg, model: preset.model }
    return new OpenAIProvider(client, presetCfg, { name, maxTokensField: cfg.maxTokensField ?? preset.maxTokensField })
  }

  switch (name) {
    case 'anthropic': {
      const mod = await loadModule<{ default: new (o: { apiKey?: string; baseURL?: string }) => AnthropicLike }>(
        '@anthropic-ai/sdk',
        'pnpm add @anthropic-ai/sdk',
      )
      // `baseUrl` (a gateway / proxy) only when set: otherwise the SDK keeps ANTHROPIC_BASE_URL or its default.
      return new AnthropicProvider(new mod.default({ apiKey: cfg.apiKey, ...(cfg.baseUrl ? { baseURL: cfg.baseUrl } : {}) }), cfg)
    }
    case 'openai': {
      const mod = await loadModule<{ default: new (o: { apiKey?: string; baseURL?: string }) => OpenAILike }>(
        'openai',
        'pnpm add openai',
      )
      return new OpenAIProvider(new mod.default({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }), cfg, {
        maxTokensField: cfg.maxTokensField ?? openAIMaxTokensField(cfg.baseUrl),
      })
    }
    case 'ollama':
      return new OllamaProvider(cfg)
    case 'gemini':
      return new GeminiProvider(await resolveGeminiClient(cfg), cfg)
    default:
      throw new Error(`Unknown AI provider "${String(name)}". Use one of: ${['anthropic', 'openai', 'ollama', 'gemini', ...Object.keys(PRESETS)].join(', ')}`)
  }
}

/** Loads an optional peer SDK by name (`loadModule` in production, a stub in tests). */
type ModuleLoader = (name: string, installHint: string) => Promise<unknown>

/** `loadModule`'s "not installed" error (any other load failure is rethrown as is). */
const isNotInstalled = (err: unknown): boolean => err instanceof Error && /which is not installed/.test(err.message)

let warnedLegacyGemini = false

/**
 * The Gemini client: `@google/genai` when installed (with `baseUrl` as its
 * `httpOptions.baseUrl`), else the deprecated `@google/generative-ai` with a one-time
 * DeprecationWarning. The key falls back to GEMINI_API_KEY, then GOOGLE_API_KEY.
 */
export async function resolveGeminiClient(cfg: AIConfig, load: ModuleLoader = loadModule): Promise<GeminiLike> {
  const apiKey = cfg.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY
  let genai: { GoogleGenAI: new (o: { apiKey?: string; httpOptions?: { baseUrl: string } }) => GoogleGenAILike }
  try {
    genai = (await load('@google/genai', 'pnpm add @google/genai')) as typeof genai
  } catch (err) {
    if (!isNotInstalled(err)) throw err
    let legacy: { GoogleGenerativeAI: new (apiKey?: string) => GeminiLike }
    try {
      legacy = (await load('@google/generative-ai', 'pnpm add @google/genai')) as typeof legacy
    } catch (legacyErr) {
      if (isNotInstalled(legacyErr)) throw err
      throw legacyErr
    }
    if (!warnedLegacyGemini) {
      warnedLegacyGemini = true
      process.emitWarning('@google/generative-ai is deprecated upstream: install @google/genai (pnpm add @google/genai) and @botmesh/ai uses it instead.', { type: 'DeprecationWarning', code: 'BOTMESH_AI_GEMINI_LEGACY_SDK' })
    }
    return new legacy.GoogleGenerativeAI(apiKey)
  }
  return fromGoogleGenAI(new genai.GoogleGenAI({ apiKey, ...(cfg.baseUrl ? { httpOptions: { baseUrl: cfg.baseUrl } } : {}) }))
}
