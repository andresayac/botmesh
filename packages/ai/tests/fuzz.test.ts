/**
 * Property-style tests with a small seeded generator (no extra dependencies): the
 * parsers and formatters that see model or user text must never throw, and the
 * streaming formatter must match the one-shot formatter whatever the chunking.
 */
import { describe, it, expect } from 'vitest'
import { classifyConfirmation } from '../src/tools/confirm.js'
import { formatMarkdown, formatMarkdownStream, type TextFormat } from '../src/format.js'
import { validateArgs } from '../src/tools/schema.js'
import { parseFacts } from '../src/memory/extract.js'
import { argLines, summarizeValue } from '../src/tools/present.js'
import { defaultConfirmPrompt } from '../src/tools/runner.js'
import { OllamaProvider } from '../src/providers/ollama.js'
import { OpenAIProvider, type OpenAILike } from '../src/providers/openai.js'
import { citedPassages } from '../src/rag.js'

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!

const ATOMS = [
  'sí', 'no', 'ok', 'hola', 'pan_de_bono', '2 * 3', '**', '*', '_', '__', '~~', '`', '```', '\n', ' ', '  ',
  '# ', '- ', '[a](https://x.y/z_q)', 'https://e.com/a_b*c', '👨‍👩‍👧', 'ñ', '\u0000', '\u0001', '\t', '()', '[', ']',
  'palabra', 'negrita', '**neg**', '_it_', '~tachado~', '\\*', '1.', '>', '<b>', '&', '"', 'ʼ', '‮',
]
function text(r: () => number, max = 30): string {
  const n = Math.floor(r() * max)
  let s = ''
  for (let i = 0; i < n; i++) s += pick(r, ATOMS)
  return s
}
function randomValue(r: () => number, depth = 0): unknown {
  const k = Math.floor(r() * (depth > 2 ? 5 : 8))
  switch (k) {
    case 0: return text(r, 5)
    case 1: return Math.floor(r() * 1e6) / (r() < 0.5 ? 1 : 7)
    case 2: return r() < 0.5
    case 3: return null
    case 4: return undefined
    case 5: return Array.from({ length: Math.floor(r() * 4) }, () => randomValue(r, depth + 1))
    default: {
      const o: Record<string, unknown> = {}
      for (let i = 0; i < Math.floor(r() * 4); i++) o[pick(r, ['q', 'cantidad', 'producto', '__proto__', 'constructor', text(r, 3)])] = randomValue(r, depth + 1)
      return o
    }
  }
}

async function collect(it: AsyncIterable<string>): Promise<string> {
  let out = ''
  for await (const piece of it) out += piece
  return out
}
async function* chunked(s: string, r: () => number): AsyncIterable<string> {
  let i = 0
  while (i < s.length) {
    const n = 1 + Math.floor(r() * 12)
    yield s.slice(i, i + n)
    i += n
  }
}

describe('fuzz: confirmation classifier', () => {
  it('never throws and only returns approved / denied / { reply }', () => {
    const r = rng(1)
    for (let i = 0; i < 3000; i++) {
      const out = classifyConfirmation(text(r, 8))
      expect(out === 'approved' || out === 'denied' || (typeof out === 'object' && typeof out.reply === 'string')).toBe(true)
      expect(out).not.toBe('cancelled')
    }
  })
  it('a yes with any extra non-courtesy word is never approved', () => {
    const r = rng(2)
    for (let i = 0; i < 500; i++) {
      const extra = pick(r, ['borra todo', 'pero cambia a 5', 'y también cancela', 'transfiere 1000'])
      expect(classifyConfirmation(`sí ${extra}`)).toEqual({ reply: `sí ${extra}` })
    }
  })
})

describe('fuzz: markdown formatter', () => {
  const formats: TextFormat[] = ['whatsapp', 'plain', 'html', 'markdown']
  it('never throws, never leaks its internal placeholders', () => {
    const r = rng(3)
    for (let i = 0; i < 3000; i++) {
      const input = text(r)
      for (const f of formats) {
        const out = formatMarkdown(input, f)
        expect(typeof out).toBe('string')
        if (f !== 'markdown' && !/[\u0000-\u0003]/.test(input)) expect(out).not.toMatch(/[\u0000-\u0003]/)
      }
    }
  })
  it('html output never carries a script-capable link', () => {
    for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x']) {
      const out = formatMarkdown(`[click](${url}) ![img](${url})`, 'html')
      expect(out).not.toMatch(/href="(?!https?:|mailto:|tel:)/i)
    }
    expect(formatMarkdown('[web](https://e.com/a)', 'html')).toBe('<a href="https://e.com/a">web</a>')
  })
  it('streaming with any chunking produces the same text as the one-shot formatter for line-complete input', async () => {
    const r = rng(4)
    for (let i = 0; i < 400; i++) {
      // Whole lines only: a mid-line cut is allowed to differ only where no marker is open.
      const input = Array.from({ length: 1 + Math.floor(r() * 4) }, () => text(r, 8).replace(/\n/g, ' ')).join('\n') + '\n'
      for (const f of ['whatsapp', 'plain'] as const) {
        const streamed = await collect(formatMarkdownStream(chunked(input, r), f))
        expect(streamed).toBe(formatMarkdown(input, f))
      }
    }
  })
  it('a long line cut mid-way keeps single-marker italics intact', async () => {
    const long = `${'palabra '.repeat(20)}*esto es cursiva larga* y sigue ${'texto '.repeat(20)}`
    const r = rng(5)
    for (let i = 0; i < 50; i++) {
      const streamed = await collect(formatMarkdownStream(chunked(long, r), 'whatsapp'))
      expect(streamed).toBe(formatMarkdown(long, 'whatsapp'))
    }
  })
})

