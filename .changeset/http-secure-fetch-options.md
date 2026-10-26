---
'@botmesh/http': minor
---

**Breaking (types only):** `SecureFetchOptions` no longer extends `RequestInit`. It holds `method`, `headers`, `body` and `signal` plus the policy options (`allowHttp`, `allowPrivateHosts`, `timeoutMs`, `maxBytes`, `maxRedirects`, `resolver`, `fetch`). `redirect` is gone: it was always overridden with `'manual'`; use `maxRedirects`. Other `RequestInit` fields (`cache`, `keepalive`...) still type-check through a deprecated overload of `secureFetch`/`fetchBuffer` (`LegacySecureFetchOptions`) and are still forwarded to `fetch` until stable. `resolvePublicHost` is renamed `resolveHost` (it resolves any host; `assertSafeTarget` judges the answer); the old name stays as a deprecated alias.
