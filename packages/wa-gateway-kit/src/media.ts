/**
 * Outbound media resolution shared by the REST mappers: a public URL is handed
 * to the gateway as-is (the gateway downloads it); everything else is read into
 * memory and sent inline as base64.
 */

import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { UnsupportedContentError, type MediaSource, type OutboundContent } from '@botmesh/core'

export type ResolvedMedia =
  | { url: string; filename?: string; mimetype?: string }
  | { base64: string; filename?: string; mimetype: string }

const EXT_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.3gp': 'video/3gpp', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.csv': 'text/csv', '.zip': 'application/zip',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

const KIND_MIME: Partial<Record<OutboundContent['kind'], string>> = {
  image: 'image/jpeg',
  video: 'video/mp4',
  audio: 'audio/mpeg',
  voice: 'audio/ogg; codecs=opus',
  sticker: 'image/webp',
  document: 'application/octet-stream',
}

/** Best-effort MIME type: explicit → file extension → per-kind default. */
export function guessMimetype(kind: OutboundContent['kind'], filename?: string, explicit?: string): string {
  if (explicit) return explicit
  const ext = filename ? extname(filename).toLowerCase() : ''
  return EXT_MIME[ext] ?? KIND_MIME[kind] ?? 'application/octet-stream'
}

async function streamToBuffer(kind: OutboundContent['kind'], stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const c of stream as AsyncIterable<unknown>) {
    if (Buffer.isBuffer(c)) chunks.push(c)
    else if (c instanceof Uint8Array) chunks.push(Buffer.from(c.buffer, c.byteOffset, c.byteLength))
    else if (typeof c === 'string') chunks.push(Buffer.from(c))
    else throw new UnsupportedContentError(kind, `${kind}: the media stream yielded a ${typeof c} chunk; it must yield Buffer, Uint8Array or string chunks (not an object-mode stream).`)
  }
  return Buffer.concat(chunks)
}

/** `data:<mime>;base64,<payload>` (the payload is re-encoded, so stray characters cannot reach the gateway). */
const DATA_URI = /^data:([\w.+-]+\/[\w.+-]+)(?:;[\w-]+=[\w.-]+)*;base64,([\s\S]*)$/i

const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value)

/** The scheme of a rejected `{ url }`, for the error message (never the URL itself, which may be a secret path). */
function describeScheme(value: string): string {
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(value)?.[1]
  return scheme && scheme.length > 1 ? `a ${scheme.toLowerCase()}: URL` : 'a local path'
}

/** A `file:` URL as a local path; anything else unchanged (read as a path). */
function localPathOf(value: string): string {
  if (!/^file:/i.test(value)) return value
  try {
    return fileURLToPath(value)
  } catch {
    return value
  }
}

/**
 * Read a local media file. A path that cannot be read rejects with an
 * `UnsupportedContentError` that names it and the cause (`ENOENT`, `EACCES`…),
 * the original error as `cause`, instead of a raw filesystem error.
 */
export async function readLocalMedia(kind: OutboundContent['kind'], path: string): Promise<Buffer> {
  try {
    return await readFile(path)
  } catch (err) {
    const code = (err as { code?: string }).code
    const shown = path.length > 80 ? `${path.slice(0, 80)}…` : path
    throw Object.assign(
      new UnsupportedContentError(kind, `${kind}: ${JSON.stringify(shown)} is neither an http(s) URL nor a readable file (${code ?? 'read failed'}). Pass a URL, a Buffer or { buffer }.`),
      { cause: err },
    )
  }
}

/**
 * Resolve a {@link MediaSource}. Only `http(s)` URLs are handed to the gateway to download and a
 * base64 `data:` URI is sent inline. `{ url }` accepts nothing else: a path or `file:` URL there
 * rejects (it is a link, never a local read). A local file is read here and sent inline when it is
 * given as `{ path }` or a plain string (a path or `file:` URL), so the gateway is never asked to
 * open a path on its own host. `{ native: string }` is passed
 * through untouched as a URL-or-base64 value the gateway understands natively (escape hatch:
 * never put untrusted input there).
 *
 * @throws {UnsupportedContentError} for a source of the wrong shape, a `{ url }` that is not
 * http(s) or `data:`, an unreadable path or a stream that does not yield bytes.
 */
export async function resolveMedia(
  kind: OutboundContent['kind'],
  source: MediaSource,
  opts: { filename?: string; mimetype?: string } = {},
): Promise<ResolvedMedia> {
  const inline = (buffer: Buffer, filename?: string): ResolvedMedia => ({
    base64: buffer.toString('base64'),
    filename,
    mimetype: guessMimetype(kind, filename, opts.mimetype),
  })
  const urlOrPath = async (value: string): Promise<ResolvedMedia> => {
    if (isHttpUrl(value)) return { url: value, filename: opts.filename, mimetype: opts.mimetype }
    const data = DATA_URI.exec(value)
    if (data) {
      return { base64: Buffer.from(data[2]!, 'base64').toString('base64'), filename: opts.filename, mimetype: opts.mimetype ?? data[1]! }
    }
    const path = localPathOf(value)
    return inline(await readLocalMedia(kind, path), opts.filename ?? basename(path))
  }
  if (typeof source === 'string') return urlOrPath(source)
  if (Buffer.isBuffer(source)) return inline(source, opts.filename)
  if (typeof source !== 'object' || source === null) {
    throw new UnsupportedContentError(kind, `${kind}: unsupported media source (${source === null ? 'null' : typeof source}); expected a URL, Buffer, path, stream or { native: string }`)
  }
  if ('url' in source && typeof source.url === 'string') {
    // `{ url }` is a link (as on every other channel), never a local read: a URL that comes from
    // a user or a model must not be able to pull a file off the bot's host.
    if (isHttpUrl(source.url) || DATA_URI.test(source.url)) return urlOrPath(source.url)
    throw new UnsupportedContentError(kind, `${kind}: \`{ url }\` must be an http(s) URL or a base64 data: URI (got ${describeScheme(source.url)}); send a local file as { path } or a plain path string`)
  }
  if ('buffer' in source) return inline(source.buffer, opts.filename)
  if ('path' in source) return inline(await readLocalMedia(kind, source.path), opts.filename ?? basename(source.path))
  if ('stream' in source) return inline(await streamToBuffer(kind, source.stream), opts.filename)
  if ('native' in source && typeof source.native === 'string') {
    return { url: source.native, filename: opts.filename, mimetype: opts.mimetype }
  }
  throw new UnsupportedContentError(kind, 'Unsupported MediaSource: expected a URL, Buffer, path, stream or { native: string }')
}

/** `data:<mime>;base64,<payload>` (WPPConnect style) or the plain URL. */
export function toDataUri(media: ResolvedMedia): string {
  return 'url' in media ? media.url : `data:${media.mimetype};base64,${media.base64}`
}
