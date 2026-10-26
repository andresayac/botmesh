/**
 * Stand-in for `@botmesh/ai` used by the docs example tests (docs-examples-*.test.ts).
 * Everything is the real package; only `aiPlugin` is wrapped so the example's config
 * (provider, apiKey, model, persona...) is kept as written while the model calls go to
 * the scripted `MockAIProvider` the test installs. No SDK is loaded and nothing touches
 * the network.
 */
import { aiPlugin as realAiPlugin, type AIPluginConfig, type AIProvider } from '../../src/index.js'

export * from '../../src/index.js'

interface DocsAIHarness {
  provider?: AIProvider
  configs: AIPluginConfig[]
}

/** The test sets `provider` and reads the configs the example passed to `aiPlugin`. */
export function docsAIHarness(): DocsAIHarness {
  const g = globalThis as { __botmeshDocsAI?: DocsAIHarness }
  g.__botmeshDocsAI ??= { configs: [] }
  return g.__botmeshDocsAI
}

export function aiPlugin(config: AIPluginConfig = {}): ReturnType<typeof realAiPlugin> {
  const harness = docsAIHarness()
  harness.configs.push(config)
  if (!harness.provider) throw new Error('docs example test: no MockAIProvider installed')
  return realAiPlugin({ ...config, instance: harness.provider })
}
