---
'@botmesh/core': minor
'@botmesh/meta': minor
'@botmesh/telegram': minor
---

One rule for unsupported operations, and bounded waits.

**Breaking:** an operation the transport cannot perform is now absent (the optional `IProvider` method is not defined and its capability flag is `false`) instead of a silent no-op:

- `@botmesh/meta`: `CloudAPIProvider#typing()` and `#deleteMessage()` are removed (they did nothing).
- `@botmesh/telegram`: `TelegramProvider#markRead()` is removed (bots get no read receipts; it did nothing).
- `@botmesh/core/testing`: `MockProvider` reports `capabilities.typing` / `readReceipts` as `true` only when a `typing()` / `markRead()` method exists (a subclass or a test that adds one gets the flag; assigning the flag still overrides it). Before, both were `true` with no method behind them, which every `ctx` helper already treated as unsupported.

`ctx.typing()`, `ctx.markRead()` and `ctx.delete()` stay no-ops on those channels. New `checkCapabilityContract` / `assertCapabilityContract` (and `CapabilityContractError`) in `@botmesh/core/testing` check that a provider's capability flags agree with its methods and that its text limits are valid.

Also:

- `RateLimitedError.retryAfterMs` is capped at 24 h, so no wait built on it overflows `setTimeout` (which fires at once past ~24.8 days).
- `@botmesh/telegram`: a 429 `retry_after` is clamped (missing/invalid → 1 s, at most 24 h); a huge value used to make the poll loop spin.
- `@botmesh/meta`: a local media path that cannot be read rejects with `UnsupportedContentError` (the fs error as `cause`) instead of a raw `ENOENT`.
