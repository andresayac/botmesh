/**
 * deleteChat removes the chat row and its message log in ONE transaction: a failure in
 * the middle leaves both in place (before, the messages were already gone).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { StoredMessage } from '@botmesh/core'
import { MysqlStore } from '../src/MysqlStore.js'
import { FakePool, deadlockError, mysqlError } from './fakePool.js'

const msg = (chatId: string, id: string): StoredMessage => ({
  ref: { id, chatId }, chatId, senderId: chatId, timestamp: 1, type: 'text', body: id, fromMe: false,
})

describe('MysqlStore.deleteChat is atomic', () => {
  let fake: FakePool
  let store: MysqlStore
  beforeEach(async () => {
    fake = new FakePool()
    store = new MysqlStore({ pool: fake })
    await store.start()
    await store.upsertChat({ id: 'c', name: 'Ana' })
    await store.saveMessage(msg('c', 'm1'))
    await store.saveMessage(msg('c', 'm2'))
  })

  it('runs both deletes inside one transaction on a dedicated connection', async () => {
    const before = fake.queries.length
    await store.deleteChat('c')
    const sql = fake.queries.slice(before).map((q) => [q.sql.replace(/\s+/g, ' '), q.conn !== undefined])
    expect(sql).toEqual([
      ['START TRANSACTION', true],
      ['DELETE FROM `messages` WHERE chat_id = ?', true],
      ['DELETE FROM `chats` WHERE id = ?', true],
      ['COMMIT', true],
    ])
    expect(await store.getChat('c')).toBeUndefined()
    expect(await store.getMessagesByChat('c')).toEqual([])
    expect(fake.checkedOut).toBe(0)
  })

  it('a failure after the messages are deleted rolls everything back', async () => {
    fake.failNext(/^DELETE FROM `chats` WHERE id = \?$/, mysqlError('ER_LOCK_WAIT_TIMEOUT', 1205, 'HY000', 'Lock wait timeout exceeded'))
    await expect(store.deleteChat('c')).rejects.toThrow(/Lock wait timeout/)
    expect((await store.getChat('c'))?.name).toBe('Ana')
    expect((await store.getMessagesByChat('c')).map((m) => m.ref.id).sort()).toEqual(['m1', 'm2'])
    expect(fake.checkedOut).toBe(0)
  })

  it('retries a deadlock victim', async () => {
    fake.failNext(/^DELETE FROM `messages` WHERE chat_id = \?$/, deadlockError())
    await store.deleteChat('c')
    expect(await store.getChat('c')).toBeUndefined()
    expect(await store.getMessagesByChat('c')).toEqual([])
  })
})
