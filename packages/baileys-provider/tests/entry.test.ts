/**
 * Entry layout of `@botmesh/baileys` (docs/release-readiness.md, API freeze): the main entry
 * holds what an application needs, with Baileys' native values typed as opaque aliases; the
 * JID helpers, identity store, mappers and other building blocks live in `/internal` (no
 * semver). The runtime names of each entry are pinned here so that growing the main entry is
 * a deliberate change, and the published declarations of the main entry are checked to never
 * reach `@whiskeysockets/baileys` (also enforced by `pnpm api-check`).
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import * as main from '../src/index.js'
import * as internal from '../src/internal.js'

/** Runtime exports of the main entry covered by semver. */
const MAIN_VALUES = ['BaileysProvider', 'RateLimiter', 'RateLimiterTimeout', 'isEditedMessage', 'toJid'] as const

/** Deprecated re-exports kept on the main entry until v3 (their home is `/internal`). */
const MAIN_DEPRECATED_VALUES = [
  'IdentityStore',
  'sanitizeNumber', 'normalizeJid', 'parseJid', 'buildJid', 'shortJid', 'isGroup', 'isBroadcast', 'isStatus',
  'isNewsletter', 'isPn', 'isLid', 'sameUser', 'toUserId', 'toChatId', 'isValidJid',
  'toMediaUpload', 'mediaToBuffer', 'makeSticker', 'transcodeToOpus', 'resolveRemoteMedia', 'REMOTE_MEDIA_MAX_BYTES',
  'classifyDisconnect', 'backoffDelay', 'MAX_RECONNECT_ATTEMPTS',
  'assertSessionDirectorySafe', 'removeSessionDirectory', 'resolveSessionDirectory',
  'toBaileysLogger', 'isBaileysLogger',
] as const

/** Removed from the main entry: their signatures use Baileys' own types. Only in `/internal`. */
const INTERNAL_ONLY = ['toInbound', 'toOutbound'] as const

const INTERNAL_VALUES = [
  'IdentityStore', 'canonicalKey',
  'toJid', 'sanitizeNumber', 'normalizeJid', 'parseJid', 'buildJid', 'shortJid', 'isGroup', 'isBroadcast', 'isStatus',
  'isNewsletter', 'isPn', 'isLid', 'sameUser', 'toUserId', 'toChatId', 'isValidJid', 'isPnUser', 'isLidUser',
  'normalizeInboundKey',
  'toInbound', 'editedMessageOf', 'isSystemMessage', 'isEditedMessage', 'toOutbound', 'toCallEvent', 'mapSendError',
  'toMediaUpload', 'mediaToBuffer', 'makeSticker', 'transcodeToOpus', 'resolveRemoteMedia', 'REMOTE_MEDIA_MAX_BYTES',
  'resolveFfmpeg', 'resolveFfmpegPath', 'FfmpegNotFoundError',
  'classifyDisconnect', 'backoffDelay', 'MAX_RECONNECT_ATTEMPTS',
  'assertSessionDirectorySafe', 'removeSessionDirectory', 'resolveSessionDirectory',
  'toBaileysLogger', 'isBaileysLogger',
  'socketOf', 'authStateOf',
] as const

describe('@botmesh/baileys entries', () => {
  it('pins the runtime names of the main entry', () => {
    expect(Object.keys(main).sort()).toEqual([...MAIN_VALUES, ...MAIN_DEPRECATED_VALUES].sort())
  })

  it('pins the runtime names of /internal', () => {
    expect(Object.keys(internal).sort()).toEqual([...INTERNAL_VALUES].sort())
  })

  it('keeps the Baileys-typed mappers off the main entry', () => {
    for (const name of INTERNAL_ONLY) {
      expect(main).not.toHaveProperty(name)
      expect(internal).toHaveProperty(name)
    }
  })

  it('every deprecated main export is the very same value /internal exports', () => {
    const m = main as Record<string, unknown>
    const i = internal as Record<string, unknown>
    for (const name of MAIN_DEPRECATED_VALUES) expect(m[name], name).toBe(i[name])
    for (const name of ['toJid', 'isEditedMessage'] as const) expect(m[name], name).toBe(i[name])
  })

  it('socketOf / authStateOf are typed views of provider.socket / provider.auth', () => {
    const p = new main.BaileysProvider({ session: 'entry-test' })
    expect(internal.socketOf(p)).toBeNull()
    expect(() => internal.authStateOf(p)).toThrow(/not started/)
    const fakeSock = { end: () => {} }
    ;(p as unknown as { sock: unknown }).sock = fakeSock
    expect(internal.socketOf(p)).toBe(fakeSock)
    expect(p.socket).toBe(fakeSock)
  })
})

/* Published declarations ---------------------------------------------------- */

const lib = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'lib')

/** Module specifiers a .d.ts imports or re-exports, comments stripped. */
function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  return [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm)].map((m) => m[1]!)
}

/** Bare specifiers imported by the .d.ts files reachable from `entry`, with the importing file. */
function reachableExternalImports(entry: string): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length) {
    const file = queue.pop()!
    if (seen.has(file) || !existsSync(file)) continue
    seen.add(file)
    for (const spec of importsOf(file)) {
      if (spec.startsWith('.')) queue.push(join(dirname(file), spec.replace(/\.js$/, '.d.ts')))
      else out.push([file, spec])
    }
  }
  return out
}

describe.skipIf(!existsSync(join(lib, 'index.d.ts')))('published declarations (needs pnpm build)', () => {
  it('the main entry never reaches @whiskeysockets/baileys: native values are opaque', () => {
    const leaks = reachableExternalImports(join(lib, 'index.d.ts')).filter(([, spec]) => spec.startsWith('@whiskeysockets/baileys'))
    expect(leaks).toEqual([])
  })

  it('/internal does use Baileys types (sanity check of the walker)', () => {
    const specs = reachableExternalImports(join(lib, 'internal.d.ts')).map(([, spec]) => spec)
    expect(specs).toContain('@whiskeysockets/baileys')
  })
})
