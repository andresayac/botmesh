---
'@botmesh/core': minor
'@botmesh/baileys': minor
'@botmesh/meta': minor
'@botmesh/telegram': minor
---

`timestamp` is epoch milliseconds on every channel.

**Breaking:** `InboundMessage.timestamp`, `InboundInteraction.timestamp`, `DeliveryStatus.timestamp` and `ctx.timestamp` are epoch **milliseconds** everywhere. `@botmesh/baileys`, `@botmesh/meta` and `MockProvider` (`@botmesh/core/testing`) used to emit epoch seconds; drop any `* 1000` in your code (`new Date(ctx.timestamp)` is now right).

- A missing or invalid transport time is the receive time (`Date.now()`), never `0` (Baileys and the Cloud API emitted `0`).
- `@botmesh/telegram`: a callback query (button press) carries the receive time; the Bot API sends no press time and the date of the message holding the keyboard could be days old.
- `@botmesh/core` still converts a value below `1e12` from a third-party provider that emits seconds, for `ctx.timestamp` and the message log (soft path), and the message log keeps the receive time for a second-precision stamp of the current second whether it arrives in seconds or ms.
- New contract helpers in `@botmesh/core/testing`: `checkInboundContract` / `assertInboundContract` (and `InboundContractError`) check epoch-ms timestamps, `respondBy`, `body`, `mentions` and the message type of a provider's events.
