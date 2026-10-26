/**
 * Validation of what the hub's JSON API receives: the body must be a JSON
 * object, and every field of a send / fault / status call is checked with a
 * message that names the field, so a wrong call is a 400 that explains
 * itself instead of a simulator crash.
 */

import type { FaultKind, MediaKind, MessageStatus, UserInput } from './sim/base.js'
import { HttpError } from './guard.js'

/** A request the hub refuses with 400 and `{ error: message }`. */
export class SandboxInputError extends HttpError {
  constructor(message: string) {
    super(400, message)
    this.name = 'SandboxInputError'
  }
}

type Json = Record<string, unknown>

const MEDIA_KINDS: readonly MediaKind[] = ['image', 'video', 'audio', 'voice', 'document', 'sticker']
const FAULT_KINDS: readonly FaultKind[] = ['rateLimit', 'invalidRecipient', 'outsideWindow', 'mediaTooLarge', 'auth', 'serverError']
const STATUSES: readonly MessageStatus[] = ['sent', 'delivered', 'read', 'failed']
const SEND_KEYS = ['user', 'text', 'media', 'location', 'reply', 'pollVote', 'quotedId']
const ACTIONS = ['text', 'media', 'location', 'reply', 'pollVote'] as const
const MAX_TEXT = 100_000
const MAX_ID = 512

const fail = (message: string): never => { throw new SandboxInputError(message) }

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function has(obj: Json, key: string): boolean {
  return Object.hasOwn(obj, key) && obj[key] !== undefined
}

function onlyKeys(obj: Json, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(obj)) if (!allowed.includes(key)) fail(`${where}${key}: unknown field (allowed: ${allowed.join(', ')})`)
}

function str(obj: Json, key: string, where: string, opts: { required?: boolean; min?: number; max?: number } = {}): string | undefined {
  if (!has(obj, key)) return opts.required ? fail(`${where}${key}: required`) : undefined
  const v = obj[key]
  if (typeof v !== 'string') return fail(`${where}${key}: must be a string`)
  if (v.length < (opts.min ?? 0)) return fail(`${where}${key}: must not be empty`)
  if (v.length > (opts.max ?? MAX_ID)) return fail(`${where}${key}: longer than ${opts.max ?? MAX_ID} characters`)
  return v
}

function num(obj: Json, key: string, where: string, opts: { min: number; max: number; integer?: boolean; required?: boolean }): number | undefined {
  if (!has(obj, key)) return opts.required ? fail(`${where}${key}: required`) : undefined
  const v = obj[key]
  if (typeof v !== 'number' || !Number.isFinite(v) || (opts.integer && !Number.isInteger(v))) return fail(`${where}${key}: must be ${opts.integer ? 'an integer' : 'a number'}`)
  if (v < opts.min || v > opts.max) return fail(`${where}${key}: must be between ${opts.min} and ${opts.max}`)
  return v
}

function obj(body: Json, key: string): Json | undefined {
  if (!has(body, key)) return undefined
  const v = body[key]
  return isObject(v) ? v : fail(`${key}: must be an object`)
}

/** Parse a request body as a JSON object (empty body = `{}`). */
export function parseJsonObject(raw: Buffer): Json {
  const text = raw.toString('utf8').trim()
  if (!text) return {}
  let value: unknown
  try { value = JSON.parse(text) } catch { return fail('the body is not valid JSON') }
  return isObject(value) ? value : fail('the body must be a JSON object')
}

/**
 * Translate the UI's JSON into a {@link UserInput}. Media arrive
 * base64-encoded. Throws a {@link SandboxInputError} naming the first
 * problem: exactly one of `text`, `media`, `location`, `reply` or `pollVote`
 * must be present, and unknown fields are refused.
 */
