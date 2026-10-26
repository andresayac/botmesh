/**
 * JSON-RPC 2.0 and the MCP stdio framing, hand-rolled so this package has no dependencies
 * (the same choice as `@botmesh/server` and `@botmesh/manager`).
 *
 * The stdio transport is **newline-delimited JSON**: one message per line, never pretty
 * printed, and nothing else may be written to stdout. {@link LineDecoder} tolerates
 * messages split across chunks, `\r\n` line endings and a final line without a newline.
 */

/** The only JSON-RPC version this server speaks. */
export const JSONRPC_VERSION = '2.0'

export type JsonRpcId = string | number

/** A request (with `id`) or a notification (without one). */
export interface JsonRpcRequest {
  jsonrpc: string
  id?: JsonRpcId
  method: string
  params?: unknown
}

export interface JsonRpcErrorBody {
  code: number
  message: string
  data?: unknown
}

export interface JsonRpcResult {
  jsonrpc: '2.0'
  id: JsonRpcId | null
  result: unknown
}

export interface JsonRpcFailure {
  jsonrpc: '2.0'
  id: JsonRpcId | null
  error: JsonRpcErrorBody
}

/** Standard JSON-RPC codes (MCP reuses them as-is). */
export const RPC_ERROR = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const

/** Narrow an untrusted value to a JSON-RPC request (an `id` of the wrong type is a bug, not a request). */
export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (candidate.jsonrpc !== JSONRPC_VERSION) return false
  if (typeof candidate.method !== 'string' || candidate.method === '') return false
  const id = candidate.id
  if (id !== undefined && typeof id !== 'string' && typeof id !== 'number') return false
  return true
}

/** The `id` to echo in an error, when the message carried one. */
export function idOf(value: unknown): JsonRpcId | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const id = (value as Record<string, unknown>).id
  return typeof id === 'string' || typeof id === 'number' ? id : null
}

export function resultResponse(id: JsonRpcId | null, value: unknown): JsonRpcResult {
  return { jsonrpc: JSONRPC_VERSION, id, result: value }
}

export function errorResponse(id: JsonRpcId | null, code: number, message: string, data?: unknown): JsonRpcFailure {
  const error: JsonRpcErrorBody = data === undefined ? { code, message } : { code, message, data }
  return { jsonrpc: JSONRPC_VERSION, id, error }
}

/** One protocol message (or a batch of them) as a single line (no trailing newline). */
export function encodeMessage(message: JsonRpcResult | JsonRpcFailure | ReadonlyArray<JsonRpcResult | JsonRpcFailure>): string {
  return JSON.stringify(message)
}

/** A line dropped because it was longer than the decoder's `maxLineLength`. */
export interface OversizedLine {
  readonly oversized: true
  /** Characters the line had (counted up to its end, never kept in memory). */
  readonly length: number
}

/**
 * Reassembles newline-delimited messages from arbitrary chunks.
 *
 * With a `maxLineLength`, a line that grows past it is discarded while it streams in (memory
 * stays bounded) and reported once, in order, as an {@link OversizedLine} when it ends.
 * Only the new chunk is scanned for the newline, so a long line costs linear time.
 */
export class LineDecoder {
  private parts: string[] = []
  private length = 0
  private discarding = false

  constructor(readonly maxLineLength: number = Number.POSITIVE_INFINITY) {}

  push(chunk: string): Array<string | OversizedLine> {
    const out: Array<string | OversizedLine> = []
    let start = 0
    for (;;) {
      const index = chunk.indexOf('\n', start)
      if (index < 0) {
        this.append(chunk.slice(start))
        break
      }
      this.append(chunk.slice(start, index))
      start = index + 1
      this.emit(out)
    }
    return out
  }

  /** Lines left when the stream ends mid-line (a client that did not end with `\n`). */
  flush(): Array<string | OversizedLine> {
    const out: Array<string | OversizedLine> = []
    this.emit(out)
    return out
  }

  private append(piece: string): void {
    if (piece === '') return
    this.length += piece.length
    if (this.discarding) return
    if (this.length > this.maxLineLength) {
      this.discarding = true
      this.parts = []
      return
    }
    this.parts.push(piece)
  }

  private emit(out: Array<string | OversizedLine>): void {
    if (this.discarding) {
      out.push({ oversized: true, length: this.length })
    } else {
      const line = this.parts.join('').replace(/\r$/, '')
      if (line.trim() !== '') out.push(line)
    }
    this.parts = []
    this.length = 0
    this.discarding = false
  }
}
