import { describe, it, expect } from 'vitest'
import * as graphCore from '@botmesh/graph-core'
import { verifyChallenge, verifySignature } from '../src/index.js'

describe('deprecated verify re-exports', () => {
  it('verifyChallenge / verifySignature behave like the graph-core functions they forward to', () => {
    const query = { 'hub.mode': 'subscribe', 'hub.verify_token': 'tok', 'hub.challenge': '42' }
    expect(verifyChallenge(query, 'tok')).toBe(graphCore.verifyChallenge(query, 'tok'))
    expect(verifyChallenge(query, 'bad')).toBe(graphCore.verifyChallenge(query, 'bad'))
    expect(verifySignature('{}', 'sha256=00', 'secret')).toBe(graphCore.verifySignature('{}', 'sha256=00', 'secret'))
  })
})
