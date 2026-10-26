---
"@botmesh/telegram": patch
"@botmesh/graph-core": patch
"@botmesh/instagram": patch
"@botmesh/twilio": patch
"@botmesh/gupshup": patch
"@botmesh/evolution": patch
"@botmesh/wppconnect": patch
"@botmesh/wa-gateway-kit": patch
"@botmesh/server": patch
---

README fixes: the `@botmesh/server` examples mount `TelegramProvider` without the `body: 'text'` it no longer needs; `@botmesh/graph-core` names Messenger and Instagram as its other dependents; Twilio explains that the core splits text over 1600 characters; Gupshup's `webhookTokenParam` is also read by `ingest()` with a URL; Evolution says poll votes are not emitted as `'poll'` events yet (it named a `poll-vote` event that does not exist); and the prerelease notes of the packages first published in the beta no longer mention an older alpha.
