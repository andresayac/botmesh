# @botmesh/rag

Retrieval Augmented Generation for [`@botmesh/ai`](https://www.npmjs.com/package/@botmesh/ai): it loads your documents, chunks them, computes embeddings and gives the model the most relevant passages, **with citations**. No vector database: an in-memory cosine index with optional persistence to a JSON file.

- **Loaders:** Markdown (split by heading sections), text, JSON (one document per array element) and PDF (with the optional `pdf-parse` peer, loaded on demand). Directories are read recursively.
- **Chunking:** paragraphs, then sentences, then words, with overlap (`chunkSize`, `chunkOverlap`).
- **Interchangeable embeddings:** any OpenAI-compatible `/embeddings` API and Ollama over plain HTTPS (no SDK), or a deterministic local hashing embedder (tests, offline, small FAQs), or your own.
- **Index:** in-memory cosine, `topK`, `minScore`, filters; saved to JSON and, on restart, **only chunks that changed are re-embedded**.

## Install

```bash
pnpm add @botmesh/core @botmesh/ai @botmesh/rag
pnpm add pdf-parse   # optional: only to load PDF files
```

> **Prerelease.** Until the stable release, npm's `latest` tag can still point to an older build. Add the prerelease dist-tag to get the build these docs describe: `pnpm add @botmesh/core@beta @botmesh/ai@beta @botmesh/rag@beta` during the beta (`npm view @botmesh/rag dist-tags` lists the tags). Once stable, the plain command above works.

`@botmesh/rag` does not depend on `@botmesh/ai`: `aiPlugin` takes any object with `retrieve()`, and `createRag()` returns one. You can also use the retriever on its own (see [Direct usage](#direct-usage)).

## Quick start

```ts
import { aiPlugin } from '@botmesh/ai'
import { createRag } from '@botmesh/rag'

const rag = createRag({
  documents: ['./docs/faq.md', './docs/products.pdf', './docs/catalog.json'],
  embeddings: 'openai',          // 'local' | 'openai' | 'ollama' | { provider, ... } | your own Embedder
  topK: 3,
  persistPath: './data/rag-index.json',
})

bot.plug(aiPlugin({
  provider: 'openai',
  model: 'gpt-5-mini',                            // openai has no default model
  rag: { retriever: rag, appendSources: true },   // or simply `rag`
}))
// User: "how long does shipping take?"
// Bot:  "It takes 3 business days [1].\n\nSources: [1] docs/faq.md › Shipping"
```

`createRag()` is synchronous: the documents are loaded and embedded on the first `retrieve()`, and `aiPlugin` calls `warmup()` at install (an error is logged; it does not crash the process).

## Direct usage

```ts
import { formatContext } from '@botmesh/rag'

const hits = await rag.retrieve('payment methods', { topK: 2 })
// [{ text, score, source: 'docs/faq.md', section: 'Payments', citation: 'docs/faq.md › Payments', id, docId, index }]
const answer = await ctx.tools.ai.ask(`Context:\n${formatContext(hits)}\n\nQuestion: ${ctx.body}`)

await rag.addText('We are open on Sundays from 10 to 14.', { source: 'hours' })
await rag.addFiles(['./docs/new'])
await rag.removeDocument('hours')
await rag.save()
```

## Options

`createRag(options)` / `new Rag(options)`:

| Option | Default | Description |
| --- | --- | --- |
| `documents` | `[]` | File or directory paths (`.md`, `.mdx`, `.markdown`, `.txt`, `.json`, `.pdf`) and/or `{ id, text, source, format?, metadata? }` objects. Ingested on first use. |
| `embeddings` | `'local'` | See [Embeddings](#embeddings). |
| `chunkSize` | `1000` | Maximum characters per chunk. |
| `chunkOverlap` | `150` (at most a quarter of `chunkSize`) | Characters carried over from the previous chunk; must be smaller than `chunkSize`. |
| `topK` | `3` | Chunks returned by `retrieve()` (positive integer). |
| `minScore` | `0` | Minimum cosine score. |
| `persistPath` | — | JSON file for the index; vectors of unchanged chunks are reused across restarts. |
| `cwd` | `process.cwd()` | Base directory for relative paths. |
| `pdf` | `pdf-parse` peer | Your own PDF extractor: `async (bytes) => text`. |
| `maxFileBytes` | 20 MiB | Maximum bytes per loaded file. |
| `retryDelayMs` | `30000` | After a failed ingest, `retrieve()` rejects at once with the same error for this long. |
| `onError` | — | Non-fatal problems, e.g. a corrupt persisted index that was set aside and rebuilt. |

`retrieve(query, { topK, minScore, filter, signal })` overrides the defaults per call; `filter` receives each chunk (with its `metadata`).

## Embeddings

| Config | Detail |
| --- | --- |
| `'local'` (default) | `HashEmbedder` (512 dims): lexical, deterministic, no network. |
| `'openai'` / `{ provider: 'openai', apiKey, model, baseUrl, dimensions, batchSize }` | `POST {baseUrl}/embeddings`. `text-embedding-3-small` and `OPENAI_API_KEY` by default. Any compatible API works. |
| `'ollama'` / `{ provider: 'ollama', model, baseUrl }` | `POST {baseUrl}/api/embed`, `nomic-embed-text` on `http://localhost:11434` by default. |
| Custom `Embedder` | `{ id, embed(texts) }`. `id` (a non-empty string such as `'my-model:768'`) names the vector space in the persisted index. |

Requests go through [`@botmesh/http`](https://www.npmjs.com/package/@botmesh/http)'s `secureFetch` (anti-SSRF): HTTPS and public hosts by default. Ollama allows `http` and private hosts by default; for other internal endpoints use `http: { allowHttp: true, allowPrivateHosts: true }`.

## Persistence

With `persistPath`, the index is saved (atomic write) after every change. On startup, vectors are reused for chunks whose text did not change and that were computed with the same embedder (`Embedder.id`); if you change the model, it is rebuilt: the configured documents, the documents added at runtime and, without `documents`, the chunks of a precompiled index are all embedded again with the new embedder. Without `documents`, the saved index is served as-is (a precompiled index).

Documents added at runtime (`addText`, `addDocuments`, `addFiles`) survive restarts; if one shares an id with a configured document, the configured one wins. If the file is corrupt and `documents` is set, it is moved aside as `<persistPath>.corrupt`, `onError` is notified and the index is rebuilt; without `documents` there is nothing to rebuild from and `ready()` fails with `INVALID_INDEX`.

If ingestion fails, `retrieve()` rejects immediately with the same error for `retryDelayMs` (30 s by default) instead of recomputing the embeddings of the whole corpus on every query; `ready()`/`warmup()` always retry. `retrieve(query, { signal })` stops waiting for ingestion as soon as the signal aborts.

## PDF

```bash
pnpm add pdf-parse
```

Without the package, loading a PDF fails with `RagError('MISSING_DEPENDENCY')`. You can also pass your own extractor: `createRag({ pdf: async (bytes) => text })`.

## Errors

Everything fails with `RagError` and a `code`: `INVALID_OPTIONS`, `UNSUPPORTED_FORMAT`, `LOAD_FAILED`, `MISSING_DEPENDENCY`, `EMBEDDING_FAILED`, `INVALID_INDEX`. Messages never include the embedding provider's response body, the API key or the endpoint's path and query string: a failed request names only the endpoint's origin (`https://api.openai.com`) and the network error code (`ECONNREFUSED`, `TIMEOUT`...). A JSON file nested deeper than 64 levels fails with `LOAD_FAILED`.

## Limits

The index is brute force: it is meant for thousands of chunks (a FAQ, a catalogue, a manual). For millions, write your own `retrieve()` over a vector database; `aiPlugin` only needs `{ retrieve(query, { topK }) }`.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `RagError` `MISSING_DEPENDENCY` when loading a PDF | The optional `pdf-parse` peer is not installed: `pnpm add pdf-parse`, or pass your own extractor in `pdf`. |
| `RagError` `EMBEDDING_FAILED` with `ECONNREFUSED` | Nothing listens on the endpoint: start Ollama (`ollama serve`) or fix `baseUrl`. |
| `RagError` `EMBEDDING_FAILED` with `HTTP 401` | Wrong or missing API key: set `OPENAI_API_KEY` or `embeddings: { provider: 'openai', apiKey }`. |
| `EMBEDDING_FAILED` against a local or internal endpoint | `secureFetch` blocks plain `http` and private addresses by default. For a self-hosted OpenAI-compatible server pass `http: { allowHttp: true, allowPrivateHosts: true }` (Ollama already allows them). |
| Every query fails right after a failed start | `retrieve()` fails fast with the last ingest error for `retryDelayMs`; fix the cause and call `rag.ready()` to retry at once. |
| The whole corpus is re-embedded on every restart | The embedder id changed (another model or `dimensions`), or there is no `persistPath`. |
| A `<persistPath>.corrupt` file appeared | The saved index could not be read; it was set aside and rebuilt from `documents` (and reported to `onError`). |
| Answers ignore an obviously relevant passage | The default `'local'` embedder is lexical (word overlap, no synonyms). Use `'openai'` or `'ollama'` for semantic search, or tune `chunkSize`/`topK`. |

## Links

- [AI memory and RAG guide](https://andresayac.github.io/botmesh/guide/ai-memory-rag) · [AI plugin](https://andresayac.github.io/botmesh/guide/ai) · [Security](https://andresayac.github.io/botmesh/guide/security)
- [Changelog](https://github.com/andresayac/botmesh/blob/main/packages/rag/CHANGELOG.md) · [Source](https://github.com/andresayac/botmesh/tree/main/packages/rag) · [Issues](https://github.com/andresayac/botmesh/issues)
