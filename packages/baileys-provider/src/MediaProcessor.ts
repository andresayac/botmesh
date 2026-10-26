/**
 * MediaProcessor — convert MediaSource inputs into Baileys' WAMediaUpload.
 *
 * Includes sticker conversion (sharp) and audio PTT transcode (an ffmpeg binary,
 * see ffmpeg.ts). Both load lazily, on the first sticker or voice note: a
 * text-only bot keeps working on a platform where one of them is missing.
 */

import { readFileSync, existsSync } from 'node:fs'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

import { PayloadTooLargeError, ProviderError, UnsupportedContentError, type MediaSource, type OutboundContent } from '@botmesh/core'
import { fetchBuffer, SecureHttpError, type HostResolver } from '@botmesh/http'
import { FfmpegNotFoundError, resolveFfmpegPath, runFfmpeg } from './ffmpeg.js'

export type WAMediaUpload =
  | Buffer
  | { url: string }
  | { stream: NodeJS.ReadableStream }

type SourceObject = { url?: unknown; buffer?: unknown; path?: unknown; stream?: unknown }

const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value)

/** Normalize any MediaSource into a Baileys WAMediaUpload. */
export function toMediaUpload(source: MediaSource): WAMediaUpload {
  if (typeof source === 'string') {
    // URL → leave as URL (Baileys streams)
    if (isHttpUrl(source) || !existsSync(source)) {
      return { url: source }
    }
    // Local path → Buffer (could also be { url: 'file://...' })
    return readFileSync(source)
  }
  if (Buffer.isBuffer(source)) return source
  const s = source as SourceObject
  if (typeof s.url === 'string') return { url: s.url }
  if (Buffer.isBuffer(s.buffer)) return s.buffer
  if (typeof s.path === 'string') return readFileSync(s.path)
  if (s.stream) return { stream: s.stream as NodeJS.ReadableStream }
  throw new Error(`Invalid MediaSource: ${typeof source}`)
}

/**
 * How the provider fetches outbound `{ url }` / `https://…` media.
 *
 * Baileys downloads URL media with plain `fetch`, which follows redirects
 * without checking where they land: a public URL that redirects to
 * `http://169.254.169.254/…` would make the bot fetch (and send) internal data.
 * By default the provider downloads remote media itself through
 * `@botmesh/http` (every redirect hop vetted, connection pinned to the vetted
 * address, size and time capped) and hands Baileys a Buffer.
 */
export interface RemoteMediaConfig {
  /**
   * Accept media hosted on (or redirecting to) loopback, private or link-local
   * addresses. `true` restores the legacy behavior: the URL is passed to
   * Baileys untouched and streamed by it. Default `false`.
   */
  allowPrivateHosts?: boolean
  /** Accept plain `http:` URLs (each hop is still vetted). Default `true`. */
  allowHttp?: boolean
  /** Largest media accepted, in bytes (also caps streamed sources of stickers and voice notes). Default 64 MiB. */
  maxBytes?: number
  /** Time allowed for the whole download. Default 60 s. */
  timeoutMs?: number
  /** Redirect hops allowed. Default 3. */
  maxRedirects?: number
  /** DNS resolver used to vet hosts (tests, egress gateways). */
  resolver?: HostResolver
  /** Custom fetch (tests, egress proxies). */
  fetch?: typeof globalThis.fetch
}

export const REMOTE_MEDIA_MAX_BYTES = 64 * 1024 * 1024

/** Secure download of one http(s) URL, with the provider's error mapping. */
async function download(url: string, kind: OutboundContent['kind'], config: RemoteMediaConfig, allowPrivateHosts: boolean): Promise<Buffer> {
  try {
    return await fetchBuffer(url, {
      allowHttp: config.allowHttp !== false,
      allowPrivateHosts,
      maxBytes: config.maxBytes ?? REMOTE_MEDIA_MAX_BYTES,
      timeoutMs: config.timeoutMs ?? 60_000,
      ...(config.maxRedirects !== undefined ? { maxRedirects: config.maxRedirects } : {}),
      ...(config.resolver ? { resolver: config.resolver } : {}),
      ...(config.fetch ? { fetch: config.fetch } : {}),
    })
  } catch (error) {
    if (error instanceof SecureHttpError && error.code === 'RESPONSE_TOO_LARGE') {
      throw new PayloadTooLargeError(`${kind} media exceeds ${config.maxBytes ?? REMOTE_MEDIA_MAX_BYTES} bytes`)
    }
    const reason = error instanceof SecureHttpError ? error.message : 'download failed'
    const wrapped = new UnsupportedContentError(kind, `${kind} media URL rejected: ${reason}`)
    ;(wrapped as { cause?: unknown }).cause = error
    throw wrapped
  }
}

