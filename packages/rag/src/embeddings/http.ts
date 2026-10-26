import { secureFetch, type SecureFetchOptions } from '@botmesh/http'
import { RagError } from '../errors.js'

/**
 * Transport knobs forwarded to `secureFetch` (anti-SSRF client of
 * `@botmesh/http`): `allowHttp` / `allowPrivateHosts` for self-hosted
 * endpoints, `timeoutMs`, `maxBytes`, and `fetch` / `resolver` for tests.
 */
export type EmbeddingHttpOptions = Pick<
  SecureFetchOptions,
  'allowHttp' | 'allowPrivateHosts' | 'timeoutMs' | 'maxBytes' | 'maxRedirects' | 'fetch' | 'resolver'
>

/** Scheme, host and port only: the path or query string may carry a token. */
function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return '(invalid URL)'
  }
}

/** First `code` (`ECONNREFUSED`, `ENOTFOUND`...) along the `cause` chain. */
function errorCode(err: unknown): string | undefined {
  for (let e = err, i = 0; e && typeof e === 'object' && i < 5; e = (e as { cause?: unknown }).cause, i++) {
    const code = (e as { code?: unknown }).code
    if (typeof code === 'string' && code) return code
  }
  return undefined
}

/** POST a JSON body and parse a JSON answer; non-2xx → `RagError('EMBEDDING_FAILED')`. */
export async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  http: EmbeddingHttpOptions,
  signal?: AbortSignal,
): Promise<unknown> {
  let result
  try {
    result = await secureFetch(url, {
      timeoutMs: 30_000,
      ...http,
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    })
  } catch (cause) {
    const code = errorCode(cause)
    const detail = `${(cause as Error)?.message ?? String(cause)}${code && !String((cause as Error)?.message).includes(code) ? ` (${code})` : ''}`
    throw new RagError('EMBEDDING_FAILED', `embedding request to ${originOf(url)} failed: ${detail}`, { cause })
  }
  if (!result.response.ok) {
    // Never echo the response body: it may contain the request (and our texts).
    throw new RagError('EMBEDDING_FAILED', `embedding endpoint ${originOf(url)} answered HTTP ${result.response.status}`)
  }
  try {
    return JSON.parse(result.body.toString('utf8')) as unknown
  } catch (cause) {
    throw new RagError('EMBEDDING_FAILED', 'embedding endpoint returned invalid JSON', { cause })
  }
}

/** Validate a vector list returned by a remote embedder. */
export function assertVectors(vectors: unknown, expected: number): number[][] {
  if (!Array.isArray(vectors) || vectors.length !== expected) {
    throw new RagError('EMBEDDING_FAILED', `expected ${expected} embeddings, got ${Array.isArray(vectors) ? vectors.length : typeof vectors}`)
  }
  let dim: number | undefined
  for (const v of vectors) {
    if (!Array.isArray(v) || v.length === 0 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) {
      throw new RagError('EMBEDDING_FAILED', 'embedding endpoint returned a malformed vector')
    }
    if (dim !== undefined && v.length !== dim) throw new RagError('EMBEDDING_FAILED', 'embedding endpoint returned vectors of different sizes')
    dim = v.length
  }
  return vectors as number[][]
}
