/**
 * `ChaosProvider.selfId` must satisfy `IProvider.selfId?: UserId | null` even under
 * `exactOptionalPropertyTypes` (TS2420): the getter never returns `undefined`.
 * The `expectTypeOf` lines are enforced by `pnpm typecheck`.
 */
import { describe, it, expect, expectTypeOf } from 'vitest'
import { MockProvider } from '../src/testing/MockProvider.js'
import { ChaosProvider } from '../src/testing/chaos.js'
import { RecordingProvider } from '../src/testing/transcripts/record.js'
import type { IProvider, UserId } from '../src/core/provider.js'

describe('ChaosProvider.selfId / RecordingProvider.selfId', () => {
  it('is typed UserId | null (no undefined), so it implements IProvider under exactOptionalPropertyTypes', () => {
    expectTypeOf<ChaosProvider['selfId']>().toEqualTypeOf<UserId | null>()
    expectTypeOf<RecordingProvider['selfId']>().toEqualTypeOf<UserId | null>()
  })

  it('reports null when the wrapped provider has no selfId, and forwards it otherwise', () => {
    const inner: IProvider = new MockProvider()
    // A provider object without the optional field at all.
    const minimal: IProvider = {
      id: 'min',
      capabilities: inner.capabilities,
      start: async () => {},
      stop: async () => {},
      send: async (chatId) => ({ ref: { id: 'x', chatId } }),
      onEvent: () => () => {},
    }
    expect(new ChaosProvider(minimal).selfId).toBeNull()
    expect(new RecordingProvider(minimal).selfId).toBeNull()
    const mock = new MockProvider()
    mock.selfId = 'me@bot'
    expect(new ChaosProvider(mock).selfId).toBe('me@bot')
    expect(new RecordingProvider(mock).selfId).toBe('me@bot')
  })
})
