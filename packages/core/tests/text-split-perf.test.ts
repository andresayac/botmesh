/**
 * splitMessage runs synchronously on the event loop for every long text send, so its run
 * time must stay close to linear in the input, whatever the markup: unclosed emphasis
 * markers, brackets, tags or HTML pairs must not make each round rescan the whole text.
 */
import { describe, expect, it } from 'vitest'
import { Buffer } from 'node:buffer'
import { splitMessage } from '../src/index.js'
import type { SplitTextOptions } from '../src/index.js'

/** Generous bound: the quadratic version took 5–60 s on these inputs. */
const BUDGET_MS = 1_500

function timed(text: string, opts: SplitTextOptions): { ms: number; parts: string[] } {
  const started = performance.now()
  const parts = splitMessage(text, opts)
  return { ms: performance.now() - started, parts }
}

function checkParts(parts: string[], opts: SplitTextOptions): void {
  for (const p of parts) {
    if (opts.maxLength !== undefined) expect(p.length).toBeLessThanOrEqual(opts.maxLength)
    if (opts.maxBytes !== undefined) expect(Buffer.byteLength(p, 'utf8')).toBeLessThanOrEqual(opts.maxBytes)
  }
}

describe('splitMessage — run time stays near-linear on adversarial markup', () => {
  const cases: Array<[string, string, SplitTextOptions]> = [
    ['unclosed underscores (Markdown, 200 KB)', '_x '.repeat(66_000), { maxLength: 4096 }],
    ['unclosed underscores at 2000 (60 KB)', '_x '.repeat(20_000), { maxLength: 2000 }],
    ['unclosed asterisks (WhatsApp, 100 KB)', '*x '.repeat(33_000), { maxLength: 65_536, format: 'whatsapp' }],
    ['many closed emphasis runs (Markdown, 200 KB)', '*a* _b_ ~c~ '.repeat(17_000), { maxLength: 4096 }],
    ['unclosed link brackets (100 KB)', '[x '.repeat(33_000), { maxLength: 2000 }],
    ['unclosed HTML tags (100 KB)', '<a x '.repeat(20_000), { maxLength: 4096, format: 'html' }],
    ['unclosed HTML pairs (100 KB)', '<b>x '.repeat(20_000), { maxLength: 4096, format: 'html' }],
    ['Instagram bytes (30 KB)', '_ñ '.repeat(7_500), { maxLength: 1000, maxBytes: 1000 }],
    ['plain prose (1 MB)', 'Una frase corta y normal. '.repeat(40_000), { maxLength: 4096 }],
    ['Markdown prose (1 MB)', 'Una *frase* con `code` y [link](https://a.b/c) aquí. '.repeat(20_000), { maxLength: 4096 }],
  ]
  for (const [name, text, opts] of cases) {
    it(name, () => {
      const { ms, parts } = timed(text, opts)
      expect(parts.length).toBeGreaterThan(0)
      checkParts(parts, opts)
      expect(ms).toBeLessThan(BUDGET_MS)
    })
  }

  it('still keeps a long fenced block whole across parts (closed and reopened)', () => {
    const code = Array.from({ length: 400 }, (_, i) => `const v${i} = ${i} // _x *y`).join('\n')
    const text = `Intro.\n\n\`\`\`ts\n${code}\n\`\`\`\n\nFin.`
    const parts = splitMessage(text, { maxLength: 1000 })
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(1000)
    const inner = parts.filter((p) => p.includes('const v'))
    expect(inner.length).toBeGreaterThan(5)
    for (const p of inner) {
      expect(p.startsWith('```ts\n') || p.startsWith('Intro.')).toBe(true)
      expect(/```(\n\nFin\.)?$/.test(p)).toBe(true)
    }
  })
})
