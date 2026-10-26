/**
 * Hardening regressions found by the pre-stable review: things a document author or an
 * end user could abuse (URL templates, regex patterns, digests) and resources that must
 * not outlive the bot.
 */
import { describe, expect, it } from 'vitest'
import { validateFormValues, type FormDefinition } from '@botmesh/core'
import { createTestBot } from '@botmesh/core/testing'
import { ExpressionError, FlowDocumentError, compileFlowDocument, evaluateExpression, exportFlowDocument, flowDigest, parseExpression, renderTemplate, sameFlow, validateFlowDocument, type FlowDocument } from '../src/index.js'

const doc = (steps: FlowDocument['steps']): FlowDocument => ({ version: 2, id: 'flow', trigger: 'hola', steps })

function ctxAndControls(state: Record<string, unknown>) {
  const c = { state, say: async () => {}, ask: async () => '', choose: async () => '', goto: () => {}, end: () => {} }
  const ctx = { body: 'hola', from: 'chat', sender: 'user', isGroup: false }
  return { c, ctx }
}

async function runHttp(url: string, state: Record<string, unknown>): Promise<string[]> {
  const seen: string[] = []
  const flow = compileFlowDocument(doc([{ kind: 'http', method: 'GET', url, headers: { Authorization: 'Bearer secret' } }]), {
    fetch: async (u) => {
      seen.push(u)
      return { body: Buffer.from('{}'), response: new Response('{}', { headers: { 'content-type': 'application/json' } }) } as never
    },
  })
  const step = flow.steps[0] as { fn: (ctx: unknown, c: unknown) => Promise<void> }
  const { c, ctx } = ctxAndControls(state)
  await step.fn(ctx, c)
  return seen
}

describe('http step URL templates', () => {
  it('rejects placeholders in the scheme, host or port (the secret headers would follow the user)', () => {
    for (const url of ['https://{{host}}/orders', 'https://api.example.com{{host}}/x', 'https://user{{x}}@api.example.com/']) {
      const issues = validateFlowDocument(doc([{ kind: 'http', method: 'GET', url }]))
      expect(issues.map((i) => i.path), url).toContain('/steps/0/url')
    }
  })

  it('keeps placeholders in the path, the query and the fragment valid', () => {
    for (const url of ['https://api.example.com/orders/{{id}}', 'https://api.example.com/search?q={{term}}&page=1', 'https://api.example.com/{{a}}/{{b}}#{{c}}']) {
      expect(validateFlowDocument(doc([{ kind: 'http', method: 'GET', url }])), url).toEqual([])
    }
  })

  it('percent-encodes interpolated values so they cannot add segments, queries or fragments', async () => {
    const seen = await runHttp('https://api.example.com/orders/{{id}}?q={{term}}', { id: '../admin?x=1#', term: 'a b&c=d' })
    expect(seen[0]).toBe('https://api.example.com/orders/..%2Fadmin%3Fx%3D1%23?q=a%20b%26c%3Dd')
    expect(new URL(seen[0]!).pathname).toBe('/orders/..%2Fadmin%3Fx%3D1%23')
  })

  it('refuses a value that is a dot segment (it would climb the path)', async () => {
    for (const id of ['..', '.']) {
      await expect(runHttp('https://api.example.com/v1/orders/{{id}}/items', { id }), id).rejects.toThrow(/dot segment/)
    }
    // Encoded look-alikes stay literal: `%` itself is encoded, so the parser never sees a dot segment.
    const seen = await runHttp('https://api.example.com/v1/orders/{{id}}/items', { id: '%2e%2E' })
    expect(new URL(seen[0]!).pathname).toBe('/v1/orders/%252e%252E/items')
  })
})

