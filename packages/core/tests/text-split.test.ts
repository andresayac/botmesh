import { describe, expect, it } from 'vitest'
import { Buffer } from 'node:buffer'
import { splitMessage, findSplitPoint } from '../src/index.js'

const bytes = (s: string): number => Buffer.byteLength(s, 'utf8')
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
const graphemes = (s: string): string[] => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map((g) => g.segment)
const squash = (s: string): string => s.replace(/\s+/g, '')

describe('splitMessage — unicode', () => {
  it('never splits a ZWJ emoji sequence, a flag or a skin-tone modifier', () => {
    const family = '👨‍👩‍👧‍👦' // 11 UTF-16 units, one grapheme
    const text = `${family}🇪🇸👍🏽`.repeat(6)
    const parts = splitMessage(text, 16)
    const all = new Set(graphemes(text))
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(16)
      expect(p).not.toMatch(LONE_SURROGATE)
      for (const g of graphemes(p)) expect(all.has(g)).toBe(true)
    }
    expect(parts.join('')).toBe(text)
  })

  it('cuts inside one grapheme only when that grapheme alone exceeds the limit', () => {
    const family = '👨‍👩‍👧‍👦'
    const parts = splitMessage(family, 4)
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(4)
      expect(p).not.toMatch(LONE_SURROGATE)
    }
    expect(parts.join('')).toBe(family)
  })

  it('honours a UTF-8 byte limit (accents, CJK, emoji)', () => {
    const text = 'Ñandú pequeño, 日本語のテキスト 🎉🎉 y más texto acentuado aquí. '.repeat(30)
    const parts = splitMessage(text, { maxBytes: 100 })
    expect(parts.length).toBeGreaterThan(1)
    for (const p of parts) {
      expect(bytes(p)).toBeLessThanOrEqual(100)
      expect(p).not.toMatch(LONE_SURROGATE)
    }
    expect(squash(parts.join(''))).toBe(squash(text))
  })

  it('applies both the char and the byte limit', () => {
    const text = 'ñ'.repeat(50) + ' ' + 'a'.repeat(50)
    const parts = splitMessage(text, { maxLength: 40, maxBytes: 60 })
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(40)
      expect(bytes(p)).toBeLessThanOrEqual(60)
    }
    expect(squash(parts.join(''))).toBe(squash(text))
  })

  it('keeps every part within limits on random unicode input', () => {
    const atoms = ['a', 'bb', ' ', '\n', '\n\n', 'ñ', '日', '😀', '👨‍👩‍👧', '🇦🇷', '. ', '*negrita*', '`code`', 'palabra']
    let seed = 7
    const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n }
    for (let round = 0; round < 200; round++) {
      let text = ''
      const len = 1 + rnd(120)
      for (let i = 0; i < len; i++) text += atoms[rnd(atoms.length)]
      const maxLength = 8 + rnd(40)
      const maxBytes = rnd(2) === 0 ? undefined : 16 + rnd(60)
      const parts = splitMessage(text, { maxLength, ...(maxBytes !== undefined ? { maxBytes } : {}), format: 'whatsapp' })
      for (const p of parts) {
        expect(p.trim()).not.toBe('')
        expect(p.length).toBeLessThanOrEqual(maxLength)
        if (maxBytes !== undefined) expect(bytes(p)).toBeLessThanOrEqual(maxBytes)
        expect(p).not.toMatch(LONE_SURROGATE)
      }
    }
  })
})

describe('splitMessage — markup', () => {
  it('does not cut inside a WhatsApp/Markdown bold span when a boundary before it fits', () => {
    const text = 'Hola amigo, esto es *un texto en negrita bastante largo* y sigue.'
    const parts = splitMessage(text, { maxLength: 45, format: 'whatsapp' })
    expect(parts[0]).toBe('Hola amigo, esto es')
    expect(parts[1]).toBe('*un texto en negrita bastante largo* y sigue.')
  })

  it('closes and reopens a bold span longer than the limit', () => {
    const text = `*${'palabra '.repeat(10).trim()}*`
    const parts = splitMessage(text, { maxLength: 30, format: 'whatsapp' })
    expect(parts.length).toBeGreaterThan(1)
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(30)
      expect(p.startsWith('*') && p.endsWith('*')).toBe(true)
    }
  })

  it('does not cut a Markdown link', () => {
    const link = '[documentación oficial](https://example.com/docs/very/long/path)'
    const text = `Lee la ${link} para más detalles.`
    const parts = splitMessage(text, { maxLength: 70, format: 'markdown' })
    expect(parts.some((p) => p.includes(link))).toBe(true)
  })

  it('closes and reopens a fenced code block, keeping its language', () => {
    const code = Array.from({ length: 12 }, (_, i) => `  const value${i} = ${i}`).join('\n')
    const text = `Ejemplo:\n\n\`\`\`ts\n${code}\n\`\`\`\n\nFin.`
    const parts = splitMessage(text, { maxLength: 80, format: 'markdown' })
    expect(parts.length).toBeGreaterThan(2)
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(80)
      const fences = p.match(/```/g)?.length ?? 0
      expect(fences % 2).toBe(0)
    }
    const inner = parts.filter((p) => p.includes('const value'))
    for (const p of inner) {
      expect(p.startsWith('```ts\n')).toBe(true)
      expect(p).not.toMatch(/\nconst/)
    }
    // Indentation survives the cut.
    expect(parts.join('\n')).toContain('  const value11 = 11')
  })

  it('keeps HTML tags and entities whole and reopens an inline element', () => {
    const text = `Hola &amp; adiós <b>${'negrita '.repeat(8).trim()}</b> fin`
    const parts = splitMessage(text, { maxLength: 32, format: 'html' })
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(32)
      expect(p).not.toMatch(/&[a-z]*$/)
      expect(p).not.toMatch(/<[^>]*$/)
      expect((p.match(/<b>/g)?.length ?? 0)).toBe(p.match(/<\/b>/g)?.length ?? 0)
    }
  })

  it('plain text ignores markup characters', () => {
    const text = 'a *b c d e f g h i j k l m n o p q r s t u v w x y z*'
    const parts = splitMessage(text, { maxLength: 20, format: 'plain' })
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(20)
    expect(squash(parts.join(''))).toBe(squash(text))
  })
})

describe('findSplitPoint — options', () => {
  it('accepts the options form', () => {
    expect(findSplitPoint('abc def', { maxLength: 10 })).toBe(7)
    expect(findSplitPoint('ñññ ñññ', { maxBytes: 8 })).toBeLessThanOrEqual(4)
  })
})

describe('streamText — capabilities.maxTextBytes', () => {
  it('chunks and final parts stay within the UTF-8 byte limit', async () => {
    const { streamText } = await import('../src/index.js')
    const sent: string[] = []
    let n = 0
    const target = {
      capabilities: { streaming: 'none' as const, maxTextBytes: 40, edit: false },
      async send(content: { kind: string; text?: string }) {
        sent.push(content.text ?? '')
        const id = `m${++n}`
        return { ref: { id, chatId: 'c' }, id, chatId: 'c' }
      },
    }
    const text = 'ñandú pequeño corre 🎉 por el campo 日本語 abierto y vuelve a casa muy tarde.'
    await streamText(target, [text], { strategy: 'buffer' })
    expect(sent.length).toBeGreaterThan(1)
    for (const s of sent) expect(bytes(s)).toBeLessThanOrEqual(40)
    expect(squash(sent.join(''))).toBe(squash(text))
  })
})
