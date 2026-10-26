---
'@botmesh/ai': patch
---

Hardening found by an end-to-end review of `@botmesh/ai`:

- `bot.stop()` now aborts every model call still in flight: the autoreply turns (one-shot and streamed), the background memory extraction and the calls user handlers make through `ctx.tools.ai` (`ask`, `generate`, `stream`, `replyInChat`, `streamReplyInChat`, `runTools`). Those calls reject with an `AbortError`, even when the provider ignores its abort signal, so a slow or hung provider no longer answers into a stopped bot nor keeps the process alive for up to `timeoutMs` (forever with `0`). Calls made after a restart work as usual.
- Whitespace-only text messages are no longer sent to the model.
- `aiPlugin()` validates its numeric options when the config is built and throws a `RangeError`/`TypeError` naming the option: `timeoutMs`, `toolTimeoutMs`, `rag.timeoutMs` and each tool's `timeoutMs` must be finite and at most 2^31-1 ms (a `NaN` or larger value used to fire after 1 ms), `maxTokens` a positive integer, `context.maxMessages` a non-negative integer (`NaN` never trimmed the history), `maxSteps` a finite number, `dedupe.windowMs` finite, `toolConfirm.timeout` a valid duration (a typo used to cancel every confirmation silently), and every tool needs a `handler`. Values that worked before keep working (`0` or a negative timeout disables it, `maxSteps` below 1 means 1).
- With `provider: 'openai'` or `'ollama'` and no `model`, the plugin logs a warning at install instead of failing silently on the first message. Provider error messages are now in English and say how to fix the problem (unknown provider, missing SDK, missing model, Ollama HTTP errors).
- Confirmation prompts: argument names coming from the model are shown on one line and clipped, so a crafted key can no longer add lines (for example a fake "Do you confirm?") to the prompt.
- Tool arguments are always validated as an object, also when a JSON Schema omits the top-level `type`.
- OpenAI-compatible tool calls without an `id` get a synthesized one, so their results still match.
- `formatMarkdown`: a bare URL right before a Markdown link no longer leaks an internal placeholder character into the message, and the `'html'` format only turns `http(s)`, `mailto:` and `tel:` URLs into links (a `javascript:` or `data:` link is kept as text).
