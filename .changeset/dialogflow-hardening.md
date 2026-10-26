---
"@botmesh/dialogflow": patch
---

Hardening before 1.0. In groups, `sessionScope` now defaults to `'participant'` (one Dialogflow session per member, like conversations; `'chat'` keeps one per group). Mistyped options (`minConfidence` outside 0–1, unknown `fulfillment` or `sessionScope`, empty `commandPrefix`, malformed `location`, empty intent names) throw `DialogflowError` with `code: 'INVALID_CONFIG'` at `bot.plug()`. A `401` drops the cached access token and retries once (`AccessTokenSource.invalidate?(token)`, implemented by `ServiceAccountTokenSource`). New `maxTextLength` option (default 256, the API limit): longer texts are not sent. A throwing `filter` is reported through `onError` instead of breaking the pipeline. ES platform-specific responses no longer duplicate the default ones in `messages`, and `parameters` drops `__proto__`/`constructor`/`prototype` keys.
