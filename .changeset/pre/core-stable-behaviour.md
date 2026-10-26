---
'@botmesh/core': major
---

**Breaking (2.0 stable behaviour decisions).** See the "Migrating to 2.0" guide (`docs/guide/migration-2.md`).

- **Built-in texts default to English.** The default locale is `'en'` (timeouts, "too many attempts", wait prompts, slash-command replies, form hints; the form skip word is `skip`). The Spanish texts are still bundled: the new `BotConfig.lang: 'es'` restores them without turning on per-user language resolution. `lang` and `i18n.defaultLocale` must agree when both are set.
- **`retries` always counts attempts after the first.** New `maxAttempts` (total answers, first included; default 3 as before) on waits (`ask`, `waitText`, `choose`, …) and `flow().form()`. `retries: N` now means `maxAttempts: N + 1` (during the alphas it meant N in total): rename `retries: N` to `maxAttempts: N` to keep the old budget. Conflicting or invalid values throw a `TypeError` (in flows, when the flow is defined). `bot.broadcast()` takes `retries` (same meaning; `maxRetries` is a deprecated alias).
- **Sends need a running bot.** Sends, edits and stream updates before `bot.start()` (or after a failed start) and after `bot.stop()` reject with the new `BotNotRunningError` (`code: 'BOT_NOT_RUNNING'`) and never reach the provider. Sends are accepted from the moment the transport starts connecting, so a `'ready'` listener can send. Concurrent `start()`/`stop()` calls run one at a time in call order.
- **Rate-limited `ctx` sends retry once.** A `ctx` send rejected with a `RateLimitedError` asking for at most 5 s is retried once (it was twice); `BotConfig.rateLimitRetry: { retries, maxWaitMs } | false` configures it.
- **Flows fail when they are defined:** `.choose(prompt, {})`, non-object options, an option without a label and an empty state key in `.ask()`/`.choose()` throw a `TypeError`.
- **Invalid provider events** (not an object, unknown `kind`, a message without `chatId`/`ref`/`senderId`/`type`/`body`, …) are dropped and reported once on `'error'` as the new `InvalidProviderEventError`, instead of a generic `TypeError`.
- **A before-hook calling `next()` twice** keeps the first dispatch (later calls return the same promise) and the misuse is reported on `'error'`; the message used to be dropped. `HookSystem` takes `{ report }`.
- **Ids in logs are hashed.** The bot's own log lines carry chat/sender ids through the new `BotConfig.logIds` (`'hash'` default, the same HMAC as trace spans; `'raw'`, `'omit'`).
- **`MemoryCoordinationHub`** evicts idle chats beyond `maxIdleKeys` (default 10,000); fences stay monotonic and a re-created chat reports `previousHolder: null`. New `hub.size` / `hub.maxIdleKeys`.
- **File journals:** a corrupt line in the middle of the append log is refused on open with `code: 'APPEND_LOG_CORRUPT'` instead of silently dropping the later entries. New `FileDurability.open(path, { fsync: true })` flushes each snapshot before the rename (and defaults `appendLog.fsync`).
