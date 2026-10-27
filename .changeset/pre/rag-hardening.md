---
"@botmesh/rag": patch
---

Hardening before 1.0:

- A Markdown heading padded with thousands of spaces no longer freezes the process (the heading regex backtracked cubically; a 8 000-space line took minutes). Headings are parsed in linear time, and a trailing `#` that belongs to the title is kept (`## C#` stays `C#`; only a closing sequence after a space is stripped).
- Changing the embedder no longer loses data: documents added at runtime and, without `documents`, a prebuilt index are embedded again with the new embedder instead of being dropped (the prebuilt index used to be served empty). The switch is reported to `onError` as `RagError('EMBEDDER_CHANGED')` and the old file is kept as `<persistPath>.previous` before it is overwritten.
- Save failures are typed: an index that cannot be saved while it loads (read-only file or directory) is reported to `onError` as `RagError('PERSIST_FAILED')` and served from memory, instead of `ready()`/`retrieve()` rejecting with a raw `EPERM`; an explicit change (`addText`, `addDocuments`, `removeDocument`, `save()`) that cannot be saved rejects with `PERSIST_FAILED` (the file system error is its `cause`). New `RagErrorCode`s `PERSIST_FAILED` and `EMBEDDER_CHANGED`.
- JSON nested deeper than 64 levels fails with `RagError('LOAD_FAILED')` instead of a raw stack overflow, and a long word cut by the chunker never splits an emoji or other surrogate pair.
- Clearer errors: `documents` that is not an array, a non-finite `minScore`, an invalid `maxFileBytes`, a per-call `topK`/`minScore` that is not valid, `addText()` without `text` or `source`, a custom `Embedder` without an `id` and an unknown embeddings provider all fail with `INVALID_OPTIONS` and say what to pass. A failed embedding request names the endpoint origin (never its path or query) and the network error code (`ECONNREFUSED`, `TIMEOUT`...).
- `retrieve()` returns copies of the chunk metadata, so mutating a hit no longer changes the index, and an index file without `hash` fields is repaired on load.
