---
'@botmesh/http': patch
---

`secureFetch` now sends a `FormData` body as real `multipart/form-data`. The package's own undici did not recognize Node's global `FormData` and sent the string `"[object FormData]"` with `Content-Type: text/plain`, so every multipart upload made through `secureFetch` (for example TikTok image uploads) reached the server empty. The body is encoded with the runtime's encoder and sent with its boundary; a caller `Content-Type` is replaced because the boundary must match the body. Bodies sent through a custom `fetch` are untouched.
