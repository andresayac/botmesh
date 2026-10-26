/**
 * Entry layout of `@botmesh/server`: the main entry holds the ingress, the node/fetch serving
 * helpers, the body readers (for custom adapters) and their errors; the framework adapters live
 * in `/express`, `/fastify` and `/hono`; the path helpers live in `@botmesh/server/internal`
 * (no semver). The runtime names of every entry are pinned so growing them is deliberate.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import * as main from '../src/index.js'
import * as internal from '../src/internal.js'
import * as express from '../src/adapters/express.js'
import * as fastify from '../src/adapters/fastify.js'
import * as hono from '../src/adapters/hono.js'

const MAIN_VALUES = [
  'BodyAbortedError', 'BodyTimeoutError', 'BodyTooLargeError', 'BodyUnavailableError',
  'DEFAULT_BODY_TIMEOUT_MS', 'DEFAULT_INGEST_TIMEOUT_MS', 'DEFAULT_MAX_BODY_BYTES', 'DEFAULT_MAX_CONCURRENT',
  'createFetchHandler', 'createIngress', 'createNodeHandler', 'readNodeBody', 'readWebBody', 'serveFetch', 'serveNode',
] as const

const INTERNAL_VALUES = ['normalizePath', 'splitUrl'] as const

const keysOf = (ns: object) => Object.keys(ns).sort()

describe('@botmesh/server entry layout', () => {
  it('the main entry exports exactly the application values', () => {
    expect(keysOf(main)).toEqual([...MAIN_VALUES].sort())
  })

  it('/internal exports the path helpers', () => {
    expect(keysOf(internal)).toEqual([...INTERNAL_VALUES].sort())
  })

  it('each adapter subpath exports only its factory', () => {
    expect(keysOf(express)).toEqual(['expressIngress'])
    expect(keysOf(fastify)).toEqual(['fastifyIngress'])
    expect(keysOf(hono)).toEqual(['honoIngress'])
  })

  it('package.json exposes the adapters and ./internal next to the main entry', () => {
    const pj = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { exports: Record<string, unknown> }
    expect(Object.keys(pj.exports).sort()).toEqual(['.', './express', './fastify', './hono', './internal'])
    expect(pj.exports['./internal']).toEqual({ types: './lib/internal.d.ts', default: './lib/internal.js' })
  })
})
