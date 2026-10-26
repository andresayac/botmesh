/**
 * Runtime hardening found by the release-test pass: values that come from `c.state` (an
 * end user's answer, an `http` response) must never reach the provider as a local path or
 * a non-http URL, `http` steps must not turn an error response into data, and errors must
 * not carry the rendered URL (query secrets, user data).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createTestBot } from '@botmesh/core/testing'
import { compileFlowDocument, validateFlowDocument, type CompileFlowOptions, type FlowDocument } from '../src/index.js'
import { resolvePath, renderTemplate } from '../src/internal.js'

const doc = (steps: FlowDocument['steps'], trigger = 'go'): FlowDocument => ({ version: 2, id: 'flow', trigger, steps })

const stops: Array<() => Promise<void>> = []
afterEach(async () => { while (stops.length) await stops.pop()!() })

async function botWith(document: FlowDocument, options?: CompileFlowOptions) {
  const t = await createTestBot()
  const errors: unknown[] = []
  t.bot.on('error', (e: unknown) => { errors.push(e) })
  t.bot.registerFlow(compileFlowDocument(document, options))
  stops.push(() => t.bot.stop())
  return { ...t, errors }
}

const mediaSent = (outbox: Array<{ content: unknown }>) => outbox.map((m) => m.content as { kind: string; media?: unknown }).filter((c) => c.kind !== 'text')
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

describe('media from c.state', () => {
  const answers = ['/etc/passwd', 'C:\\Windows\\win.ini', '..\\sessions\\creds.json', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/plain,hi', 'creds.json']

  for (const nested of [false, true]) {
    it(`never hands a local path or a non-http URL to the provider (${nested ? 'interpreted' : 'top-level'} step)`, async () => {
      for (const answer of answers) {
        const media = { kind: 'media' as const, type: 'image' as const, source: { stateKey: 'pic' }, ...(nested ? { caption: 'for {{ $from }}' } : {}) }
        const { chat, provider } = await botWith(doc([{ kind: 'ask', text: 'Photo URL?', stateKey: 'pic' }, media]))
        await chat.send('go')
        await chat.expectReply('Photo URL?')
        await chat.send(answer)
        await settle()
        expect(mediaSent(provider.outbox), answer).toEqual([])
      }
    })
  }

  it('also refuses { url } objects with a non-http scheme', async () => {
    const { chat, provider } = await botWith(doc([
      { kind: 'http', method: 'GET', url: 'https://api.example.com/pic', stateKey: 'pic' },
      { kind: 'media', type: 'document', source: { stateKey: 'pic' } },
    ]), { fetch: async () => ({ body: Buffer.from('{"url":"file:///etc/shadow"}'), response: new Response(null, { headers: { 'content-type': 'application/json' } }) }) as never })
    await chat.send('go')
    await settle()
    expect(mediaSent(provider.outbox)).toEqual([])
  })

  it('still sends an http(s) URL stored in state', async () => {
    for (const nested of [false, true]) {
      const media = { kind: 'media' as const, type: 'image' as const, source: { stateKey: 'pic' }, ...(nested ? { caption: 'hi {{ pic }}' } : {}) }
      const { chat, provider } = await botWith(doc([{ kind: 'ask', text: 'Photo URL?', stateKey: 'pic' }, media]))
      await chat.send('go')
      await chat.expectReply('Photo URL?')
      await chat.send('https://cdn.example.com/a.png')
      await settle()
      const sent = mediaSent(provider.outbox)
      expect(sent).toHaveLength(1)
      expect(JSON.stringify(sent[0]!.media)).toContain('https://cdn.example.com/a.png')
    }
  })

  it('refuses a state value that is not a URL (an object without url, a number)', async () => {
    for (const body of ['{"latitude":4.6,"longitude":-74}', '42']) {
      const { chat, provider } = await botWith(doc([
        { kind: 'http', method: 'GET', url: 'https://api.example.com/where', stateKey: 'where' },
        { kind: 'media', type: 'image', source: { stateKey: 'where' }, caption: 'at {{ $from }}' },
      ]), { fetch: async () => ({ body: Buffer.from(body), response: new Response(null, { headers: { 'content-type': 'application/json' } }) }) as never })
      await chat.send('go')
      await settle()
      expect(mediaSent(provider.outbox), body).toEqual([])
    }
  })
})

describe('http step responses and errors', () => {
  const reply = (status: number, body: string, type = 'application/json') => async () =>
    ({ body: Buffer.from(body), response: new Response(null, { status, headers: { 'content-type': type } }) }) as never

  it('a non-2xx response fails the step instead of being stored as data', async () => {
    const { chat, errors } = await botWith(doc([
      { kind: 'http', method: 'GET', url: 'https://api.example.com/orders', stateKey: 'orders' },
      { kind: 'say', text: 'got {{ orders }}' },
    ]), { fetch: reply(500, '{"error":"boom"}') })
    await chat.send('go')
    await settle()
    expect(chat.replies().join('\n')).not.toContain('got')
    expect(String((errors[0] as { error?: unknown })?.error ?? errors[0])).toMatch(/HTTP 500/)
  })

  it('errors name the request without the rendered query or user values', async () => {
    const { chat, errors } = await botWith(doc([
      { kind: 'ask', text: 'Order?', stateKey: 'id' },
      { kind: 'http', method: 'GET', url: 'https://api.example.com/orders/{{ id }}?api_key=SECRET123', stateKey: 'o' },
    ]), { fetch: reply(200, 'not json') })
    await chat.send('go')
    await chat.expectReply('Order?')
    await chat.send('maria@example.com')
    await settle()
    const text = errors.map((e) => { const err = (e as { error?: unknown }).error ?? e; return err instanceof Error ? err.message : String(err) }).join('\n')
    expect(text).toMatch(/invalid JSON/)
    expect(text).not.toContain('SECRET123')
    expect(text).not.toContain('maria')
  })

  it('refuses a header value that renders with a line break (no header injection, no value in the error)', async () => {
    const seen: unknown[] = []
    const { chat, errors } = await botWith(doc([
      { kind: 'ask', text: 'Name?', stateKey: 'n' },
      { kind: 'http', method: 'GET', url: 'https://api.example.com/x', headers: { 'X-Name': '{{ n }}' } },
    ]), { fetch: async (u, o) => { seen.push(o); return { body: Buffer.from(''), response: new Response(null) } as never } })
    await chat.send('go')
    await chat.expectReply('Name?')
    await chat.send('ana\r\nX-Admin: true')
    await settle()
    expect(seen).toEqual([])
    const text = errors.map((e) => String((e as { error?: unknown }).error ?? e)).join('\n')
    expect(text).toMatch(/X-Name/)
    expect(text).not.toContain('X-Admin')
  })

  it('rejects invalid http / form options at compile time with a clear message', () => {
    const d = doc([{ kind: 'say', text: 'x' }])
    expect(() => compileFlowDocument(d, { http: { timeoutMs: 0 } })).toThrow(/http\.timeoutMs/)
    expect(() => compileFlowDocument(d, { http: { maxBytes: -1 } })).toThrow(/http\.maxBytes/)
    expect(() => compileFlowDocument(d, { formTimeoutMs: Number.NaN })).toThrow(/formTimeoutMs/)
  })
})

describe('state keys with dots', () => {
  it('templates and expressions read a dotted stateKey written by ask', async () => {
    const { chat } = await botWith(doc([
      { kind: 'ask', text: 'Name?', stateKey: 'user.name' },
      { kind: 'condition', if: 'len(user.name) > 2', then: [{ kind: 'say', text: 'Hi {{ user.name }}' }], else: [{ kind: 'say', text: 'short' }] },
    ]))
    await chat.send('go')
    await chat.expectReply('Name?')
    await chat.send('Lucía')
    await chat.expectReply('Hi Lucía')
  })

  it('nested objects still win over a literal dotted key', () => {
    expect(resolvePath({ user: { name: 'nested' }, 'user.name': 'flat' }, ['user', 'name'])).toBe('nested')
    expect(resolvePath({ 'a.b': { c: 1 } }, ['a', 'b', 'c'])).toBe(1)
    expect(renderTemplate('{{ a.b }}', { 'a.b': 'x' })).toBe('x')
    expect(resolvePath({ 'a.__proto__': 1 }, ['a', '__proto__'])).toBeUndefined()
  })
})

describe('validator parity with FLOW_DOCUMENT_SCHEMA', () => {
  const form = (field: Record<string, unknown>) => doc([{ kind: 'form', form: { id: 'f', fields: [{ name: 'n', label: 'L', ...field } as never] } }])
  const paths = (d: unknown) => validateFlowDocument(d).map((i) => i.path)

  it('bounds select options like the schema (count and label length)', () => {
    expect(paths(form({ type: 'select', options: Array.from({ length: 21 }, (_, i) => `o${i}`) }))).toContain('/steps/0/form/fields/0/options')
    expect(paths(form({ type: 'multiselect', options: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, 'v'])) }))).toContain('/steps/0/form/fields/0/options')
    expect(paths(form({ type: 'select', options: ['x'.repeat(201)] }))).toContain('/steps/0/form/fields/0/options')
    expect(paths(form({ type: 'select', options: Array.from({ length: 20 }, (_, i) => `o${i}`) }))).toEqual([])
  })

  it('checks field properties whatever the field type', () => {
    expect(paths(form({ type: 'text', min: 'x'.repeat(30) }))).toContain('/steps/0/form/fields/0/min')
    expect(paths(form({ type: 'number', minLength: 1.5 }))).toContain('/steps/0/form/fields/0/minLength')
  })

  it('refuses contradictory field bounds that no answer can satisfy', () => {
    expect(paths(form({ type: 'text', minLength: 20, maxLength: 5 }))).toContain('/steps/0/form/fields/0/minLength')
    expect(paths(form({ type: 'number', min: 10, max: 1 }))).toContain('/steps/0/form/fields/0/min')
    expect(paths(form({ type: 'date', min: '2020-13-45' }))).toContain('/steps/0/form/fields/0/min')
    expect(paths(form({ type: 'date', min: '2025-01-02', max: '2025-01-01' }))).toContain('/steps/0/form/fields/0/min')
    expect(paths(form({ type: 'multiselect', options: ['a', 'b'], minSelected: 3 }))).toContain('/steps/0/form/fields/0/minSelected')
    expect(paths(form({ type: 'multiselect', options: ['a', 'b', 'c'], minSelected: 2, maxSelected: 1 }))).toContain('/steps/0/form/fields/0/minSelected')
  })

  it('bounds location name / address and refuses a source with both url and stateKey', () => {
    const loc = (source: Record<string, unknown>) => doc([{ kind: 'media', type: 'location', source: { latitude: 1, longitude: 2, ...source } as never }])
    expect(paths(loc({ name: 'n'.repeat(201) }))).toContain('/steps/0/source/name')
    expect(paths(loc({ address: 'a'.repeat(501) }))).toContain('/steps/0/source/address')
    expect(paths(doc([{ kind: 'media', type: 'image', source: { url: 'https://e.com/a', stateKey: 'k' } as never }]))).toContain('/steps/0/source')
  })

  it('counts text length in characters (code points) like JSON Schema, so emoji do not count twice', () => {
    expect(validateFlowDocument(doc([{ kind: 'say', text: '🤖'.repeat(4096) }]))).toEqual([])
    expect(paths(doc([{ kind: 'say', text: '🤖'.repeat(4097) }]))).toContain('/steps/0/text')
    expect(validateFlowDocument({ ...doc([{ kind: 'say', text: 'x' }]), name: 'ñ🤖'.repeat(100) })).toEqual([])
  })
})

describe('expression scope mistakes', () => {
  const issuesOf = (steps: FlowDocument['steps']) => validateFlowDocument(doc(steps))

  it('flags state paths in ask.validate.expr (only $answer and the message fields exist there)', () => {
    const issues = issuesOf([{ kind: 'ask', text: 'Age?', stateKey: 'age', validate: { expr: 'number(age) >= 18' } }])
    expect(issues.map((i) => i.path)).toContain('/steps/0/validate/expr')
    expect(issues[0]!.message).toMatch(/\$answer/)
    expect(issuesOf([{ kind: 'ask', text: 'Age?', stateKey: 'age', validate: { expr: 'number($answer) >= 18 && !$isGroup' } }])).toEqual([])
  })

  it('flags $answer and unknown $ variables outside ask.validate', () => {
    expect(issuesOf([{ kind: 'condition', if: '$answer == 1', then: [{ kind: 'say', text: 'x' }] }]).map((i) => i.path)).toContain('/steps/0/if')
    expect(issuesOf([{ kind: 'guard', if: '$user == 1', message: 'no' }]).map((i) => i.path)).toContain('/steps/0/if')
    expect(issuesOf([{ kind: 'condition', if: '$body == "hi" && name != ""', then: [{ kind: 'say', text: 'x' }] }])).toEqual([])
  })
})

describe('form patterns against long answers', () => {
  const form = (field: Record<string, unknown>) => doc([{ kind: 'form', form: { id: 'f', fields: [{ name: 'n', label: 'L', type: 'text', ...field } as never] } }])

  it('caps the answer length of a field with a pattern (the linear matcher still costs length x states)', () => {
    expect(validateFlowDocument(form({ pattern: 'a*.{0,990}x', maxLength: 65536 })).map((i) => i.path)).toContain('/steps/0/form/fields/0/maxLength')
    expect(validateFlowDocument(form({ pattern: 'a*.{0,990}x', maxLength: 1000 }))).toEqual([])
    expect(validateFlowDocument(form({ maxLength: 65536 }))).toEqual([])
  })
})

describe('reverse export', () => {
  it('returns a copy: mutating an exported document does not change the compiled flow', async () => {
    const { exportFlowDocument } = await import('../src/index.js')
    const flow = compileFlowDocument({ ...doc([{ kind: 'say', text: 'hola' }]), trigger: { keywords: ['go'] } })
    const first = exportFlowDocument(flow)
    ;(first.steps[0] as { text: string }).text = 'tampered'
    ;(first.trigger as { keywords: string[] }).keywords.push('x')
    const second = exportFlowDocument(flow)
    expect(second.steps[0]).toEqual({ kind: 'say', text: 'hola' })
    expect(second.trigger).toEqual({ keywords: ['go'] })
  })
})

describe('load and lifecycle', () => {
  it('serves 200 concurrent chats, then stops mid-flight without leaking timers', async () => {
    const { bot, provider } = await createTestBot()
    let calls = 0
    bot.registerFlow(compileFlowDocument(doc([
      { kind: 'ask', text: 'Name?', stateKey: 'name', timeout: '1h' },
      { kind: 'http', method: 'GET', url: 'https://api.example.com/greet/{{ name }}', stateKey: 'g' },
      { kind: 'say', text: '{{ g.text }} {{ name }}' },
      { kind: 'condition', if: 'len(name) > 3', then: [{ kind: 'delay', duration: '5m' }, { kind: 'say', text: 'late' }] },
    ]), { fetch: async () => { calls++; await new Promise((r) => setTimeout(r, 5)); return { body: Buffer.from('{"text":"Hola"}'), response: new Response(null, { headers: { 'content-type': 'application/json' } }) } as never } }))
    const timers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length
    const before = timers()
    const chats = Array.from({ length: 200 }, (_, i) => `chat-${i}`)
    for (const from of chats) provider.incoming('go', { from })
    await new Promise((r) => setTimeout(r, 200))
    chats.forEach((from, i) => provider.incoming(i % 2 ? `Ñandú ${i} 🤖` : 'Al', { from }))
    await new Promise((r) => setTimeout(r, 600))
    const texts = provider.outbox.map((m) => (m.content as { text?: string }).text ?? '')
    expect(calls).toBe(200)
    expect(texts.filter((t) => t.startsWith('Hola '))).toHaveLength(200)
    expect(texts).toContain('Hola Ñandú 1 🤖')
    await bot.stop({ timeout: 500 })
    await new Promise((r) => setImmediate(r))
    expect(timers()).toBeLessThanOrEqual(before)
    expect(texts).not.toContain('late')
  })
})

describe('http step body', () => {
  it('renders {{ path }} placeholders in string values; a value that is exactly one placeholder keeps its JSON type', async () => {
    const bodies: unknown[] = []
    const { chat } = await botWith(doc([
      { kind: 'ask', text: 'Name?', stateKey: 'name' },
      { kind: 'ask', text: 'Age?', stateKey: 'age' },
      { kind: 'http', method: 'POST', url: 'https://api.example.com/leads', stateKey: 'r', body: { greeting: 'Hi {{ name }}!', name: '{{ name }}', missing: '{{ nope }}', tags: ['{{ $from }}', 'fixed'], nested: { raw: '{{ r0 }}' }, n: 1 } },
      { kind: 'say', text: 'done' },
    ]), { fetch: async (_u, o) => { bodies.push(JSON.parse(String(o.body))); return { body: Buffer.from('{}'), response: new Response(null, { headers: { 'content-type': 'application/json' } }) } as never } })
    await chat.send('go')
    await chat.expectReply('Name?')
    await chat.send('Ana "quoted" {{ age }}')
    await chat.expectReply('Age?')
    await chat.send('30')
    await chat.expectReply('done')
    expect(bodies[0]).toEqual({ greeting: 'Hi Ana "quoted" {{ age }}!', name: 'Ana "quoted" {{ age }}', missing: null, tags: [expect.any(String), 'fixed'], nested: { raw: null }, n: 1 })
  })
})

describe('reverse export of DSL flows', () => {
  it('throws FlowExportError instead of returning a document the validator would refuse', async () => {
    const { flow } = await import('@botmesh/core')
    const { exportFlowDocument, FlowExportError } = await import('../src/index.js')
    const bad = { ...flow('hola').say('x').compile(), id: 'bad id' }
    expect(() => exportFlowDocument(bad)).toThrow(FlowExportError)
    expect(() => exportFlowDocument(bad)).toThrow(/\/id/)
    const longDelay = flow('hola').say('x').delay(600_000).compile()
    expect(() => exportFlowDocument(longDelay)).toThrow(/duration/)
  })
})
