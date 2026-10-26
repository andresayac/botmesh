import { describe, expect, it, vi } from 'vitest'
import { IntentEngine, normalizeText } from '../src/index.js'

function greetingEngine(): IntentEngine {
  return new IntentEngine()
    .define('greeting', ['hola', 'buenas', 'buenos días'])
    .define('farewell', ['adiós', 'hasta luego', 'nos vemos'])
}

describe('normalizeText', () => {
  it('lowercases, strips diacritics and punctuation, collapses whitespace', () => {
    expect(normalizeText('  ¡Hola, SEÑOR!  ¿Cómo está? ')).toBe('hola senor como esta')
    expect(normalizeText('pedido #123')).toBe('pedido 123')
    expect(normalizeText('')).toBe('')
  })
})

describe('IntentEngine.define / validation', () => {
  it('rejects empty intent names and empty utterance lists', () => {
    const nlu = new IntentEngine()
    expect(() => nlu.define('', ['x'])).toThrow(/non-empty/)
    expect(() => nlu.define('x', [])).toThrow(/at least one/)
    expect(() => nlu.define('x', ['   '])).toThrow(/at least one/)
    expect(() => nlu.define('x', 'nope' as unknown as string[])).toThrow(/array/)
  })

  it('rejects out-of-range thresholds', () => {
    expect(() => new IntentEngine({ threshold: 1.5 })).toThrow(/threshold/)
    expect(() => new IntentEngine({ threshold: -0.1 })).toThrow(/threshold/)
  })

  it('appends utterances when define() is called twice for the same intent', () => {
    const nlu = new IntentEngine().define('greeting', ['hola']).define('greeting', ['buenas'])
    expect(nlu.match('hola')?.intent).toBe('greeting')
    expect(nlu.match('buenas')?.intent).toBe('greeting')
    expect(nlu.intents()).toEqual(['greeting'])
  })
})

describe('IntentEngine.match — exact matching & normalization', () => {
  it('matches exact utterances with confidence 1 (case/punctuation/diacritics-insensitive)', () => {
    const nlu = greetingEngine()
    const m = nlu.match('¡HOLA!')
    expect(m?.intent).toBe('greeting')
    expect(m?.confidence).toBe(1)

    const m2 = nlu.match('  Buenos   Días??? ')
    expect(m2?.intent).toBe('greeting')
    expect(m2?.confidence).toBe(1)

    // Diacritics in the input are fine too.
    expect(nlu.match('adios')?.intent).toBe('farewell')
    expect(nlu.match('ADIÓS')?.intent).toBe('farewell')
  })

  it('returns null for empty or whitespace-only input', () => {
    const nlu = greetingEngine()
    expect(nlu.match('')).toBeNull()
    expect(nlu.match('   \n\t ')).toBeNull()
  })

  it('returns null when no intent crosses the threshold', () => {
    const nlu = greetingEngine()
    expect(nlu.match('zzz qqq xrx')).toBeNull()
    expect(nlu.match('cuánto cuesta el envío a medellín')).toBeNull()
  })
})

describe('IntentEngine.match — paraphrase via token overlap', () => {
  const orderEngine = () =>
    new IntentEngine().define('order.status', ['quiero ver el estado de mi pedido'])

  it('scores a subsequence paraphrase (utterance contained in the input) above threshold', () => {
    const m = orderEngine().match('ver el estado de mi pedido por favor')
    expect(m?.intent).toBe('order.status')
    expect(m!.confidence).toBeGreaterThan(0.5)
    expect(m!.confidence).toBeLessThanOrEqual(1)
  })

  it('scores a word-order paraphrase above threshold', () => {
    const m = orderEngine().match('pedido mi de estado el ver')
    expect(m?.intent).toBe('order.status')
    expect(m!.confidence).toBeGreaterThan(0.5)
  })

  it('scores a partial paraphrase above threshold when the utterance is covered', () => {
    const m = orderEngine().match('el estado de mi pedido')
    expect(m?.intent).toBe('order.status')
    expect(m!.confidence).toBeGreaterThan(0.5)
  })

  it('stays below threshold when too few utterance tokens appear', () => {
    expect(orderEngine().match('pedido')).toBeNull()
    expect(orderEngine().match('estado')).toBeNull()
  })
})

