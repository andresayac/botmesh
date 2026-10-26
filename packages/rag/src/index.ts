/**
 * @botmesh/rag — Retrieval Augmented Generation for `@botmesh/ai`: load documents, chunk
 * them, embed them and retrieve the most relevant passages with citations, over an
 * in-memory cosine index with optional JSON persistence.
 *
 * The building blocks (markdown section splitter, chunk option resolver, cosine and
 * hashing helpers, the embedder resolver and the injectable PDF parser factory) live in
 * `@botmesh/rag/internal`, without a semver guarantee.
 *
 * @example
 * ```ts
 * import { aiPlugin } from '@botmesh/ai'
 * import { createRag } from '@botmesh/rag'
 *
 * const rag = createRag({ documents: ['./docs/faq.md'], embeddings: 'openai', persistPath: './rag-index.json' })
 * bot.plug(aiPlugin({ provider: 'anthropic', rag }))
 * ```
 *
 * @packageDocumentation
 */

export { Rag, createRag, formatContext } from './Rag.js'
export type { RagOptions, RetrieveOptions, AddTextOptions } from './Rag.js'
export { RagError } from './errors.js'
export type { RagErrorCode } from './errors.js'
export type { RagDocument, RagChunk, RagMetadata, RetrievedChunk, Embedder, EmbedOptions } from './types.js'
export { chunkText, chunkDocument, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP } from './chunking.js'
export type { ChunkOptions } from './chunking.js'
export { loadFile, loadPaths, fromText, fromMarkdown, fromJson, defaultPdfParser, SUPPORTED_EXTENSIONS } from './loaders.js'
export type { LoadOptions, PdfParser } from './loaders.js'
export { VectorIndex } from './VectorIndex.js'
export type { IndexEntry, SearchOptions, SearchHit, SerializedIndex } from './VectorIndex.js'
export { HashEmbedder } from './embeddings/hash.js'
export type { HashEmbedderOptions } from './embeddings/hash.js'
export { OpenAIEmbedder } from './embeddings/openai.js'
export type { OpenAIEmbedderOptions } from './embeddings/openai.js'
export { OllamaEmbedder } from './embeddings/ollama.js'
export type { OllamaEmbedderOptions } from './embeddings/ollama.js'
export type { EmbeddingsConfig } from './embeddings/resolve.js'
export type { EmbeddingHttpOptions } from './embeddings/http.js'
