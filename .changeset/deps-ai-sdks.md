---
'@botmesh/ai': minor
---

**Breaking (defaults): current SDKs and models.**

- Gemini now uses `@google/genai` (`^2.0.0`, a new optional peer dependency), the SDK Google maintains. When it is not installed, the deprecated `@google/generative-ai` is still used, with a one-time `DeprecationWarning`. `baseUrl` becomes the SDK's `httpOptions.baseUrl`. New export `fromGoogleGenAI(client)` adapts a `GoogleGenAI` client (Gemini API or Vertex AI) for `new GeminiProvider()`. A blocked Gemini answer is reported as a refusal with both SDKs.
- Default models: `claude-opus-5-5` (was `claude-opus-4-8`), `gemini-3.8-flash` (was `gemini-2.0-flash`, shut down by Google), preset `grok` → `grok-4.7` (was `grok-2-latest`), preset `glm` → `glm-5.3` (was `glm-4-plus`). Default models are documented as outside semver; set `model` to pin one.
- The SDK peer ranges are verified at both ends: `@anthropic-ai/sdk` 0.68.0 and 1.x, `openai` 6.48.0 and 7.x, `@google/genai` 2.0.0 and 2.x (plain replies, tool calls and streaming against local fakes of each API).
- The package description now lists Gemini and the OpenAI-compatible presets.