describe('IntentEngine.match — confidence ordering & determinism', () => {
  it('picks the strongest intent when several overlap', () => {
    const nlu = new IntentEngine()
      .define('greeting', ['hola'])
      .define('order.status', ['estado de mi pedido'])
    const m = nlu.match('hola quiero el estado de mi pedido')
    expect(m?.intent).toBe('order.status')
    const ranked = nlu.rank('hola quiero el estado de mi pedido')
    expect(ranked[0].intent).toBe('order.status')
    expect(ranked[1].intent).toBe('greeting')
    expect(ranked[0].confidence).toBeGreaterThan(ranked[1].confidence)
  })

  it('rank() returns only positive scores, sorted descending', () => {
    const nlu = greetingEngine().define('order.status', ['estado de mi pedido'])
    const ranked = nlu.rank('hola')
    expect(ranked.map((r) => r.intent)).toEqual(['greeting'])
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].confidence).toBeGreaterThanOrEqual(ranked[i].confidence)
    }
  })

  it('is deterministic: identical input yields identical output', () => {
    const nlu = greetingEngine().define('order.status', ['estado de mi pedido', 'mi pedido {id}'])
    const input = 'Hola, quisiera ver el estado de mi pedido 555 por favor'
    expect(nlu.match(input)).toEqual(nlu.match(input))
    expect(nlu.rank(input)).toEqual(nlu.rank(input))
  })
})

describe('IntentEngine — threshold control', () => {
  it('honors a custom engine threshold', () => {
    const strict = new IntentEngine({ threshold: 0.95 }).define('order.status', [
      'quiero ver el estado de mi pedido',
    ])
    expect(strict.match('pedido mi de estado el ver')).toBeNull() // ~0.69 < 0.95
    expect(strict.match('quiero ver el estado de mi pedido')?.confidence).toBe(1)
  })

  it('accepts a per-call threshold override', () => {
    const nlu = new IntentEngine().define('order.status', ['quiero ver el estado de mi pedido'])
    const text = 'pedido mi de estado el ver'
    expect(nlu.match(text, 0.9)).toBeNull()
    expect(nlu.match(text, 0.3)?.intent).toBe('order.status')
  })
})

describe('IntentEngine — {slot} entities', () => {
  it('captures a single slot with confidence 1', () => {
    const nlu = new IntentEngine().define('order.status', ['mi pedido {id}'])
    const m = nlu.match('mi pedido 12345')
    expect(m?.intent).toBe('order.status')
    expect(m?.confidence).toBe(1)
    expect(m?.entities).toEqual({ id: '12345' })
  })

  it('captures multiple slots in order', () => {
    const nlu = new IntentEngine().define('travel', ['vuelo de {origen} a {destino}'])
    const m = nlu.match('vuelo de Bogotá a Lima')
    expect(m?.entities).toEqual({ origen: 'bogota', destino: 'lima' })
    expect(m?.confidence).toBe(1)
  })

  it('still matches (without entities) when the slot pattern does not line up', () => {
    const nlu = new IntentEngine().define('order.status', ['mi pedido {id}'])
    // Extra trailing tokens break the anchored slot pattern; token overlap still scores.
    const m = nlu.match('donde esta mi pedido')
    expect(m?.intent).toBe('order.status')
    expect(m!.confidence).toBeGreaterThan(0.5)
    expect(m?.entities).toBeUndefined()
  })

  it('normalizes slot values (lowercase, no diacritics)', () => {
    const nlu = new IntentEngine().define('greet', ['saluda a {nombre}'])
    expect(nlu.match('saluda a ANDRÉS')?.entities).toEqual({ nombre: 'andres' })
  })
})

