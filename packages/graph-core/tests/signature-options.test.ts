/**
 * `checkGraphSignature` takes one options object (`{ body, headers, appSecret, logger }`).
 * The positional form `(body, headers, appSecret, logger?)` is a deprecated overload that
 * behaves the same. The runtime names of the entry are pinned: graph-core is a public
 * package covered by semver, so growing it is a deliberate change.
 */
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import * as entry from '../src/index.js'
import { checkGraphSignature, type GraphSignatureOptions } from '../src/index.js'

const secret = 'app-secret'
const body = '{"object":"page"}'
const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')

describe('@botmesh/graph-core entry', () => {
  it('exports exactly these runtime names', () => {
    expect(Object.keys(entry).sort()).toEqual([
      'DEFAULT_GRAPH_API_VERSION', 'DEFAULT_GRAPH_REQUEST_TIMEOUT_MS', 'META_MEDIA_HOSTS', 'checkGraphSignature',
      'graphRequest', 'parseGraphBody', 'readGraphResponse', 'rehydrateUrlMediaRef', 'serializeUrlMediaRef',
      'toGraphError', 'tryParseGraphBody', 'verifyChallenge', 'verifySignature',
    ])
  })
})

describe('checkGraphSignature({ ... })', () => {
  it('accepts a correctly signed raw body', () => {
    expect(checkGraphSignature({ body, headers: { 'x-hub-signature-256': sig }, appSecret: secret })).toEqual({ ok: true })
  })

  it('rejects a missing or wrong signature with 403 and logs why', () => {
    const warnings: string[] = []
    const logger = { warn: (m: string) => warnings.push(m) }
    expect(checkGraphSignature({ body, headers: {}, appSecret: secret, logger })).toEqual({ ok: false, status: 403 })
    expect(checkGraphSignature({ body, appSecret: secret })).toEqual({ ok: false, status: 403 })
    expect(warnings).toEqual(['webhook rejected: invalid X-Hub-Signature-256'])
  })

  it('lets the request through without an appSecret', () => {
    expect(checkGraphSignature({ body })).toEqual({ ok: true })
    expect(checkGraphSignature({ body: { parsed: true }, appSecret: undefined })).toEqual({ ok: true })
  })

  it('rejects an already parsed body with 400 when an appSecret is set', () => {
    const options: GraphSignatureOptions = { body: { object: 'page' }, headers: { 'x-hub-signature-256': sig }, appSecret: secret }
    expect(checkGraphSignature(options)).toEqual({ ok: false, status: 400 })
  })
})

describe('checkGraphSignature(body, headers, appSecret, logger?) (deprecated)', () => {
  it('still works and gives the same answers', () => {
    expect(checkGraphSignature(body, { 'x-hub-signature-256': sig }, secret)).toEqual({ ok: true })
    expect(checkGraphSignature(body, {}, secret)).toEqual({ ok: false, status: 403 })
    expect(checkGraphSignature(body, {}, undefined)).toEqual({ ok: true })
  })

  it('treats a lone parsed body with headers as the old form, not as options', () => {
    // Two or more arguments always mean the positional form, whatever the body looks like.
    const lookalike = { body, appSecret: 'not-the-secret' }
    expect(checkGraphSignature(lookalike, { 'x-hub-signature-256': sig }, secret)).toEqual({ ok: false, status: 400 })
  })
})
