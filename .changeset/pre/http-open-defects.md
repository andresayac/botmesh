---
'@botmesh/http': patch
---

- `isPrivateAddress` (and so `secureFetch`) now judges the IPv4 embedded in an IPv4-translated IPv6 address (`::ffff:0:a.b.c.d`, RFC 2765), so `::ffff:0:127.0.0.1` or `::ffff:0:10.0.0.1` are blocked like their IPv4 forms.
- `timeoutMs` now bounds the whole request even when a caller-supplied `fetch` or `resolver` ignores the abort signal: DNS resolution, waiting for the response headers and reading the body (also after a non-2xx status). The call rejects with the `TIMEOUT` error (or the caller's `signal` reason) instead of waiting forever; a response that arrives after the deadline is released unread.
