/**
 * Session-window surface decision (docs/guide/session-window.md, "API stability"):
 *
 * - Public and covered by semver: what an app configures and queries. `SessionWindowManager`
 *   (constructor, `forScope`, `state`, `isOpen`, `expiresAt`, `pending`, `clearPending`),
 *   `SessionWindowOptions`, the `SessionWindowStore` contract with its reference
 *   `MemorySessionWindowStore`, the report and reopen types, `SessionWindowReopenedError`
 *   and the constants.
 * - `@experimental` (provider plumbing, outside semver): the hooks `CloudAPIProvider` drives
 *   (`send`, `noteInbound`, `noteFailedStatus`) and their `RawSend` type. Calling them by hand
 *   skips the provider's one-time media upload and status bookkeeping.
 *
 * The runtime names of the entry are pinned so growing it is a deliberate change.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import * as entry from '../src/index.js'

const MAIN_VALUES = [
  'CloudAPIProvider', 'DEFAULT_FLOW_JSON_VERSION', 'FLOW_LIMITS', 'FLOW_MESSAGE_VERSION', 'MemoryIdentityMap',
  'MemorySessionWindowStore', 'SESSION_WINDOW_ERROR_CODE', 'SESSION_WINDOW_MS', 'SessionWindowManager',
  'SessionWindowReopenedError', 'UsageTracker', 'flowJsonWarnings', 'flowRefOf', 'flowScreenId', 'isBsuid',
  'parseConversation', 'parseInbound', 'parsePricing', 'pricingOf', 'statusPlatformData', 'toFlowJson',
  'toFlowMessage', 'toOutbound',
]

/** Deprecated re-exports (graph-core is their home). */
const MAIN_DEPRECATED_VALUES = ['GraphClient', 'toProviderError', 'verifyChallenge', 'verifySignature']

const source = readFileSync(new URL('../src/sessionWindow.ts', import.meta.url), 'utf8')

/** The TSDoc block right before `marker` in sessionWindow.ts. */
function docBefore(marker: string): string {
  const at = source.indexOf(marker)
  expect(at, marker).toBeGreaterThan(0)
  const open = source.lastIndexOf('/**', at)
  const close = source.indexOf('*/', open)
  expect(close).toBeLessThan(at)
  expect(source.slice(close + 2, at).trim()).toBe('')
  return source.slice(open, close)
}

describe('@botmesh/meta entry', () => {
  it('exports exactly these runtime names', () => {
    expect(Object.keys(entry).sort()).toEqual([...MAIN_VALUES, ...MAIN_DEPRECATED_VALUES].sort())
  })
})

describe('session-window API stability', () => {
  it.each([
    'async send(',
    'async noteInbound(',
    'async noteFailedStatus(',
    'export type RawSend',
  ])('%s is provider plumbing marked @experimental', (marker) => {
    expect(docBefore(marker)).toMatch(/^\s*\*\s*@experimental\b/m)
  })

  it.each([
    'export class SessionWindowManager',
    'export class MemorySessionWindowStore',
    'export interface SessionWindowStore',
    'export interface SessionWindowOptions',
    'forScope(scope: string)',
    'async state(chatId',
    'pending(chatId: ChatId): number',
    'clearPending(chatId',
  ])('%s stays public and stable (no @experimental / @internal)', (marker) => {
    expect(docBefore(marker)).not.toMatch(/^\s*\*\s*@(experimental|internal)\b/m)
  })
})
