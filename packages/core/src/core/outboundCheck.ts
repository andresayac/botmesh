/**
 * Transport-neutral sanity check of an `OutboundContent` right before it reaches the
 * provider (after the `before('send')` hooks, which may still fix it). It catches
 * programming mistakes every transport would mishandle in its own way (sending the text
 * "undefined", an image without a source, coordinates out of range, an empty poll) and
 * rejects them with one actionable `TypeError`. Transport limits (text length, number of
 * buttons) stay with each provider.
 */
import type { OutboundContent } from './provider.js'

const MEDIA_KINDS: ReadonlySet<string> = new Set(['image', 'video', 'audio', 'voice', 'document', 'sticker'])

function describeValue(value: unknown): string {
  if (value === null || value === undefined) return String(value)
  if (Array.isArray(value)) return 'an array'
  if (typeof value === 'object') return 'an object'
  if (typeof value === 'number') return `the number ${value}`
  return typeof value
}

function isMediaSource(media: unknown): boolean {
  if (typeof media === 'string') return media.length > 0
  if (media instanceof Uint8Array) return true
  if (media === null || typeof media !== 'object') return false
  const m = media as Record<string, unknown>
  return typeof m.url === 'string' || m.buffer instanceof Uint8Array || typeof m.path === 'string' || (m.stream !== null && typeof m.stream === 'object')
}

/** Throw a `TypeError` naming the field when `content` cannot be a valid outbound message. */
export function assertOutboundContent(content: OutboundContent): void {
  const fail = (why: string): never => {
    const kind = content !== null && typeof content === 'object' && typeof (content as { kind?: unknown }).kind === 'string'
      ? ` (kind '${(content as { kind: string }).kind}')`
      : ''
    throw new TypeError(`Invalid outbound content${kind}: ${why}`)
  }
  if (content === null || typeof content !== 'object') fail(`expected an object such as { kind: 'text', text }, got ${describeValue(content)}`)
  const c = content as unknown as Record<string, unknown>
  if (typeof c.kind !== 'string') fail(`"kind" must be a string, got ${describeValue(c.kind)}`)
  const kind = c.kind as string
  if ((kind === 'text' || kind === 'buttons' || kind === 'list') && typeof c.text !== 'string') {
    fail(`"text" must be a string, got ${describeValue(c.text)} (did you pass an undefined variable or an object to reply()?)`)
  }
  if (MEDIA_KINDS.has(kind) && !isMediaSource(c.media)) {
    fail(`"media" must be a URL or path string, a Buffer, or { url | buffer | path | stream }, got ${describeValue(c.media)}`)
  }
  if (c.caption !== undefined && typeof c.caption !== 'string') fail(`"caption" must be a string, got ${describeValue(c.caption)}`)
  if (kind === 'location') {
    const lat = c.lat as number
    const lng = c.lng as number
    if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) fail(`"lat" must be a number between -90 and 90, got ${describeValue(c.lat)}`)
    if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) fail(`"lng" must be a number between -180 and 180, got ${describeValue(c.lng)}`)
  }
  if (kind === 'poll') {
    if (typeof c.question !== 'string') fail(`"question" must be a string, got ${describeValue(c.question)}`)
    if (!Array.isArray(c.options) || c.options.length === 0 || c.options.some((o) => typeof o !== 'string')) {
      fail('"options" must be a non-empty array of strings')
    }
  }
  if (kind === 'buttons' && (!Array.isArray(c.buttons) || c.buttons.length === 0)) fail('"buttons" must be a non-empty array')
  if (kind === 'reaction' && typeof c.emoji !== 'string') fail(`"emoji" must be a string ('' removes the reaction), got ${describeValue(c.emoji)}`)
}
