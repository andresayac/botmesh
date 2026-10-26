/**
 * chat ↔ Chatwoot contact/conversation mapping, persisted as small JSON strings through
 * a string key/value (by default the bot store's cursor API, namespaced per bot):
 *  - `chatwoot:chat:<chatId>` → `{ contactId, sourceId?, conversationId? }`
 *  - `chatwoot:conv:<conversationId>` → `chatId` (reverse lookup for webhooks)
 *
 * Chat ids are opaque: they are only used as keys, never parsed.
 */

import type { ChatId, IStore } from '@botmesh/core'

/** Minimal string key/value the mapping persists to. An empty string means "deleted". */
export interface ChatwootKeyValue {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
}

/** What is stored per chat. */
export interface ChatwootChatLink {
  contactId: number
  sourceId?: string
  conversationId?: number
}

export function memoryKeyValue(): ChatwootKeyValue {
  const map = new Map<string, string>()
  return {
    async get(key) { return map.get(key) },
    async set(key, value) { map.set(key, value) },
  }
}

/** Key/value over the store cursor API, or `undefined` when the store lacks it. */
export function storeKeyValue(store: Pick<IStore, 'getCursor' | 'setCursor'>): ChatwootKeyValue | undefined {
  if (typeof store.getCursor !== 'function' || typeof store.setCursor !== 'function') return undefined
  return { get: (k) => store.getCursor!(k), set: (k, v) => store.setCursor!(k, v) }
}

/** Default number of chat links kept in the in-memory cache. */
export const DEFAULT_MAPPING_CACHE = 10_000

/** Insert `key` as most recently used and drop the least recent past `max`. */
function remember<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  map.delete(key)
  map.set(key, value)
  while (map.size > max) {
    const oldest = map.keys().next()
    if (oldest.done) break
    map.delete(oldest.value)
  }
}

/**
 * The mapping, cached in memory in front of the key/value. The cache is a bounded LRU
 * (`maxCached` chats, default 10,000): a chat that falls out is read back from storage.
 */
export class ChatwootMapping {
  private readonly links = new Map<ChatId, ChatwootChatLink>()
  private readonly reverse = new Map<number, ChatId>()

  constructor(
    private readonly kv: ChatwootKeyValue,
    private readonly prefix = 'chatwoot:',
    private readonly maxCached = DEFAULT_MAPPING_CACHE,
  ) {
    if (!Number.isInteger(maxCached) || maxCached < 1) throw new RangeError('ChatwootMapping: maxCached must be a positive integer')
  }

  async get(chatId: ChatId): Promise<ChatwootChatLink | undefined> {
    const cached = this.links.get(chatId)
    if (cached) { remember(this.links, chatId, cached, this.maxCached); return cached }
    const raw = await this.kv.get(`${this.prefix}chat:${chatId}`)
    if (!raw) return undefined
    try {
      const link = JSON.parse(raw) as ChatwootChatLink
      if (typeof link.contactId !== 'number') return undefined
      remember(this.links, chatId, link, this.maxCached)
      if (link.conversationId !== undefined) remember(this.reverse, link.conversationId, chatId, this.maxCached)
      return link
    } catch {
      return undefined
    }
  }

  async set(chatId: ChatId, link: ChatwootChatLink): Promise<void> {
    const prev = this.links.get(chatId) ?? await this.get(chatId)
    remember(this.links, chatId, link, this.maxCached)
    await this.kv.set(`${this.prefix}chat:${chatId}`, JSON.stringify(link))
    if (prev?.conversationId !== undefined && prev.conversationId !== link.conversationId) {
      this.reverse.delete(prev.conversationId)
      await this.kv.set(`${this.prefix}conv:${prev.conversationId}`, '')
    }
    if (link.conversationId !== undefined) {
      remember(this.reverse, link.conversationId, chatId, this.maxCached)
      await this.kv.set(`${this.prefix}conv:${link.conversationId}`, chatId)
    }
  }

  /** Forget the chat's link entirely (e.g. its Chatwoot contact was deleted). */
  async delete(chatId: ChatId): Promise<void> {
    const prev = this.links.get(chatId) ?? await this.get(chatId)
    this.links.delete(chatId)
    await this.kv.set(`${this.prefix}chat:${chatId}`, '')
    if (prev?.conversationId !== undefined) {
      this.reverse.delete(prev.conversationId)
      await this.kv.set(`${this.prefix}conv:${prev.conversationId}`, '')
    }
  }

  async chatOf(conversationId: number): Promise<ChatId | undefined> {
    const cached = this.reverse.get(conversationId)
    if (cached !== undefined) return cached
    const chatId = await this.kv.get(`${this.prefix}conv:${conversationId}`)
    if (!chatId) return undefined
    remember(this.reverse, conversationId, chatId, this.maxCached)
    return chatId
  }
}