/**
 * Download `{ url }` media through `@botmesh/http` and return a Buffer, unless
 * {@link RemoteMediaConfig.allowPrivateHosts} opts back into the pass-through.
 * Rejects with {@link PayloadTooLargeError} over the size cap and
 * {@link UnsupportedContentError} for an unsafe or failing URL.
 */
export async function resolveRemoteMedia(
  upload: WAMediaUpload,
  kind: OutboundContent['kind'],
  config: RemoteMediaConfig = {},
): Promise<WAMediaUpload> {
  if (Buffer.isBuffer(upload) || !('url' in upload) || !isHttpUrl(upload.url)) return upload
  if (config.allowPrivateHosts === true) return upload
  return download(upload.url, kind, config, false)
}

/** Read a stream fully, rejecting with {@link PayloadTooLargeError} past `maxBytes`. */
async function readStream(stream: NodeJS.ReadableStream, kind: OutboundContent['kind'], maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk)
    size += buf.length
    if (size > maxBytes) {
      ;(stream as { destroy?: () => void }).destroy?.()
      throw new PayloadTooLargeError(`${kind} media exceeds ${maxBytes} bytes`)
    }
    chunks.push(buf)
  }
  return Buffer.concat(chunks)
}

/**
 * Any MediaSource as a Buffer, for the media the provider converts itself
 * (stickers, voice notes): http(s) URLs go through the same vetted download as
 * other media, streams are read up to `maxBytes`. Rejects with typed
 * {@link ProviderError}s only.
 */
export async function mediaToBufferFor(source: MediaSource, kind: OutboundContent['kind'], config: RemoteMediaConfig = {}): Promise<Buffer> {
  const s = (typeof source === 'object' && !Buffer.isBuffer(source) ? source : {}) as SourceObject
  const url = typeof source === 'string' ? source : typeof s.url === 'string' ? s.url : undefined
  if (url !== undefined && isHttpUrl(url)) return download(url, kind, config, config.allowPrivateHosts === true)
  if (s.stream) return readStream(s.stream as NodeJS.ReadableStream, kind, config.maxBytes ?? REMOTE_MEDIA_MAX_BYTES)
  const path = typeof source === 'string' ? source : typeof s.path === 'string' ? s.path : url
  if (path !== undefined && !existsSync(path)) {
    throw new UnsupportedContentError(kind, `${kind} media file not found: ${path} (pass an http(s) URL, a Buffer, a stream or an existing path)`)
  }
  try {
    return await toBuffer(path !== undefined ? path : source)
  } catch (error) {
    if (error instanceof ProviderError) throw error
    const wrapped = new UnsupportedContentError(kind, `${kind} media source not supported: ${error instanceof Error ? error.message : String(error)}`)
    ;(wrapped as { cause?: unknown }).cause = error
    throw wrapped
  }
}

/** Read a MediaSource fully into a Buffer (used by sticker/audio transcode). */
export async function toBuffer(source: MediaSource): Promise<Buffer> {
  if (typeof source === 'string') {
    if (isHttpUrl(source)) {
      throw new Error('Remote URL not supported here — download it first')
    }
    return readFile(source)
  }
  if (Buffer.isBuffer(source)) return source
  const s = source as SourceObject
  if (Buffer.isBuffer(s.buffer)) return s.buffer
  if (typeof s.path === 'string') return readFile(s.path)
  throw new Error('Cannot convert this MediaSource to buffer')
}

/* =============================================================================
 * STICKERS
 * ========================================================================== */

export interface StickerOptions {
  pack?: string
  author?: string
}

type Sharp = (typeof import('sharp'))['default']
let sharpModule: Promise<Sharp> | undefined

/** `sharp`, loaded on first use; a failed load is retried next time. */
function loadSharp(): Promise<Sharp> {
  sharpModule ??= import('sharp').then((m) => ((m as unknown as { default?: Sharp }).default ?? m) as Sharp)
  sharpModule.catch(() => { sharpModule = undefined })
  return sharpModule
}

async function nativeTool<T>(load: () => Promise<T>, kind: OutboundContent['kind'], name: string): Promise<T> {
  try {
    return await load()
  } catch (error) {
    const wrapped = new UnsupportedContentError(kind, `${name} could not be loaded on this platform (${error instanceof Error ? error.message : String(error)}); reinstall it or send this media as a plain file`)
    ;(wrapped as { cause?: unknown }).cause = error
    throw wrapped
  }
}