export function toUserInput(body: Json): UserInput {
  if (!isObject(body)) fail('the body must be a JSON object')
  onlyKeys(body, SEND_KEYS, '')
  const present = ACTIONS.filter((k) => has(body, k))
  if (present.length === 0) fail(`send one of ${ACTIONS.join(', ')}`)
  if (present.length > 1) fail(`send only one of ${ACTIONS.join(', ')} (got ${present.join(', ')})`)

  const input: UserInput = {}
  if (has(body, 'user')) {
    const user = obj(body, 'user')!
    onlyKeys(user, ['id', 'name'], 'user.')
    const id = str(user, 'id', 'user.', { required: true, min: 1 })!
    const name = str(user, 'name', 'user.')
    input.user = { id, ...(name ? { name } : {}) }
  }
  const text = str(body, 'text', '', { max: MAX_TEXT })
  if (text !== undefined) input.text = text

  const media = obj(body, 'media')
  if (media) {
    onlyKeys(media, ['kind', 'base64', 'mimetype', 'filename', 'caption'], 'media.')
    const kind = str(media, 'kind', 'media.') ?? 'document'
    if (!MEDIA_KINDS.includes(kind as MediaKind)) fail(`media.kind: must be one of ${MEDIA_KINDS.join(', ')}`)
    const base64 = str(media, 'base64', 'media.', { required: true, min: 1, max: Number.MAX_SAFE_INTEGER })!
    if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(base64)) fail('media.base64: not valid base64')
    const data = Buffer.from(base64, 'base64')
    if (data.length === 0) fail('media.base64: decodes to an empty file')
    const mimetype = str(media, 'mimetype', 'media.', { max: 255 })
    if (mimetype !== undefined && mimetype !== '' && !/^[\w.+-]+\/[\w.+-]+$/.test(mimetype)) fail('media.mimetype: must look like type/subtype')
    const filename = str(media, 'filename', 'media.', { max: 255 })
    const caption = str(media, 'caption', 'media.', { max: MAX_TEXT })
    input.media = {
      kind: kind as MediaKind,
      data,
      ...(mimetype ? { mimetype } : {}),
      ...(filename ? { filename } : {}),
      ...(caption ? { caption } : {}),
    }
  }

  const loc = obj(body, 'location')
  if (loc) {
    onlyKeys(loc, ['latitude', 'longitude', 'name', 'address'], 'location.')
    const latitude = num(loc, 'latitude', 'location.', { min: -90, max: 90, required: true })!
    const longitude = num(loc, 'longitude', 'location.', { min: -180, max: 180, required: true })!
    const name = str(loc, 'name', 'location.', { max: 1000 })
    const address = str(loc, 'address', 'location.', { max: 1000 })
    input.location = { latitude, longitude, ...(name ? { name } : {}), ...(address ? { address } : {}) }
  }

  const reply = obj(body, 'reply')
  if (reply) {
    onlyKeys(reply, ['kind', 'id', 'title', 'messageId'], 'reply.')
    const kind = str(reply, 'kind', 'reply.') ?? 'button'
    if (kind !== 'button' && kind !== 'list') fail('reply.kind: must be "button" or "list"')
    const id = str(reply, 'id', 'reply.', { required: true, min: 1 })!
    const title = str(reply, 'title', 'reply.', { max: 1000 })
    const messageId = str(reply, 'messageId', 'reply.')
    input.reply = { kind: kind as 'button' | 'list', id, ...(title ? { title } : {}), ...(messageId ? { messageId } : {}) }
  }

  const vote = obj(body, 'pollVote')
  if (vote) {
    onlyKeys(vote, ['pollId', 'optionIds'], 'pollVote.')
    const pollId = str(vote, 'pollId', 'pollVote.', { required: true, min: 1 })!
    const ids = has(vote, 'optionIds') ? vote['optionIds'] : []
    if (!Array.isArray(ids) || ids.length > 100 || !ids.every((i) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < 100)) {
      fail('pollVote.optionIds: must be an array of option indexes (integers 0-99)')
    }
    input.pollVote = { pollId, optionIds: ids as number[] }
  }

  const quotedId = str(body, 'quotedId', '')
  if (quotedId) input.quotedId = quotedId
  return input
}

/** `POST /api/:channel/fault` body. */
export function toFault(body: Json): { kind: FaultKind; times: number; retryAfterSec: number } {
  onlyKeys(body, ['kind', 'times', 'retryAfterSec'], '')
  const kind = str(body, 'kind', '', { required: true })!
  if (!FAULT_KINDS.includes(kind as FaultKind)) fail(`kind: must be one of ${FAULT_KINDS.join(', ')}`)
  return {
    kind: kind as FaultKind,
    times: num(body, 'times', '', { min: 1, max: 1000, integer: true }) ?? 1,
    retryAfterSec: num(body, 'retryAfterSec', '', { min: 0, max: 3600 }) ?? 30,
  }
}

/** `POST /api/:channel/status` body. */
export function toStatus(body: Json): { messageId: string; status: MessageStatus } {
  onlyKeys(body, ['messageId', 'status'], '')
  const messageId = str(body, 'messageId', '', { required: true, min: 1 })!
  const status = str(body, 'status', '', { required: true })!
  if (!STATUSES.includes(status as MessageStatus)) fail(`status: must be one of ${STATUSES.join(', ')}`)
  return { messageId, status: status as MessageStatus }
}
