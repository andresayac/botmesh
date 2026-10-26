---
'@botmesh/graph-core': minor
---

New `graphRequest(url, init, { timeoutMs?, fetch?, chatId?, contentKind? })` and `DEFAULT_GRAPH_REQUEST_TIMEOUT_MS` (60 s): one Graph API call with a client timeout that covers the body too, errors mapped by `readGraphResponse`, and transport failures or timeouts rejected with a `ProviderError` that never quotes the URL or the token. The Messenger and Instagram providers use it for their `requestTimeoutMs` option.
