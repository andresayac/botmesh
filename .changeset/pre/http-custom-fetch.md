---
'@botmesh/http': patch
---

A caller-supplied `fetch` works again: `secureFetch(url, { fetch: globalThis.fetch })` used to fail with an opaque `fetch failed` (`UND_ERR_INVALID_ARG`) because the pinned connection belongs to this package's undici. A custom `fetch` now gets no pinned dispatcher; URLs, redirects and DNS answers are still validated, and the docs say that DNS-rebinding protection is then up to that `fetch`. `isPrivateAddress()` also treats fully-qualified names (`localhost.`, `foo.localhost.`) as private.
