/**
 * `checkPresenceWhileDisconnected` / `assertPresenceWhileDisconnected` (`@botmesh/core/testing`):
 * a provider that is not connected must resolve `typing()` and `markRead()` without
 * contacting the transport (IProvider "PRESENCE WHILE DISCONNECTED").
 */
import { describe, it, expect } from 'vitest'
import {
  assertPresenceWhileDisconnected,
  checkPresenceWhileDisconnected,
  CapabilityContractError,
  MockProvider,
} from '../src/testing/index.js'
import type { IProvider } from '../src/core/provider.js'

const probe = { chatId: 'c1', ref: { id: 'm1', chatId: 'c1' } }

/** A never-started provider; a non-compliant one contacts its (closed) transport and rejects. */
function offline(compliant: boolean): IProvider {
  const p = new MockProvider() as IProvider
  const transport = async () => { if (!compliant) throw new Error('socket closed') }
  p.typing = transport
  p.markRead = transport
  return p
}

describe('presence while disconnected contract', () => {
  it('a compliant provider has no violation', async () => {
    expect(await checkPresenceWhileDisconnected(offline(true), probe)).toEqual([])
    await expect(assertPresenceWhileDisconnected(offline(true), probe)).resolves.toBeUndefined()
  })

  it('reports typing()/markRead() that reject while disconnected', async () => {
    const violations = await checkPresenceWhileDisconnected(offline(false), probe)
    expect(violations.map((v) => v.rule)).toEqual(['presence-disconnected', 'presence-disconnected'])
    expect(violations.map((v) => v.message).join('\n')).toMatch(/typing\('typing'\)[\s\S]*markRead\(\)/)
    await expect(assertPresenceWhileDisconnected(offline(false), probe)).rejects.toBeInstanceOf(CapabilityContractError)
  })

  it('a provider without the methods has nothing to check', async () => {
    expect(await checkPresenceWhileDisconnected(new MockProvider(), probe)).toEqual([])
  })
})
