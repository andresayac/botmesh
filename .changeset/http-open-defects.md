---
'@botmesh/http': patch
---

- `isPrivateAddress` (and so `secureFetch`) now judges the IPv4 embedded in an IPv4-translated IPv6 address (`::ffff:0:a.b.c.d`, RFC 2765), so `::ffff:0:127.0.0.1` or `::ffff:0:10.0.0.1` are blocked like their IPv4 forms.
- `timeoutMs` now also bounds reading the response body when a caller-supplied `fetch` ignores the abort signal: the call rejects with the `TIMEOUT` error instead of waiting forever for a body that never ends, also after a non-2xx status.
