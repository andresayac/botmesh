---
'@botmesh/graph-core': patch
---

`readGraphResponse` maps an HTTP 413 answer (a request or media upload over Graph's size limit, usually with no specific error code) to `PayloadTooLargeError` instead of a generic `ProviderError`. A specific Graph code in the body (rate limit, window, unreachable) still wins. This applies to the WhatsApp Cloud API, Messenger and Instagram providers.
