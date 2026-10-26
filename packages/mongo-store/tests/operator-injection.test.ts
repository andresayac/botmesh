/**
 * Ids that are not strings never reach a MongoDB filter. The types say `string`, but an
 * app that forwards untrusted JSON (`req.body.chatId`) can hand the store an object such
 * as `{ $ne: '' }`, which MongoDB reads as a query operator: against a real server,
 * `getMessagesByChat` returned every chat's messages, `listUserData` every user's
 * `ctx.user` data, and `deleteChat` / `deleteUserData` wiped other users' records.
 * The SQL stores bind every value as text, so only this store needed the guard.
 */
import { describe, expect, it } from 'vitest'
import type { FlowCheckpoint, StoredMessage } from '@botmesh/core'
import { MongoStore } from '../src/MongoStore.js'
import { MongoScheduleStore } from '../src/schedules.js'
import { FakeMongoClient } from './fakeMongo.js'
import { FakeScheduleCollection } from './fakeScheduleCollection.js'

const evil = { $ne: '' } as unknown as string
const cp: FlowCheckpoint = { flowId: 'f', step: 0, state: {}, updatedAt: 1 }
const msg = (chatId: string, id: string): StoredMessage => ({ ref: { id, chatId }, chatId, senderId: 'u', timestamp: 1, type: 'text', body: 'b', fromMe: false })

describe('MongoStore — non-string ids (operator injection)', () => {
  it('rejects them with a TypeError before any command reaches the driver', async () => {
    const store = new MongoStore({ client: new FakeMongoClient() })
    await store.start()
    const calls: Array<[string, () => Promise<unknown>]> = [
      ['saveMessage chatId', () => store.saveMessage(msg(evil, 'm'))],
      ['saveMessage ref.id', () => store.saveMessage(msg('c', evil))],
      ['getMessage', () => store.getMessage({ chatId: evil, id: 'm' })],
      ['getMessagesByChat', () => store.getMessagesByChat(evil)],
      ['deleteMessage', () => store.deleteMessage({ chatId: evil, id: evil })],
      ['upsertChat', () => store.upsertChat({ id: evil, name: 'x' })],
      ['getChat', () => store.getChat(evil)],
      ['deleteChat', () => store.deleteChat(evil)],
      ['upsertContact', () => store.upsertContact({ id: evil, name: 'x' })],
      ['getContact', () => store.getContact(evil)],
      ['deleteContact', () => store.deleteContact(evil)],
      ['getCursor', () => store.getCursor(evil)],
      ['setCursor', () => store.setCursor(evil, 'v')],
      ['getCheckpoint', () => store.getCheckpoint(evil)],
      ['setCheckpoint', () => store.setCheckpoint(evil, cp)],
      ['clearCheckpoint', () => store.clearCheckpoint(evil)],
      ['setCheckpointIf', () => store.setCheckpointIf(evil, cp, 0)],
      ['clearCheckpointIf', () => store.clearCheckpointIf(evil, 0)],
      ['getConversation', () => store.getConversation(evil)],
      ['setConversation', () => store.setConversation(evil, [])],
      ['clearConversation', () => store.clearConversation(evil)],
      ['getUserData', () => store.getUserData(evil, 'n', 'k')],
      ['setUserData', () => store.setUserData({ userId: evil, namespace: 'n', key: 'k', value: 1, updatedAt: 1 })],
      ['deleteUserData user', () => store.deleteUserData(evil)],
      ['deleteUserData namespace', () => store.deleteUserData('u', evil)],
      ['listUserData user', () => store.listUserData(evil)],
      ['listUserData namespace', () => store.listUserData('u', evil)],
    ]
    for (const [name, call] of calls) {
      await expect(call(), name).rejects.toThrow(TypeError)
    }
  })

  it('keeps every other chat and user intact', async () => {
    const fake = new FakeMongoClient()
    const store = new MongoStore({ client: fake })
    await store.start()
    await store.saveMessage(msg('alice', 'm1'))
    await store.upsertChat({ id: 'alice', name: 'Alice' })
    await store.setUserData({ userId: 'alice', namespace: 'n', key: 'k', value: 'pii', updatedAt: 1 })
    await expect(store.deleteChat(evil)).rejects.toThrow(/chatId must be a string/)
    await expect(store.deleteUserData(evil)).rejects.toThrow(/userId must be a string/)
    expect(await store.getMessagesByChat('alice')).toHaveLength(1)
    expect(await store.getChat('alice')).toEqual({ id: 'alice', name: 'Alice' })
    expect(await store.listUserData('alice')).toHaveLength(1)
  })
})

describe('MongoScheduleStore — non-string ids', () => {
  it('rejects them with a TypeError', async () => {
    const store = new MongoScheduleStore({ collection: new FakeScheduleCollection() })
    await expect(store.get(evil)).rejects.toThrow(TypeError)
    await expect(store.register({ id: evil, kind: 'once', spec: '1', nextRunAt: 1 }, 0)).rejects.toThrow(TypeError)
    await expect(store.claimDue(evil, 'o', 1, 1000)).rejects.toThrow(TypeError)
    await expect(store.claimDue('t', evil, 1, 1000)).rejects.toThrow(TypeError)
    await expect(store.renew(evil, 1, 1)).rejects.toThrow(TypeError)
    await expect(store.complete(evil, 1, { nextRunAt: null }, 1)).rejects.toThrow(TypeError)
    await expect(store.delete(evil)).rejects.toThrow(TypeError)
  })
})
