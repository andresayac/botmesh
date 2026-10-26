/**
 * `@botmesh/rag/internal` — the building blocks `Rag` is made of: the markdown section
 * splitter, the chunk option resolver, the cosine and chunk-hash helpers, the tokenizer of
 * the local hashing embedder, the embeddings config resolver and the PDF parser factory
 * (with an injectable importer). **No semver guarantee:** any of them may change or
 * disappear in a minor release. Applications use `createRag`, the embedders and the loaders
 * from `@botmesh/rag`.
 *
 * @example
 * ```ts
 * import { splitMarkdownSections, resolveEmbedder } from '@botmesh/rag/internal'
 * ```
 *
 * @packageDocumentation
 */

export { splitMarkdownSections, resolveChunkOptions } from './chunking.js'
export type { MarkdownSection } from './chunking.js'
export { cosine, hashText } from './VectorIndex.js'
export { tokenize } from './embeddings/hash.js'
export { resolveEmbedder } from './embeddings/resolve.js'
export { createPdfParser } from './loaders.js'
