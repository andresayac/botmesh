/**
 * Defects found by the release test pass (a demanding user and an attacker): connection
 * configuration, error quality, input limits and lifecycle races. Hermetic: 'mysql2/promise'
 * is mocked so the own-pool path builds a FakePool and records the config it was given.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FlowCheckpoint, StoredMessage } from '@botmesh/core'
import { MysqlStore } from '../src/MysqlStore.js'
import { MysqlScheduleStore } from '../src/schedules.js'
import { FakePool } from './fakePool.js'

const driver = vi.hoisted(() => ({
  configs: [] as unknown[],
  pools: [] as unknown[],
  /** Built by the next createPool() call instead of a plain FakePool. */
  next: undefined as (() => unknown) | undefined,
}))

vi.mock('mysql2/promise', async () => {
  const { FakePool } = await import('./fakePool.js')
  return {
    createPool: (config: unknown) => {
      driver.configs.push(config)
      const pool = driver.next ? driver.next() : new FakePool()
      driver.next = undefined
      driver.pools.push(pool)
      return pool
    },
  }
})

beforeEach(() => {
  driver.configs.length = 0
  driver.pools.length = 0
  driver.next = undefined
})

const msg = (chatId: string, id: string): StoredMessage => ({
  ref: { id, chatId }, chatId, senderId: chatId, timestamp: 1, type: 'text', body: 'b', fromMe: false,
})

/** What a refused connection to `localhost` looks like with mysql2 on Node >= 20 (happy eyeballs). */
function refusedLocalhost(): Error {
  const err = new AggregateError(
    [new Error('connect ECONNREFUSED ::1:3306'), new Error('connect ECONNREFUSED 127.0.0.1:3306')],
    '',
  )
  return Object.assign(err, { code: 'ECONNREFUSED', fatal: true })
}

describe('MysqlStore — tablePrefix length', () => {
  it('rejects a prefix that would push a table or index name past MySQL\'s 64-character limit', () => {
    // `user_data_expires_idx` is the longest name (21 characters): 43 + 21 = 64.
    expect(() => new MysqlStore({ pool: new FakePool(), tablePrefix: 'p'.repeat(43) })).not.toThrow()
    expect(() => new MysqlStore({ pool: new FakePool(), tablePrefix: 'p'.repeat(44) })).toThrow(RangeError)
    expect(() => new MysqlStore({ pool: new FakePool(), tablePrefix: 'p'.repeat(44) })).toThrow(/at most 43 characters/)
  })

  it('MysqlScheduleStore allows up to 55 characters (`schedules` is 9)', () => {
    const pool = new FakePool()
    expect(() => new MysqlScheduleStore({ pool, tablePrefix: 'p'.repeat(55) })).not.toThrow()
    expect(() => new MysqlScheduleStore({ pool, tablePrefix: 'p'.repeat(56) })).toThrow(/at most 55 characters/)
  })
})