describe('form field patterns (ReDoS)', () => {
  const form = (pattern: string): FlowDocument => doc([{
    kind: 'form',
    form: { id: 'f', fields: [{ name: 'code', label: 'CÃ³digo', type: 'text', pattern }] },
  }])

  it('rejects patterns with nested unbounded quantifiers or backreferences', () => {
    for (const pattern of ['(a+)+$', '(a*)*b', '(\\w+\\s?)*$', '([a-z]+){2,}', '(?:x+|y)+', '(a|aa)+', '(.*a){12}', '(a)\\1', '(?<n>a)\\k<n>']) {
      const issues = validateFlowDocument(form(pattern))
      expect(issues.map((i) => i.path), pattern).toContain('/steps/0/form/fields/0/pattern')
    }
  })

  it('accepts the usual linear patterns', () => {
    for (const pattern of ['[A-Z]{3}-\\d{4}', '\\d{6,10}', '(\\+57)?\\d{10}', '[^@\\s]+@[^@\\s]+\\.[a-z]{2,}', '(\\d{3}-){2}\\d{4}', '(foo|bar)?baz', '[a-z]+(-[a-z]+)?', '\\(\\d+\\)']) {
      expect(validateFlowDocument(form(pattern)), pattern).toEqual([])
    }
  })

  it('bounds the answer length checked against a pattern when the field has no maxLength', () => {
    const flow = compileFlowDocument(form('[a-z]+'))
    const step = flow.steps[0] as unknown as { form: { fields: Array<{ maxLength?: number }> } }
    expect(step.form.fields[0]!.maxLength).toBe(500)
    const own = compileFlowDocument(doc([{ kind: 'form', form: { id: 'f', fields: [{ name: 'c', label: 'C', type: 'text', pattern: '[a-z]+', maxLength: 20 }] } }]))
    expect((own.steps[0] as unknown as { form: { fields: Array<{ maxLength?: number }> } }).form.fields[0]!.maxLength).toBe(20)
  })

  /** Run an answer through the core's own form validation, as a live conversation would. */
  function check(pattern: string, answer: string): { ok: boolean; ms: number } {
    const flow = compileFlowDocument(form(pattern))
    const def = (flow.steps[0] as unknown as { form: FormDefinition }).form
    const started = performance.now()
    const result = validateFormValues(def, { code: answer })
    return { ok: result.ok, ms: performance.now() - started }
  }

  it('keeps answers cheap for the patterns the static check cannot see through (adjacent quantifiers, repeated alternations, nested bounded repeats)', () => {
    const attacks: Array<[string, string]> = [
      ['.*.*.*.*.*.*.*.*.*x', 'a'.repeat(500)],
      ['(?:a|a)'.repeat(40), `${'a'.repeat(40)}b`],
      ['(?:(?:a|a){1,9}){1,9}', `${'a'.repeat(60)}b`],
      [`${'\\d*'.repeat(8)}x`, '1'.repeat(500)],
      ['[a-z]*[a-z]*[a-z]*[a-z]*[a-z]*@', 'a'.repeat(500)],
    ]
    for (const [pattern, answer] of attacks) {
      if (validateFlowDocument(form(pattern)).length) continue // rejected up front: also fine
      const { ok, ms } = check(pattern, answer)
      expect(ok, pattern).toBe(false)
      expect(ms, pattern).toBeLessThan(250)
    }
  })

  it('matches answers exactly like the native regular expression would', () => {
    const cases: Array<[string, string[]]> = [
      ['[A-Z]{3}-\\d{4}', ['ABC-1234', 'abc-1234', 'ABC-123', 'ABCD-1234']],
      ['\\d{6,10}', ['12345', '123456', '1234567890', '12345678901']],
      ['(\\+57)?\\d{10}', ['3001234567', '+573001234567', '+57300123456', '57300123456']],
      ['[^@\\s]+@[^@\\s]+\\.[a-z]{2,}', ['ana@example.com', 'ana@example.c', 'a b@x.co', '@x.co', 'ana@x.co.uk']],
      ['(foo|bar)?baz', ['baz', 'foobaz', 'barbaz', 'foobarbaz']],
      ['a|b', ['a', 'b', 'ab']],
      ['^a$|^b$', ['a', 'b', 'ab']],
      ['\\bword\\b', ['word', 'words']],
      ['x{2,}y?', ['x', 'xx', 'xxxxy', 'xxyy']],
      ['.+', ['anything', 'line\nbreak']],
      ['[\\]a-]+', [']-a', 'b']],
      ['\\x41\\u0042\\t!', ['AB\t!', 'AB !']],
      ['a{', ['a{', 'a']],
      ['(?<code>\\d{2})-(?:x|y)?[xy]*', ['12-xyx', '12-', '1-x']],
      ['[]', ['a', 'b']],
      ['[^]{3}', ['abc', 'a\nb', 'a']],
    ]
    for (const [pattern, answers] of cases) {
      expect(validateFlowDocument(form(pattern)), pattern).toEqual([])
      const native = new RegExp(`^(?:${pattern})$`)
      for (const answer of answers) expect(check(pattern, answer).ok, `${pattern} vs ${JSON.stringify(answer)}`).toBe(native.test(answer))
    }
  })

  it('rejects lookarounds and expansions too large to match in linear time', () => {
    for (const pattern of ['(?=a)a', '(?!b)a', '(?<=a)b', '(?<!a)b', '(?:(?:a{1000}){1000}){1000}']) {
      const issues = validateFlowDocument(form(pattern))
      expect(issues.map((i) => i.path), pattern).toContain('/steps/0/form/fields/0/pattern')
    }
  })

  it('keeps the original pattern text on the compiled field (introspection and export)', () => {
    const flow = compileFlowDocument(form('[A-Z]{3}-\\d{4}'))
    const field = (flow.steps[0] as unknown as { form: FormDefinition }).form.fields[0] as { pattern?: RegExp | string }
    expect(typeof field.pattern === 'string' ? field.pattern : field.pattern?.source).toBe('[A-Z]{3}-\\d{4}')
    expect(exportFlowDocument(flow)).toEqual(form('[A-Z]{3}-\\d{4}'))
  })
})

