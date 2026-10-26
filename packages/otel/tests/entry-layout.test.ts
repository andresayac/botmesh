/**
 * Entry layout of `@botmesh/otel`: the main entry holds the tracer factories, the metrics bridge
 * and the lazy loader of `@opentelemetry/api`; the span-derived histogram recorder lives in
 * `@botmesh/otel/internal` (no semver). The runtime names of both entries are pinned so growing
 * them is deliberate.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import * as main from '../src/index.js'
import * as internal from '../src/internal.js'

const MAIN_VALUES = [
  'bridgeMetrics', 'createOtelTracer', 'lazyOtelTracer', 'loadOtelApi', 'otelMetricsPlugin', 'otelTracer', 'registerOtelMetrics',
] as const

const INTERNAL_VALUES = ['METRIC_SOURCE_KEYS', 'SpanMetrics'] as const

const keysOf = (ns: object) => Object.keys(ns).sort()

describe('@botmesh/otel entry layout', () => {
  it('the main entry exports exactly the application values', () => {
    expect(keysOf(main)).toEqual([...MAIN_VALUES].sort())
  })

  it('/internal exports the span-metrics recorder', () => {
    expect(keysOf(internal)).toEqual([...INTERNAL_VALUES].sort())
  })

  it('importing the entries does not load @opentelemetry/api', () => {
    for (const file of ['../src/index.ts', '../src/internal.ts', '../src/tracer.ts', '../src/metrics.ts', '../src/spanMetrics.ts', '../src/load.ts']) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(src, file).not.toMatch(/^import\s+(?!type\b)[^\n]*['"]@opentelemetry\//m)
    }
  })

  it('package.json exposes ./internal next to the main entry', () => {
    const pj = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { exports: Record<string, unknown> }
    expect(Object.keys(pj.exports).sort()).toEqual(['.', './internal'])
    expect(pj.exports['./internal']).toEqual({ types: './lib/internal.d.ts', default: './lib/internal.js' })
  })
})