describe('MysqlStore — connection URI', () => {
  it('rejects a malformed uri in the constructor without echoing it (it holds the password)', () => {
    for (const uri of ['mysql//root:S3CRET@db/botwa', 'mysql://root:p#S3CRET@db:3306/botwa', '']) {
      let err: unknown
      try {
        new MysqlStore({ uri })
      } catch (e) {
        err = e
      }
      expect(err, uri).toBeInstanceOf(TypeError)
      expect((err as Error).message).toMatch(/MysqlStore: `uri`/)
      expect(JSON.stringify(err)).not.toContain('S3CRET')
      expect((err as Error).message).not.toContain('S3CRET')
      expect((err as Error).cause).toBeUndefined()
    }
  })

  it('explains how to percent-encode a password with reserved characters', () => {
    expect(() => new MysqlStore({ uri: 'mysql://root:p#ss@db:3306/botwa' })).toThrow(/percent-encode/i)
  })

  it('rejects a uri that is not mysql:// (or mariadb://), naming only the scheme', () => {
    expect(() => new MysqlStore({ uri: 'root:S3CRET@127.0.0.1:3306/botwa' })).toThrow(/mysql:\/\//)
    expect(() => new MysqlStore({ uri: 'postgres://u:S3CRET@db/botwa' })).toThrow(/"postgres:"/)
    expect(() => new MysqlStore({ uri: 'mariadb://u:pw@db:3306/botwa' })).not.toThrow()
  })

  it('combines `uri` with discrete options (the discrete ones win) instead of dropping the uri', async () => {
    const store = new MysqlStore({ uri: 'mysql://bot@db.internal:3307/botwa', password: 'from-env' })
    await store.start()
    expect(driver.configs).toEqual([{ uri: 'mysql://bot@db.internal:3307/botwa', password: 'from-env' }])
    await store.stop()
  })

  it('passes discrete options alone, without undefined keys', async () => {
    const store = new MysqlStore({ host: 'db', database: 'botwa' })
    await store.start()
    expect(driver.configs).toEqual([{ host: 'db', database: 'botwa' }])
    await store.stop()
  })
})

describe('MysqlStore — start() errors', () => {
  it('turns an empty-message refused connection into one that says where it tried to connect', async () => {
    const pool = new FakePool()
    pool.failNext(/^create table/i, refusedLocalhost())
    driver.next = () => pool
    const store = new MysqlStore({ uri: 'mysql://root:S3CRET@localhost:3306/botwa' })
    const err = (await store.start().catch((e: unknown) => e)) as Error & { code?: string }
    expect(err.message).toMatch(/MysqlStore: cannot connect to MySQL at localhost:3306 \(database "botwa"\)/)
    expect(err.message).toMatch(/ECONNREFUSED/)
    expect(err.message).toMatch(/127\.0\.0\.1/) // the Windows/Docker localhost hint
    expect(err.message).not.toContain('S3CRET')
    expect(err.code).toBe('ECONNREFUSED') // callers checking err.code keep working
    expect(err.cause).toBeInstanceOf(AggregateError)
    await store.stop()
  })

  it('leaves server errors (unknown database, access denied) as they are', async () => {
    const pool = new FakePool()
    const original = Object.assign(new Error("Unknown database 'nope'"), { code: 'ER_BAD_DB_ERROR', errno: 1049 })
    pool.failNext(/^create table/i, original)
    driver.next = () => pool
    const store = new MysqlStore({ uri: 'mysql://root@127.0.0.1:3306/nope' })
    await expect(store.start()).rejects.toBe(original)
    await store.stop()
  })
})

describe('MysqlStore — key and value limits', () => {
  it('rejects over-long ids with a RangeError naming the limit, before writing anything', async () => {
    const pool = new FakePool()
    const store = new MysqlStore({ pool })
    await store.start()
    const before = pool.queries.length
    const long = 'x'.repeat(1025)
    const cp: FlowCheckpoint = { flowId: 'f', step: 0, state: {}, updatedAt: 1 }
    const calls: Array<() => Promise<unknown>> = [
      () => store.saveMessage(msg('c', long)),
      () => store.saveMessage(msg(long, 'm')),
      () => store.upsertChat({ id: long }),
      () => store.upsertContact({ id: long }),
      () => store.setCursor(long, 'v'),
      () => store.setCheckpoint(long, cp),
      () => store.setCheckpointIf(long, cp, 0),
      () => store.setConversation(long, []),
    ]
    for (const call of calls) {
      await expect(call()).rejects.toThrow(RangeError)
      await expect(call()).rejects.toThrow(/1024 bytes/)
    }
    expect(pool.queries.slice(before).filter((q) => !/^select/i.test(q.sql))).toEqual([])
    // Exactly at the limit is fine (counted in UTF-8 bytes).
    await store.setCursor('é'.repeat(512), 'v')
    await expect(store.setCursor('é'.repeat(512) + 'x', 'v')).rejects.toThrow(/1025 bytes/)
    await store.stop()
  })

  it('reads with an over-long id simply find nothing', async () => {
    const pool = new FakePool()
    const store = new MysqlStore({ pool })
    await store.start()
    expect(await store.getChat('x'.repeat(2000))).toBeUndefined()
    await store.stop()
  })

  it('rejects a ctx.user value larger than MEDIUMTEXT with a RangeError', async () => {
    const pool = new FakePool()
    const store = new MysqlStore({ pool })
    await store.start()
    const value = 'v'.repeat(16 * 1024 * 1024)
    await expect(store.setUserData({ userId: 'u', namespace: 'n', key: 'k', value, updatedAt: 1 })).rejects.toThrow(RangeError)
    await expect(store.setUserData({ userId: 'u', namespace: 'n', key: 'k', value, updatedAt: 1 })).rejects.toThrow(/16 MiB/)
    await store.stop()
  })
})

describe('MysqlStore — connection the server already closed', () => {
  it('runs a statement again when it could not even be written to the socket', async () => {
    // MariaDB closes the connection after "packet bigger than max_allowed_packet"; the pool
    // still hands it out once and the next statement fails with "write ECONNABORTED".
    const pool = new FakePool()
    const store = new MysqlStore({ pool })
    await store.start()
    pool.failNext(/^insert into `cursors`/i, Object.assign(new Error('write ECONNABORTED'), { code: 'ECONNABORTED', syscall: 'write', fatal: true }))
    await store.setCursor('k', 'v')
    expect(await store.getCursor('k')).toBe('v')
    await store.stop()
  })

  it('runs a large statement on its own connection and closes that connection when it fails', async () => {
    // A statement over max_allowed_packet makes the server close its connection; through
    // pool.query that dead connection went back to the pool and failed the NEXT statement.
    const pool = new FakePool()
    const store = new MysqlStore({ pool })
    await store.start()
    const big = { ...msg('c', 'big'), body: 'z'.repeat(2 * 1024 * 1024) }
    pool.failNext(/^insert into `messages`/i, Object.assign(new Error("Got a packet bigger than 'max_allowed_packet' bytes"), { code: 'ER_NET_PACKET_TOO_LARGE', errno: 1153 }))
    await expect(store.saveMessage(big)).rejects.toThrow(/max_allowed_packet/)
    expect(pool.connections).toHaveLength(1)
    expect(pool.connections[0]!.destroyed).toBe(true)
    await store.saveMessage(big) // succeeds on a fresh connection, which goes back to the pool
    expect(pool.connections).toHaveLength(2)
    expect(pool.connections[1]!.released).toBe(true)
    expect(pool.checkedOut).toBe(0)
    expect((await store.getMessage(big.ref))?.body).toHaveLength(2 * 1024 * 1024)
    // Small statements keep using pool.query.
    await store.setCursor('k', 'v')
    expect(pool.connections).toHaveLength(2)
    await store.stop()
  })

  it('never re-runs a statement that may have reached the server', async () => {
    const pool = new FakePool()
    const store = new MysqlStore({ pool })
    await store.start()
    pool.failNext(/^insert into `cursors`/i, Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET', syscall: 'read', fatal: true }))
    await expect(store.setCursor('k', 'v')).rejects.toThrow(/ECONNRESET/)
    await store.stop()
  })
})

describe('MysqlStore — stop() during start()', () => {
  it('closes the pool start() was still creating', async () => {
    const store = new MysqlStore({ uri: 'mysql://root@127.0.0.1:3306/botwa' })
    const starting = store.start().catch((e: unknown) => e)
    await store.stop()
    await starting
    expect(driver.pools).toHaveLength(1)
    expect((driver.pools[0] as FakePool).ended).toBe(true)
    await expect(store.getChat('x')).rejects.toThrow(/call start\(\) first/)
  })
})