export async function makeSticker(source: MediaSource, opts: StickerOptions = {}): Promise<Buffer> {
  const buffer = await toBuffer(source)
  const sharp = await nativeTool(loadSharp, 'sticker', 'sharp')
  // PNG/WebP 512×512 transparent padding ( whatsapp sticker spec )
  const padded = await sharp(buffer, { failOn: 'none' })
    .resize(512, 512, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .extend({
      top: 0, bottom: 0, left: 0, right: 0,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .webp()
    .toBuffer()

  if (!opts.pack && !opts.author) return padded
  return withStickerExif(padded, 512, 512, {
    'sticker-pack-id': randomUUID(),
    'sticker-pack-name': opts.pack ?? '',
    'sticker-pack-publisher': opts.author ?? '',
    emojis: [],
  })
}

/** RIFF chunk header + payload, padded to an even length. */
function riffChunk(id: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8)
  header.write(id, 0, 4, 'ascii')
  header.writeUInt32LE(data.length, 4)
  return Buffer.concat([header, data, data.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)])
}

/**
 * Add WhatsApp's sticker metadata to a WebP: a little-endian TIFF/EXIF block
 * with one IFD entry (tag 0x5741, type UNDEFINED) whose value is the JSON with
 * the pack name and publisher. A simple (VP8/VP8L) WebP is promoted to the
 * extended format first, since only a VP8X container may carry EXIF.
 */
function withStickerExif(webp: Buffer, width: number, height: number, json: Record<string, unknown>): Buffer {
  if (webp.toString('ascii', 0, 4) !== 'RIFF' || webp.toString('ascii', 8, 12) !== 'WEBP') return webp
  const body = Buffer.from(JSON.stringify(json), 'utf8')
  const tiff = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00])
  tiff.writeUInt32LE(body.length, 14)
  const exif = riffChunk('EXIF', Buffer.concat([tiff, body]))

  const chunks: Buffer[] = []
  let first = ''
  for (let o = 12; o + 8 <= webp.length;) {
    const id = webp.toString('ascii', o, o + 4)
    const size = webp.readUInt32LE(o + 4)
    const end = o + 8 + size + (size & 1)
    if (!first) first = id
    if (id !== 'EXIF') chunks.push(webp.subarray(o, Math.min(end, webp.length)))
    o = end
  }
  if (first === 'VP8X') {
    const vp8x = Buffer.from(chunks[0]!)
    vp8x[8] = vp8x[8]! | 0x08
    chunks[0] = vp8x
  } else {
    const flags = Buffer.alloc(10)
    // VP8L carries its own alpha; flag it so decoders keep the transparency.
    flags[0] = 0x08 | (first === 'VP8L' ? 0x10 : 0)
    flags.writeUIntLE(width - 1, 4, 3)
    flags.writeUIntLE(height - 1, 7, 3)
    chunks.unshift(riffChunk('VP8X', flags))
  }
  const payload = Buffer.concat([Buffer.from('WEBP', 'ascii'), ...chunks, exif])
  const header = Buffer.alloc(8)
  header.write('RIFF', 0, 4, 'ascii')
  header.writeUInt32LE(payload.length, 4)
  return Buffer.concat([header, payload])
}

/* =============================================================================
 * AUDIO (PTT transcode)
 * ========================================================================== */

/** Longest a voice-note transcode may run before ffmpeg is killed. */
const TRANSCODE_TIMEOUT_MS = 120_000

/** How to get the binary when it is missing (part of the UnsupportedContentError message). */
const FFMPEG_HINT = 'install ffmpeg on the PATH, set FFMPEG_PATH to the binary, or add the optional ffmpeg-static package'

/**
 * Transcode any audio to a WhatsApp voice note (Ogg/Opus, mono, 48 kHz) with ffmpeg
 * (see `ffmpeg.ts` for how the binary is found). A binary that cannot be started rejects
 * with an `UnsupportedContentError` that says how to install it.
 */
export async function transcodeToOpus(source: MediaSource): Promise<Buffer> {
  const input = await toBuffer(source)
  const bin = await resolveFfmpegPath()
  const inPath = join(tmpdir(), `baileys-in-${randomUUID()}.bin`)
  const outPath = join(tmpdir(), `baileys-out-${randomUUID()}.ogg`)
  await writeFile(inPath, input)

  try {
    await runFfmpeg(bin, [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-i', inPath,
      '-vn',
      '-c:a', 'libopus',
      '-ac', '1',
      '-ar', '48000',
      '-avoid_negative_ts', 'make_zero',
      '-f', 'ogg',
      outPath,
    ], TRANSCODE_TIMEOUT_MS)
    return await readFile(outPath)
  } catch (error) {
    if (error instanceof FfmpegNotFoundError) {
      const wrapped = new UnsupportedContentError('voice', `${error.message}; ${FFMPEG_HINT}, or send the audio as a plain file`)
      ;(wrapped as { cause?: unknown }).cause = error
      throw wrapped
    }
    throw error
  } finally {
    // Always clean up both temp files — even when ffmpeg rejects — so a stream
    // of failed transcodes can't leak the OS temp dir.
    await unlink(inPath).catch(() => {})
    await unlink(outPath).catch(() => {})
  }
}
