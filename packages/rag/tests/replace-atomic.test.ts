import { describe, expect, it } from 'vitest'
import { createRag } from '../src/Rag.js'
import { HashEmbedder } from '../src/embeddings/hash.js'
import { RagError } from '../src/errors.js'
import type { Embedder } from '../src/types.js'

/** An embedder whose output size can be switched (a model change behind the same id). */
class SwitchableEmbedder implements Embedder {
  readonly id = 'switch'
  dims = 64
  async embed(texts: readonly string[]): Promise<number[][]> {
    return new HashEmbedder({ dimensions: this.dims }).embed(texts)
  }
}

describe('Rag — replacing a document is all-or-nothing', () => {
  it('keeps the old chunks when the new ones have another dimension', async () => {
    const embedder = new SwitchableEmbedder()
    const rag = createRag({
      embeddings: embedder,
      documents: [
        { id: 'a', source: 'a.md', text: 'Los envíos tardan tres días.' },
        { id: 'b', source: 'b.md', text: 'Aceptamos tarjeta y efectivo.' },
      ],
    })
    expect((await rag.retrieve('envíos', { minScore: 0 })).length).toBeGreaterThan(0)
    embedder.dims = 32
    await expect(rag.addText('Los envíos ahora tardan dos días.', { id: 'a', source: 'a.md' })).rejects.toBeInstanceOf(RagError)
    embedder.dims = 64
    const hits = await rag.retrieve('envíos tardan', { minScore: 0, topK: 5 })
    expect(hits.some((h) => h.docId === 'a' && h.text.includes('tres días'))).toBe(true)
  })
})