describe('subflow expansion', () => {
  /** N flows where each one calls the next `fanout` times: the inlined tree grows as fanout^N. */
  function diamond(n: number, fanout: number, nested = false): Map<string, FlowDocument> {
    const docs = new Map<string, FlowDocument>()
    for (let i = 0; i < n; i++) {
      const calls = Array.from({ length: fanout }, () => ({ kind: 'subflow' as const, flowId: `f${i + 1}` }))
      const steps: FlowDocument['steps'] = i === n - 1
        ? [{ kind: 'say', text: 'leaf' }]
        : nested ? [{ kind: 'condition', if: 'true', then: calls }] : calls
      docs.set(`f${i}`, { version: 2, id: `f${i}`, trigger: `t${i}`, steps })
    }
    return docs
  }

  it('refuses a document whose subflows expand past the limit, quickly and before inlining', () => {
    for (const nested of [false, true]) {
      const docs = diamond(16, 3, nested)
      const started = performance.now()
      let error: unknown
      try { compileFlowDocument(docs.get('f0'), { resolveSubflow: (id) => docs.get(id) }) } catch (e) { error = e }
      expect(performance.now() - started, `nested=${nested}`).toBeLessThan(1000)
      expect(error, `nested=${nested}`).toBeInstanceOf(FlowDocumentError)
      expect((error as FlowDocumentError).issues[0]!.message).toMatch(/expand/)
    }
  })

  it('still compiles shared subflows that stay within the limit', () => {
    const docs = diamond(4, 3)
    const flow = compileFlowDocument(docs.get('f0'), { resolveSubflow: (id) => docs.get(id) })
    expect(flow.steps).toHaveLength(3)
  })
})

describe('digests', () => {
  it('a "__proto__" key inside an http body changes the digest', () => {
    const plain = doc([{ kind: 'http', method: 'POST', url: 'https://api.example.com/x', body: {} }])
    const tricky = JSON.parse('{"version":1,"id":"flow","trigger":"hola","steps":[{"kind":"http","method":"POST","url":"https://api.example.com/x","body":{"__proto__":{"admin":true}}}]}') as FlowDocument
    expect(validateFlowDocument(tricky)).toEqual([])
    expect(flowDigest(tricky)).not.toBe(flowDigest(plain))
    expect(sameFlow(tricky, plain)).toBe(false)
  })
})

describe('nested delays', () => {
  it('a delay inside a branch ends with bot.stop() instead of keeping a timer alive', async () => {
    const { bot, chat, provider } = await createTestBot()
    bot.registerFlow(compileFlowDocument({
      version: 2, id: 'later', trigger: 'later',
      steps: [{ kind: 'condition', if: 'true', then: [{ kind: 'say', text: 'espera' }, { kind: 'delay', duration: '5m' }, { kind: 'say', text: 'tarde' }] }],
    }))
    const timers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length
    const before = timers()
    await chat.send('later')
    await chat.expectReply('espera')
    await bot.stop({ timeout: 200 })
    await new Promise((resolve) => setImmediate(resolve))
    expect(timers()).toBeLessThanOrEqual(before)
    expect(provider.outbox.map((m) => JSON.stringify(m))).not.toContain(expect.stringContaining('tarde'))
  })
})

