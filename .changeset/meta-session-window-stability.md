---
'@botmesh/meta': minor
---

Session-window API stability: what an app configures and queries (`SessionWindowManager` constructor, `forScope`, `state`, `isOpen`, `expiresAt`, `pending`, `clearPending`; `SessionWindowOptions`; `SessionWindowStore` and `MemorySessionWindowStore`; the report and reopen types; `SessionWindowReopenedError`; the constants) stays public and covered by semver. The hooks the provider drives (`SessionWindowManager.send`, `noteInbound`, `noteFailedStatus`) and the `RawSend` type are now `@experimental` and may change in a minor release. No runtime change. The provider calls graph-core's `checkGraphSignature` with the new options object.
