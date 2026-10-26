---
"@botmesh/core": minor
---

Interactions on transports with `capabilities.interactionsRequireAck` (Discord) are now acknowledged by the core, as the `IProvider` contract always said: exactly one ack per interaction, the one from `ctx.acknowledge(text)` when the handler asks first, otherwise a deferred ack (`{ defer: true }`) before the context's first send, 500 ms before `respondBy`, or when routing ends. A later `ctx.acknowledge(text)` sends `text` as a normal reply. Interactions past their deadline (replays) are not acked, and a failing automatic ack is logged without blocking the reply. Transports without the capability are unchanged. `MockProvider` gains the `interactionsRequireAck` option and `interaction(data, { respondBy })`.