describe('fuzz', () => {
  let seed = 0xf10
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!

  it('parseExpression only ever throws ExpressionError and evaluation never throws', () => {
    const atoms = ['a', 'b.c', '$body', '__proto__', 'constructor', '1', '1e400', '"x"', "'y'", 'true', 'null', 'len(', 'oneOf(', 'number(', ')', '(', ',', '&&', '||', '==', '!=', '<', '>=', '+', '-', '!', '.', String.fromCharCode(92), '"', 'ðŸ¤–', ' ']
    const scope = { a: 'Ã±', b: { c: [1, 2] }, $body: '1,5', n: 3 }
    for (let i = 0; i < 5000; i++) {
      const src = Array.from({ length: 1 + Math.floor(rnd() * 12) }, () => pick(atoms)).join(rnd() < 0.5 ? ' ' : '')
      let ast
      try { ast = parseExpression(src) } catch (error) { expect(error, src).toBeInstanceOf(ExpressionError); continue }
      expect(() => evaluateExpression(ast, scope), src).not.toThrow()
    }
  })

  it('renderTemplate never reaches the prototype chain', () => {
    expect(renderTemplate('{{ __proto__ }}{{ constructor.name }}{{ a.__proto__.x }}', { a: {} })).toBe('')
  })

  it('every valid random document compiles and exports back to itself', () => {
    const text = () => pick(['hola', '{{ name }}', 'Ã±andÃº ðŸ¤–', 'x'.repeat(10)])
    const id = () => pick(['a', 'b', 'name', 'k1', 'x.y', 'z:1'])
    const step = (depth: number): unknown => {
      const kinds = depth > 2 ? ['say', 'ask', 'goto', 'end', 'delay'] : ['say', 'ask', 'choose', 'goto', 'end', 'delay', 'condition', 'media', 'guard', 'handoff', 'http']
      switch (pick(kinds)) {
        case 'say': return { kind: 'say', text: text() }
        case 'ask': return { kind: 'ask', text: text(), stateKey: id(), ...(rnd() < 0.3 ? { validate: { expr: pick(['len($answer) > 1', 'number($answer) >= 18', 'bad ((']) } } : {}) }
        case 'choose': return { kind: 'choose', text: text(), options: [{ key: 'a', label: 'A', ...(rnd() < 0.5 ? { steps: [step(depth + 1)] } : {}) }, { key: pick(['b', 'a']), label: 'B' }] }
        case 'goto': return { kind: 'goto', target: id() }
        case 'end': return rnd() < 0.5 ? { kind: 'end' } : { kind: 'end', text: text() }
        case 'delay': return { kind: 'delay', duration: pick(['1s', 10, '6m', -1, '2h']) }
        case 'condition': return { kind: 'condition', if: pick(['a == 1', 'len(name) > 2 && !empty(x)', '))']), then: [step(depth + 1)], ...(rnd() < 0.5 ? { else: [step(depth + 1)] } : {}) }
        case 'media': return { kind: 'media', type: pick(['image', 'document', 'location', 'gif']), source: pick([{ url: 'https://example.com/a.png' }, { stateKey: 'pic' }, { latitude: 4.6, longitude: -74 }, { url: 'file:///etc/passwd' }]), ...(rnd() < 0.3 ? { caption: text() } : {}) }
        case 'guard': return { kind: 'guard', if: 'n > 1', ...(rnd() < 0.7 ? { message: text() } : {}) }
        case 'handoff': return { kind: 'handoff', ...(rnd() < 0.5 ? { reason: 'r' } : {}) }
        default: return { kind: 'http', method: pick(['GET', 'POST', 'TRACE']), url: pick(['https://api.example.com/{{ id }}', 'https://{{ h }}/', 'ftp://x']), stateKey: 'r' }
      }
    }
    let valid = 0
    for (let i = 0; i < 1500; i++) {
      const document = { version: 2, id: id(), trigger: pick(['hola', ['a', 'b'], { keywords: ['x'], match: 'contains' }, '']), ...(rnd() < 0.3 ? { timeout: '5m' } : {}), steps: Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => step(0)) }
      const issues = validateFlowDocument(document)
      if (issues.length) {
        expect(() => compileFlowDocument(document)).toThrow(FlowDocumentError)
        continue
      }
      valid++
      const compiled = compileFlowDocument(document)
      expect(exportFlowDocument(compiled)).toEqual(document)
    }
    expect(valid).toBeGreaterThan(100)
  })
})