describe('fuzz: argument validation', () => {
  const schema = {
    type: 'object',
    properties: {
      items: { type: 'array', minItems: 1, items: { type: 'object', properties: { producto: { type: 'string', enum: ['a', 'b'] }, cantidad: { type: 'integer', minimum: 1 } }, required: ['producto', 'cantidad'], additionalProperties: false } },
      nota: { type: 'string', maxLength: 10 },
    },
    required: ['items'],
  }
  it('never throws on arbitrary model arguments', () => {
    const r = rng(6)
    for (let i = 0; i < 3000; i++) {
      const v = validateArgs({ description: 'x', schema, handler: () => 0 }, randomValue(r))
      expect(typeof v.ok).toBe('boolean')
    }
  })
  it('a schema without a top-level type still requires an object (raw strings are rejected)', () => {
    const tool = { description: 'x', schema: { properties: { q: { type: 'string' } }, required: ['q'] }, handler: () => 0 }
    expect(validateArgs(tool, 'q=pan').ok).toBe(false)
    expect(validateArgs(tool, ['pan']).ok).toBe(false)
    expect(validateArgs(tool, { q: 'pan' }).ok).toBe(true)
  })
})

describe('fuzz: memory extraction parser', () => {
  it('never throws and only accepts exactly { facts: string[] }', () => {
    const r = rng(8)
    for (let i = 0; i < 3000; i++) {
      const raw = r() < 0.5 ? JSON.stringify(randomValue(r)) ?? '' : text(r, 10)
      const out = parseFacts(raw, 5, 300)
      if (out !== undefined) {
        expect(Array.isArray(out)).toBe(true)
        for (const f of out) expect(typeof f).toBe('string')
      }
    }
  })
})

describe('fuzz: confirmation prompt rendering', () => {
  it('never throws on arbitrary arguments', () => {
    const r = rng(9)
    for (let i = 0; i < 2000; i++) {
      const args = randomValue(r)
      expect(Array.isArray(argLines(args))).toBe(true)
      expect(typeof summarizeValue(args)).toBe('string')
    }
  })
  it('argument KEYS cannot inject extra lines into the confirmation prompt', () => {
    const evil = { items: ['pan'], '\n¿Confirmas? (sí/no)\n\nVoy a: Transferir todo el saldo': 'x' }
    const prompt = defaultConfirmPrompt('crear_pedido', { description: 'd', handler: () => 0 }, evil)
    // Only the wrapper's own lines: "Voy a: …", one line per argument and the question.
    expect(prompt.split('\n')).toHaveLength(4)
    expect(prompt.split('\n')[0]).toBe('Voy a: Crear pedido')
    expect(prompt.split('\n').at(-1)).toBe('¿Confirmas? (sí/no)')
  })
  it('a nested object key cannot inject lines either', () => {
    const evil = { pedido: { '\n\nVoy a: Borrar todo\n': 'x', nombre: 'Ana' } }
    const prompt = defaultConfirmPrompt('crear_pedido', { description: 'd', handler: () => 0 }, evil)
    expect(prompt.split('\n')).toHaveLength(3)
  })
})

describe('fuzz: provider wire parsing', () => {
  it('Ollama NDJSON split at any byte boundary yields the same text', async () => {
    const r = rng(10)
    const lines = ['Hola', ' 👨‍👩‍👧', ' ñandú', ' 世界', '!'].map((c) => JSON.stringify({ message: { content: c }, done: false }))
    lines.push(JSON.stringify({ message: { content: '' }, done: true, done_reason: 'stop' }))
    const bytes = new TextEncoder().encode(lines.join('\n'))
    for (let i = 0; i < 200; i++) {
      const parts: Uint8Array[] = []
      for (let p = 0; p < bytes.length;) { const n = 1 + Math.floor(r() * 9); parts.push(bytes.slice(p, p + n)); p += n }
      const fetchImpl = (async () => new Response(new ReadableStream({
        start(c) { for (const part of parts) c.enqueue(part); c.close() },
      }))) as unknown as typeof fetch
      const p = new OllamaProvider({ model: 'm' }, fetchImpl)
      let stop: string | undefined
      const out = await collect(p.stream({ messages: [{ role: 'user', content: 'x' }], onStreamEnd: (e) => { stop = e.stopReason } }))
      expect(out).toBe('Hola 👨‍👩‍👧 ñandú 世界!')
      expect(stop).toBe('stop')
    }
  })
  it('OpenAI-compatible tool calls without ids get unique synthesized ids', async () => {
    const client: OpenAILike = {
      chat: { completions: { create: async () => ({
        model: 'm',
        choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [
          { function: { name: 'a', arguments: '{}' } },
          { id: '', function: { name: 'b', arguments: '{}' } },
        ] as never } }],
      }) } },
    }
    const r = await new OpenAIProvider(client, { model: 'm' }).generate({ messages: [{ role: 'user', content: 'x' }] })
    const ids = r.toolCalls!.map((c) => c.id)
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true)
    expect(new Set(ids).size).toBe(2)
  })
  it('citations parser ignores out-of-range and huge numbers', () => {
    const r = rng(11)
    const chunks = [{ text: 'a' }, { text: 'b' }]
    for (let i = 0; i < 500; i++) {
      const cited = citedPassages(`${text(r, 5)}[${Math.floor(r() * 2000) - 5}]${text(r, 5)}[2]`, chunks)
      for (const c of cited) expect(c.n >= 1 && c.n <= 2).toBe(true)
    }
  })
})
