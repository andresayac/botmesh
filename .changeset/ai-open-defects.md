---
'@botmesh/ai': minor
---

Fixes for the low-severity defects left open by the alpha exit review:

- `toGeminiSchema` now walks `anyOf`/`oneOf`/`allOf`: `oneOf` becomes `anyOf`, a one-element `allOf` is merged, unsupported keywords are dropped at every level, and a `null` alternative (zod `.nullable()`, or `type: [T, 'null']`) becomes `nullable: true`. Tool schemas with nullable fields no longer get rejected by Gemini.
- **Behaviour change:** `provider: 'openai'` with a `baseUrl` that is not OpenAI (`api.openai.com`) or Azure OpenAI (`*.openai.azure.com`) now sends the output-token cap as `max_tokens`, which OpenAI-compatible servers (vLLM, LM Studio, gateways) expect, instead of `max_completion_tokens`. The new `maxTokensField` option overrides the guess, for `'openai'` and for the presets. If you point `baseUrl` at a proxy in front of OpenAI with an o-series or gpt-5 model, set `maxTokensField: 'max_completion_tokens'`.
- `aiPlugin()` validates `memory.maxFactLength`, `memory.maxFacts` and `memory.ttl` and throws a `RangeError` naming the option (before, a bad `maxFactLength` silently dropped every fact, and a bad `ttl` only failed at `plug()`), and rejects an unknown `maxTokensField`.
- Confirmation prompts show argument names and values on one line also when they contain NEL (U+0085) or the line/paragraph separators, and drop bidi control characters.
- Aborting a call with your own signal (`/reset` of an autoreply turn, or `signal` passed to `ctx.tools.ai` methods) now releases the caller with an `AbortError` even when the provider ignores the signal, instead of waiting for `timeoutMs` (or forever with `0`).
- `timeoutMs` is documented as a total deadline for non-streaming calls and an idle timeout between chunks when streaming.

What to change when upgrading: "Upgrade notes: channels and plugins" in the guide (`docs/guide/upgrade-channels-plugins.md`).
