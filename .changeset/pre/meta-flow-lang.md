---
'@botmesh/meta': minor
---

New `lang` option on `CloudAPIProvider`: the language of the default submit label `publishForm()` bakes into a WhatsApp Flow (default `'en'`, the core default; set it to your `BotConfig.lang`). `publishForm(def, { lang })` overrides it per Flow and `flowJson.lang` still wins over both. `phoneNumberId` is typed `string | number` (a safe integer was already accepted at run time). Deprecated, removal planned for v3: `toProviderError` (use `toGraphError` from `@botmesh/graph-core`), `GraphClient`, the re-exported `verifyChallenge`/`verifySignature` and the `debug` option.
