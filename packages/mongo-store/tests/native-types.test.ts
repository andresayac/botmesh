/**
 * Type-level contract: a real `MongoClient` and a native `Collection` are accepted wherever
 * the package takes them, although no published declaration names mongodb (checked by
 * `pnpm typecheck`).
 */
import { MongoClient } from 'mongodb'
import { describe, expect, it } from 'vitest'

import {
  MongoScheduleStore,
  MongoStore,
  type MongoScheduleStoreOptions,
  type MongoStoreOptions,
  type NativeMongoClient,
} from '../src/index.js'

describe('native mongodb types', () => {
  it('a MongoClient fits the client option and a native Collection the schedule store', async () => {
    const client = new MongoClient('mongodb://127.0.0.1:1') // never connected
    const native: NativeMongoClient = client
    const storeOpts: MongoStoreOptions = { client }
    const scheduleOpts: MongoScheduleStoreOptions = { collection: client.db('x').collection('schedules') }
    expect(new MongoStore(storeOpts)).toBeInstanceOf(MongoStore)
    expect(new MongoScheduleStore(scheduleOpts)).toBeInstanceOf(MongoScheduleStore)
    expect(native).toBe(client)
    await client.close()
  })
})
