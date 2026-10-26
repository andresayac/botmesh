/**
 * Media storage shared by the simulators: files a simulated user sends (served
 * to the bot through expiring URLs, like the platforms' CDNs) and files the bot
 * uploads (kept so a test or the web UI can show them).
 */

import { createHash, randomBytes } from 'node:crypto'

export interface StoredMedia {
  id: string
  data: Buffer
  mimetype: string
  filename?: string
  sha256: string
  createdAt: number
  /** Epoch ms after which the download URL answers 404 (the platform's URL expired). */
  expiresAt?: number
  /** Where the file came from: `'user'` (inbound) or `'bot'` (uploaded by the provider). */
  origin: 'user' | 'bot'
}

export interface PutMediaOptions {
  mimetype?: string
  filename?: string
  /** Lifetime of the download URL in ms. Default: the store's `ttlMs` (none). */
  ttlMs?: number
  origin?: 'user' | 'bot'
  /** Fixed id (default: random). */
  id?: string
}

/** Default MIME type per media kind (what a phone would send). */
export const KIND_MIME: Record<string, string> = {
  image: 'image/jpeg',
  video: 'video/mp4',
  audio: 'audio/mpeg',
  voice: 'audio/ogg',
  document: 'application/pdf',
  sticker: 'image/webp',
}

export class MediaStore {
  private readonly items = new Map<string, StoredMedia>()

  /** `ttlMs`: default URL lifetime for inbound media (undefined = never expires). */
  constructor(private readonly ttlMs?: number, private readonly now: () => number = Date.now) {}

  put(data: Buffer, opts: PutMediaOptions = {}): StoredMedia {
    const id = opts.id ?? randomBytes(9).toString('hex')
    const ttl = opts.ttlMs ?? this.ttlMs
    const item: StoredMedia = {
      id,
      data,
      mimetype: opts.mimetype ?? 'application/octet-stream',
      ...(opts.filename ? { filename: opts.filename } : {}),
      sha256: createHash('sha256').update(data).digest('base64'),
      createdAt: this.now(),
      ...(ttl !== undefined ? { expiresAt: this.now() + ttl } : {}),
      origin: opts.origin ?? 'user',
    }
    this.items.set(id, item)
    return item
  }

  /** The item, or undefined when unknown or expired. */
  get(id: string): StoredMedia | undefined {
    const item = this.items.get(id)
    if (!item) return undefined
    if (item.expiresAt !== undefined && this.now() >= item.expiresAt) return undefined
    return item
  }

  /** The item even when expired (metadata lookups). */
  peek(id: string): StoredMedia | undefined {
    return this.items.get(id)
  }

  /** Expire a URL now (scenario: the platform's media URL is no longer valid). */
  expire(id: string): void {
    const item = this.items.get(id)
    if (item) item.expiresAt = this.now() - 1
  }

  list(origin?: 'user' | 'bot'): StoredMedia[] {
    return [...this.items.values()].filter((m) => origin === undefined || m.origin === origin)
  }

  clear(): void {
    this.items.clear()
  }
}
