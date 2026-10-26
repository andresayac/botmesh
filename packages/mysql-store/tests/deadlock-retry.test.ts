/**
 * Single auto-committed statements are retried when the server picks them as a deadlock
 * victim (ER_LOCK_DEADLOCK, 1213): the victim's statement was rolled back as a whole, so
 * running it again is exactly running it once. Concurrent `saveMessage` + `maxMessagesPerChat`
 * trims deadlock on MariaDB's gap locks; without the retry the caller saw the error.
 */
import { describe, expect, it } from 'vitest'
import type { StoredMessage } from '@botmesh/core'
import { MysqlStore } from '../src/MysqlStore.js'
import { FakePool, deadlockError, mysqlError } from './fakePool.js'

const msg = (id: string, ts: number): StoredMessage => ({
  ref: { id, chatId: 'c' }, chatId: 'c', senderId: 'c', timestamp: ts, type: 'text', body: id, fromMe: false,
})

describe('MysqlStore — deadlock victims', () => {
  it('retries a statement rolled back as a deadlock victim (insert and trim)', async () => {
    const pool = new FakePool()
    const store = new MysqlStore({ pool, maxMessagesPerChat: 1 })
    await store.start()
    pool.failNext(/^insert into `messages`/i, deadlockError())
    pool.failNext(/^delete from `messages`/i, deadlockError())
    await store.saveMessage(msg('a', 1))
    await store.saveMessage(msg('b', 2))
    expect((await store.getMessagesByChat('c')).map((m) => m.body)).toEqual(['b'])
  })

  it('gives up after a bounded number of deadlocks', async () => {
    const pool = new FakePool()
    const store = new MysqlStore({ pool })
    await store.start()
    for (let i = 0; i < 20; i++) pool.failNext(/^insert into `cursors`/i, deadlockError())
    await expect(store.setCursor('k', 'v')).rejects.toThrow(/Deadlock/)
  })

  it('never retries other errors', async () => {
    const pool = new FakePool()
    const store = new MysqlStore({ pool })
    await store.start()
    pool.failNext(/^insert into `cursors`/i, mysqlError('ER_LOCK_WAIT_TIMEOUT', 1205, 'HY000', 'Lock wait timeout exceeded'))
    await expect(store.setCursor('k', 'v')).rejects.toThrow(/Lock wait timeout/)
    await store.setCursor('k', 'v')
    expect(await store.getCursor('k')).toBe('v')
  })
})