describe('IntentEngine — hostile input and config mistakes', () => {
  it('rejects adjacent slots: ambiguous, and their regex backtracks quadratically on long tokens', () => {
    const nlu = new IntentEngine()
    expect(() => nlu.define('x', ['{a}{b} foo'])).toThrow(/adjacent slots \{a\}\{b\}.*separate them/)
    expect(() => nlu.define('x', ['mi {a} {b}'])).not.toThrow()
    expect(nlu.intents()).toEqual(['x'])
  })

  it('scores a 64 KiB single-token message quickly', () => {
    const nlu = new IntentEngine()
    nlu.define('x', ['{a} foo', 'pedido {id}'])
    const started = performance.now()
    nlu.rank(`${'a'.repeat(65_536)} bar`)
    expect(performance.now() - started).toBeLessThan(500)
  })

  it('matches slots joined by letters inside one token in linear time', () => {
    const nlu = new IntentEngine()
    nlu.define('order', ['{qty}x{item} please', '{a}2{b} end', '{a}x{b}y{c} ok'])
    for (const body of ['x'.repeat(60_000), `${'x'.repeat(60_000)} please`, '2'.repeat(60_000), 'xy'.repeat(30_000)]) {
      const started = performance.now()
      nlu.rank(body)
      expect(performance.now() - started).toBeLessThan(500)
    }
    expect(nlu.match('3xbox please')).toEqual({ intent: 'order', confidence: 1, entities: { qty: '3', item: 'box' } })
    expect(nlu.match('ab2cd end')).toEqual({ intent: 'order', confidence: 1, entities: { a: 'ab', b: 'cd' } })
    expect(nlu.match('1x2y3 ok')).toEqual({ intent: 'order', confidence: 1, entities: { a: '1', b: '2', c: '3' } })
  })

  it('validates the per-call threshold like the constructor one', () => {
    const nlu = new IntentEngine()
    nlu.define('greeting', ['hola'])
    expect(() => nlu.match('hola', Number.NaN)).toThrow(/threshold must be a number in \[0, 1\]/)
    expect(() => nlu.match('hola', 2)).toThrow(/threshold/)
    expect(nlu.match('hola', 1)).toEqual({ intent: 'greeting', confidence: 1 })
  })
})

describe('IntentEngine — unicode beyond Latin accents', () => {
  it('keeps combining marks of other scripts inside their word (Devanagari, Thai)', () => {
    expect(normalizeText('नमस्ते दुनिया')).toBe('नमस्ते दुनिया')
    expect(normalizeText('สวัสดี ครับ')).toBe('สวัสดี ครับ')
    const nlu = new IntentEngine().define('greet', ['नमस्ते {name}'])
    expect(nlu.match('नमस्ते दुनिया')).toEqual({ intent: 'greet', confidence: 1, entities: { name: 'दुनिया' } })
  })

  it('drops optional Arabic and Hebrew vowel marks, like Latin accents', () => {
    expect(normalizeText('مَرْحَبًا')).toBe('مرحبا')
    expect(normalizeText('שָׁלוֹם')).toBe('שלום')
  })

  it('folds compatibility forms (full-width letters, ligatures)', () => {
    expect(normalizeText('ＨＯＬＡ')).toBe('hola')
    expect(normalizeText('ﬁn')).toBe('fin')
  })

  it('removes invisible format characters instead of splitting the word', () => {
    expect(normalizeText('ho\u200Bla\u00ADmundo\uFEFF')).toBe('holamundo')
    expect(new IntentEngine().define('g', ['hola']).match('ho\u200Bla')?.confidence).toBe(1)
  })
})

