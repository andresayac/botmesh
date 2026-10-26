---
'@botmesh/core': minor
---

Stable-readiness leftovers:

- **Breaking (messages):** the default messages of `OutsideSessionWindowError` and `RecipientUnreachableError` no longer include the chat id (it ended up in logs); it stays on `error.chatId`.
- `ChaosProvider.selfId` and `RecordingProvider.selfId` (`@botmesh/core/testing`) return `null` instead of `undefined`, so they implement `IProvider` under `exactOptionalPropertyTypes` (TS2420).
- `ctx.delete()` before `start()` or after `stop()` rejects with `BotNotRunningError` (`operation: 'delete'`).
- `IMessageContext.acknowledge` is typed as a required method (it always existed at runtime).
- A provider event whose `kind` is an unknown string is ignored (debug log) for forward compatibility; a non-string `kind` is still an `InvalidProviderEventError`.
- `lang` and `i18n.defaultLocale` may name the same language with different precision (`'es'` / `'es-MX'`, the more specific one wins).
- With `telemetry.ids: 'raw'` and no `logIds`, log lines keep hashing ids.
- The TypeDoc reference documents `@botmesh/core`, `@botmesh/core/spi` and `@botmesh/core/testing`.
