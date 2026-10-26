---
"@botmesh/wa-gateway-kit": patch
"@botmesh/evolution": patch
"@botmesh/wppconnect": patch
---

Hardening of the WhatsApp REST gateway kit: `gatewayBaseUrl()` rejects credentials, query strings and fragments (and masks credentials in the message); `resolveHttpPolicy()` and `WaIdentityStore` (`identityCacheSize`) validate their numbers with a `TypeError`; `resolveMedia()` only hands `http(s)` URLs to the gateway (a `{ url }` must be `http(s)` or a base64 `data:` URI, which is sent inline; a local path or `file:` URL in `{ url }` rejects with `UnsupportedContentError` and is never read, so send local files as `{ path }` or a plain path string) and rejects malformed sources with `UnsupportedContentError`; `restCall()` explains a 3xx answer and reports invalid URLs and unserializable bodies as `ProviderError`; `parseRetryAfter()` follows RFC 9110; `describeErrorBody()` always caps at 300 characters; `normalizeJid()` is idempotent and runs in linear time.
