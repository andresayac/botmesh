/**
 * One Graph API request with a client-side timeout, shared by the Messenger Platform
 * transports (Messenger, Instagram): `fetch` + {@link readGraphResponse} under one
 * deadline, so a hung connection or a body that never finishes rejects instead of
 * blocking the chat's queue. Transport failures and timeouts reject with a typed
 * `ProviderError` (original as `cause`) whose message never includes the URL or token.
 */

import { ProviderError } from '@botmesh/core'
import { readGraphResponse, type GraphErrorOptions } from './errors.js'

/** Default time allowed for one Graph API request: 60 s (the Cloud API provider's default too). */
export const DEFAULT_GRAPH_REQUEST_TIMEOUT_MS = 60_000

/** Options of {@link graphRequest}. */
export interface GraphRequestOptions extends GraphErrorOptions {
  /** Time allowed for the request, body included, in ms. Default {@link DEFAULT_GRAPH_REQUEST_TIMEOUT_MS}. */
  timeoutMs?: number
  /** `fetch` implementation (test seam). Default the global `fetch`. */
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
}

function transportError(err: unknown, timeoutMs: number, timedOut: boolean): ProviderError {
  const wrapped = new ProviderError(timedOut
    ? `Graph API request timed out after ${timeoutMs}ms`
    : `Graph API request failed: ${err instanceof Error ? err.message : String(err)}`)
  ;(wrapped as { cause?: unknown }).cause = err
  return wrapped
}

/**
 * `fetch(url, init)` and read the Graph response (errors mapped by `readGraphResponse`)
 * within `timeoutMs`. Resolves with the parsed JSON body.
 */
export async function graphRequest<T = unknown>(url: string, init: RequestInit, opts: GraphRequestOptions = {}): Promise<T> {
  const { timeoutMs = DEFAULT_GRAPH_REQUEST_TIMEOUT_MS, fetch: fetchImpl = globalThis.fetch, ...errorOptions } = opts
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  try {
    let res: Response
    try {
      res = await fetchImpl(url, { ...init, signal: controller.signal })
    } catch (err) {
      throw transportError(err, timeoutMs, controller.signal.aborted)
    }
    let body: T
    try {
      body = await readGraphResponse<T>(res, errorOptions)
    } catch (err) {
      if (controller.signal.aborted && !(err instanceof ProviderError)) throw transportError(err, timeoutMs, true)
      throw err
    }
    // readGraphResponse reads an unreadable body as `{}`: an abort mid-body must not pass as success.
    if (controller.signal.aborted) throw transportError(controller.signal.reason, timeoutMs, true)
    return body
  } finally {
    clearTimeout(timer)
  }
}