describe('IntentEngine — more config mistakes', () => {
  it('rejects utterances that can never match (only emoji or punctuation)', () => {
    expect(() => new IntentEngine().define('like', ['👍'])).toThrow(/"👍" has no letters or digits.*never match/)
    expect(() => new IntentEngine().define('like', ['ok', '?!'])).toThrow(/never match/)
  })

  it('rejects non-string utterances instead of dropping them silently', () => {
    expect(() => new IntentEngine().define('x', ['hola', 5 as unknown as string])).toThrow(/utterances must be strings.*index 1/)
  })

  it('rejects duplicate and reserved slot names', () => {
    expect(() => new IntentEngine().define('x', ['de {a} a {a}'])).toThrow(/slot \{a\} appears twice/)
    expect(() => new IntentEngine().define('x', ['pedido {__proto__}'])).toThrow(/slot name \{__proto__\} is reserved/)
  })

  it('treats slots glued by a mark that normalization removes as adjacent', () => {
    expect(() => new IntentEngine().define('x', ['{a}\u0301{b} z'])).toThrow(/adjacent slots/)
  })

  it('gives a clear error when match/rank get a non-string', () => {
    const nlu = new IntentEngine().define('g', ['hola'])
    expect(() => nlu.match(undefined as unknown as string)).toThrow(/IntentEngine.match: text must be a string, got undefined/)
    expect(() => nlu.rank(5 as unknown as string)).toThrow(/IntentEngine.rank: text must be a string, got number/)
  })
})

describe('IntentEngine — repeated scoring of the same message', () => {
  it('scores a message once for many whenIntent-style lookups and re-scores after define()', () => {
    const nlu = new IntentEngine().define('a', ['hola']).define('b', ['adios'])
    const spy = vi.spyOn(nlu as unknown as { scoreAll: (t: string) => unknown }, 'scoreAll')
    for (let i = 0; i < 50; i++) nlu.match('hola amigo')
    expect(spy).toHaveBeenCalledTimes(1)
    const first = nlu.rank('hola amigo')
    first[0].intent = 'mutated'
    expect(nlu.rank('hola amigo')[0].intent).toBe('a')
    nlu.define('c', ['hola amigo'])
    expect(nlu.match('hola amigo')?.intent).toBe('c')
    expect(spy).toHaveBeenCalledTimes(2)
  })
})

describe('IntentEngine — repeated words', () => {
  it('keeps confidence within [0, 1] when an utterance or the input repeats a word', () => {
    const nlu = new IntentEngine({ threshold: 0 }).define('no', ['no no no']).define('ok', ['ok'])
    for (const text of ['no', 'no gracias', 'ok ok ok ok', 'no no no no no']) {
      for (const m of nlu.rank(text)) expect(m.confidence).toBeLessThanOrEqual(1)
    }
    // A repeated word in the input must not beat an exact match of another intent.
    expect(new IntentEngine().define('a', ['hola hola']).define('b', ['hola']).match('hola')?.intent).toBe('b')
  })

  it('does not give a partial match a perfect score when the input repeats a word or phrase', () => {
    const nlu = new IntentEngine().define('greet', ['hola']).define('double', ['hola hola'])
    expect(nlu.rank('hola hola')[0]).toEqual({ intent: 'double', confidence: 1 })
    expect(nlu.rank('hola hola')[1]?.confidence).toBeLessThan(1)
    expect(nlu.match('hola hola')?.intent).toBe('double')
    const ab = new IntentEngine({ threshold: 0 }).define('a', ['a b'])
    expect(ab.match('a b a')?.confidence).toBeLessThan(1)
    expect(ab.match('a b a b')?.confidence).toBeLessThan(1)
    // Only an exact phrase scores 1.
    expect(ab.match('a b')?.confidence).toBe(1)
  })
})

describe('IntentEngine — containment respects word boundaries', () => {
  it('does not count an utterance found only inside a longer word', () => {
    const nlu = new IntentEngine().define('order', ['mi pedido'])
    expect(nlu.match('mi pedidos')).toBeNull()
    expect(nlu.match('hola mi pedido ya')?.intent).toBe('order')
  })
})
