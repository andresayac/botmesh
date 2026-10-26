---
"@botmesh/wa-gateway-kit": patch
"@botmesh/evolution": patch
"@botmesh/wppconnect": patch
---

Hardening of the WhatsApp REST gateway kit: `gatewayBaseUrl()` rejects credentials, query strings and fragments (and masks credentials in the message); `resolveHttpPolicy()` and `WaIdentityStore` (`identityCacheSize`) validate their numbers with a `TypeError`; `resolveMedia()` only hands `http(s)` URLs to the gateway (a `{ url }` with a local path or `file:` URL is read and sent inline, `data:` URIs are decoded) and rejects malformed sources with `UnsupportedContentError`; `restCall()` explains a 3xx answer and reports invalid URLs and unserializable bodies as `ProviderError`; `parseRetryAfter()` follows RFC 9110; `describeErrorBody()` always caps at 300 characters; `normalizeJid()` is idempotent.
