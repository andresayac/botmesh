/**
 * deleteChat removes the chat document and its message log in one transaction when the
 * deployment supports transactions (replica set or mongos). A standalone server rejects
 * transactions (code 20; mongodb 7 wraps it in a retryable-writes error): the store then falls back to the two deletes in sequence,
 * once, without failing the call.
 */
import { describe, expect, it } from 'vitest'
import type { StoredMessage } from '@botmesh/core'
import { MongoStore } from '../src/MongoStore.js'
import { FakeMongoClient } from './fakeMongo.js'

const msg = (chatId: string, id: string): StoredMessage => ({
  ref: { id, chatId }, chatId, senderId: chatId, timestamp: 1, type: 'text', body: id, fromMe: false,
})

/** A fake client with sessions: records which session each delete ran in. */
class SessionClient extends FakeMongoClient {
  readonly sessions: Array<{ id: number; ended: boolean }> = []
  readonly deletes: Array<{ op: string; session: unknown }> = []
  unsupported = false
  /** How the driver reports a standalone server: v6 throws code 20; v7 wraps it (see below). */
  driver: 'v6' | 'v7' = 'v6'

  startSession() {
    const session = { id: this.sessions.length + 1, ended: false }
    this.sessions.push(session)
    const client = this
    return {
      async withTransaction(fn: () => Promise<unknown>) {
        if (client.unsupported && client.driver === 'v7') {
          // mongodb 7 rewrites the server's IllegalOperation into a retryable-writes hint with
          // no code of its own; the server error survives as errorResponse.originalError.
          const message = 'This MongoDB deployment does not support retryable writes. Please add retryWrites=false to your connection string.'
          throw Object.assign(new Error(message), {
            errorResponse: { message, errmsg: message, originalError: { ok: 0, code: 20, codeName: 'IllegalOperation' } },
          })
        }
        if (client.unsupported) {
          throw Object.assign(new Error('Transaction numbers are only allowed on a replica set member or mongos'), { code: 20, codeName: 'IllegalOperation' })
        }
        return fn()
      },
      async endSession() { session.ended = true },
      id: session.id,
    }
  }
}

function spyDeletes(client: SessionClient, store: MongoStore): void {
  const db = client.db('botwa')
  for (const name of ['messages', 'chats']) {
    const col = db.collection(name) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>
    for (const op of ['deleteMany', 'deleteOne']) {
      const original = col[op]!.bind(col)
      col[op] = async (...args: unknown[]) => {
        const [filter, options] = args as [unknown, { session?: { id: number } } | undefined]
        client.deletes.push({ op: `${name}.${op}`, session: options?.session?.id })
        return original(filter, options)
      }
    }
  }
  void store
}

describe('MongoStore.deleteChat', () => {
  it('runs both deletes in one transaction when sessions are supported', async () => {
    const client = new SessionClient()
    const store = new MongoStore({ client, dbName: 'botwa' })
    await store.start()
    await store.upsertChat({ id: 'c', name: 'Ana' })
    await store.saveMessage(msg('c', 'm1'))
    spyDeletes(client, store)
    await store.deleteChat('c')
    expect(client.deletes).toEqual([
      { op: 'messages.deleteMany', session: 1 },
      { op: 'chats.deleteOne', session: 1 },
    ])
    expect(client.sessions[0]!.ended).toBe(true)
    expect(await store.getChat('c')).toBeUndefined()
    expect(await store.getMessagesByChat('c')).toEqual([])
  })

  it('falls back to sequential deletes on a standalone server, and remembers it', async () => {
    const client = new SessionClient()
    client.unsupported = true
    const store = new MongoStore({ client, dbName: 'botwa' })
    await store.start()
    for (const id of ['a', 'b']) {
      await store.upsertChat({ id, name: id })
      await store.saveMessage(msg(id, `${id}1`))
    }
    spyDeletes(client, store)
    await store.deleteChat('a')
    await store.deleteChat('b')
    expect(client.sessions).toHaveLength(1)
    expect(client.sessions[0]!.ended).toBe(true)
    expect(client.deletes.map((d) => d.session)).toEqual([undefined, undefined, undefined, undefined])
    expect(await store.listChats()).toEqual([])
  })

  it('recognises the mongodb 7 shape of the standalone rejection', async () => {
    const client = new SessionClient()
    client.unsupported = true
    client.driver = 'v7'
    const store = new MongoStore({ client, dbName: 'botwa' })
    await store.start()
    await store.upsertChat({ id: 'a', name: 'a' })
    await store.saveMessage(msg('a', 'a1'))
    await store.deleteChat('a')
    await store.deleteChat('a')
    expect(client.sessions).toHaveLength(1)
    expect(await store.listChats()).toEqual([])
    expect(await store.getMessagesByChat('a')).toEqual([])
  })

  it('a client without sessions (fakes, custom clients) deletes sequentially', async () => {
    const client = new FakeMongoClient()
    const store = new MongoStore({ client, dbName: 'botwa' })
    await store.start()
    await store.upsertChat({ id: 'c', name: 'Ana' })
    await store.saveMessage(msg('c', 'm1'))
    await store.deleteChat('c')
    expect(await store.getChat('c')).toBeUndefined()
    expect(await store.getMessagesByChat('c')).toEqual([])
  })
})
