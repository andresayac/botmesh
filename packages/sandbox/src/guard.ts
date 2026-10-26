/**
 * Request guards for the hub's local web API. The sandbox listens on
 * 127.0.0.1, but any web page the developer opens can still reach it from the
 * browser, so every request is checked:
 *
 * - `Host` must name a loopback address (or one of `allowedHosts`) on the
 *   hub's own port: this defeats DNS rebinding, where a hostile domain is
 *   re-pointed at 127.0.0.1 and becomes "same origin" with the hub.
 * - `Origin` (and `Sec-Fetch-Site`), when the browser sends them, must be the
 *   hub's own origin: other sites cannot drive the API.
 * - State-changing calls (`POST`) also need the random per-run token, which
 *   the hub embeds in the page it serves and prints at start.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

/** Header that carries the per-run token on state-changing requests. */
export const SANDBOX_TOKEN_HEADER = 'x-sandbox-token'

/** A fresh random token (32 bytes, base64url). */
export function newSandboxToken(): string {
  return randomBytes(32).toString('base64url')
}

/** An error the hub answers with `status` and `{ error: message }`. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'HttpError'
  }
}

const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]']

/** Whether `host` (a bind address) is a loopback one. */
export function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '::1' || host === '[::1]' || /^127(\.\d{1,3}){3}$/.test(host)
}

export interface GuardOptions {
  /** Bind address of the hub. */
  bindHost: string
  /** Port the hub listens on. */
  port: number
  /** Extra host names accepted in `Host` / `Origin` (for a hub exposed on purpose). */
  allowedHosts?: readonly string[]
  token: string
}

export interface RequestGuard {
  /** Throws an {@link HttpError} when the request must be refused. */
  check(req: IncomingMessage, opts: { stateChanging: boolean }): void
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export function createGuard(opts: GuardOptions): RequestGuard {
  const names = new Set<string>(LOOPBACK)
  // A specific (non-wildcard) bind address is a valid way to reach the hub too.
  if (opts.bindHost && opts.bindHost !== '0.0.0.0' && opts.bindHost !== '::') names.add(opts.bindHost.includes(':') && !opts.bindHost.startsWith('[') ? `[${opts.bindHost}]` : opts.bindHost)
  for (const h of opts.allowedHosts ?? []) names.add(h.toLowerCase())
  const hosts = new Set([...names].map((n) => `${n.toLowerCase()}:${opts.port}`))
  // Port 80 is implicit in Host / Origin.
  if (opts.port === 80) for (const n of names) hosts.add(n.toLowerCase())
  const origins = new Set([...hosts].map((h) => `http://${h}`))
  const expected = Buffer.from(opts.token, 'utf8')

  return {
    check(req, { stateChanging }) {
      const host = (first(req.headers.host) ?? '').trim().toLowerCase()
      if (!hosts.has(host)) throw new HttpError(403, `Host ${JSON.stringify(host)} is not allowed: open the sandbox at http://127.0.0.1:${opts.port} (or pass allowedHosts)`)
      const origin = first(req.headers.origin)
      if (origin !== undefined && !origins.has(origin.toLowerCase())) throw new HttpError(403, `Origin ${JSON.stringify(origin)} is not allowed: the sandbox API only answers its own page`)
      const site = first(req.headers['sec-fetch-site'])
      if (site !== undefined && site !== 'same-origin' && site !== 'none') throw new HttpError(403, `cross-site request refused (Sec-Fetch-Site: ${site}); Origin must be the sandbox itself`)
      if (!stateChanging) return
      const given = Buffer.from(first(req.headers[SANDBOX_TOKEN_HEADER]) ?? '', 'utf8')
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
        throw new HttpError(401, `missing or wrong ${SANDBOX_TOKEN_HEADER} header (the token is printed when the sandbox starts and embedded in its page)`)
      }
    },
  }
}
