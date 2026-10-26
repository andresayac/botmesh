import { describe, expect, it } from 'vitest'
import { formToObject, validate, type Schema } from '../src/sim/validate.js'

describe('validate (JSON Schema subset used by the vendored OpenAPI fragments)', () => {
  it('resolves $ref against the root $defs, including recursive definitions', () => {
    const schema: Schema = {
      type: 'object',
      properties: { node: { $ref: '#/$defs/Node' } },
      $defs: { Node: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, child: { $ref: '#/$defs/Node' } } } },
    }
    expect(validate(schema, { node: { id: 'a', child: { id: 'b' } } })).toEqual([])
    expect(validate(schema, { node: { id: 'a', child: { id: 3 } } })).toEqual(['$.node.child.id: expected string, got integer'])
  })

  it('reports an unresolvable $ref instead of throwing', () => {
    expect(validate({ $ref: '#/$defs/Missing' }, {})).toEqual(['$: unresolvable $ref #/$defs/Missing'])
  })

  it('requires every allOf branch and checks sibling keywords too', () => {
    const schema: Schema = { allOf: [{ type: 'object', required: ['a'] }, { required: ['b'] }], properties: { a: { type: 'string' } } }
    expect(validate(schema, { a: 'x', b: 1 })).toEqual([])
    expect(validate(schema, { a: 1 })).toEqual(['$.b: required', '$.a: expected string, got integer'])
  })

  it('checks uniqueItems and ignores format annotations', () => {
    expect(validate({ type: 'array', uniqueItems: true }, ['a', 'a'])).toEqual(['$: items are not unique'])
    expect(validate({ type: 'string', format: 'uri' }, 'not a uri')).toEqual([])
  })

  it('does not throw on a pattern the u flag rejects', () => {
    // `[\w-.]` is a syntax error with the u flag but valid (word chars, '-', '.') without it.
    expect(validate({ type: 'string', pattern: '^[\\w-.]+$' }, 'ok-1.2')).toEqual([])
    // A pattern that compiles in neither mode is reported, not thrown.
    expect(validate({ type: 'string', pattern: '(' }, 'x')).toEqual(['$: invalid pattern /(/'])
  })

  it('formToObject turns form fields into typed values following the schema', () => {
    const schema: Schema = { type: 'object', properties: { To: { type: 'string' }, MediaUrl: { type: 'array', items: { type: 'string' } }, Attempt: { type: 'integer' }, SendAsMms: { type: 'boolean' } } }
    const form = new URLSearchParams([['To', 'whatsapp:+1'], ['MediaUrl', 'https://a'], ['MediaUrl', 'https://b'], ['Attempt', '2'], ['SendAsMms', 'true'], ['Other', 'x']])
    expect(formToObject(form, schema)).toEqual({ To: 'whatsapp:+1', MediaUrl: ['https://a', 'https://b'], Attempt: 2, SendAsMms: true, Other: 'x' })
    // Values that are not valid for the declared type are kept as strings so the validator reports them.
    expect(formToObject(new URLSearchParams('Attempt=abc&SendAsMms=yes'), schema)).toEqual({ Attempt: 'abc', SendAsMms: 'yes' })
  })
})
