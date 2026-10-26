/**
 * Cross-channel contract: epoch-ms timestamps (checked with the reusable helper from
 * `@botmesh/core/testing`) against the real `ingest()` path.
 */
import { describe, it, expect } from 'vitest'
import { assertCapabilityContract, assertInboundContract, recordEvents } from '@botmesh/core/testing'
import { EmailProvider } from '../src/index.js'
import { email, FakeSmtp } from './support/fakes.js'

const silent = { debug() {}, info() {}, warn() {}, error() {} }

describe('Email — channel contract', () => {
  it('uses the Date header in epoch ms, else the receive time (never 0)', async () => {
    const provider = new EmailProvider({ address: 'bot@acme.test', smtpTransport: new FakeSmtp(), logger: silent })
    const rec = recordEvents(provider)
    const before = Date.now()
    await provider.ingest(email(['From: a@example.com', 'Message-ID: <d1@example.com>', 'Date: Tue, 14 Oct 2025 10:00:00 +0000'], 'hola'))
    await provider.ingest(email(['From: a@example.com', 'Message-ID: <d2@example.com>'], 'sin fecha'))
    await provider.ingest(email(['From: a@example.com', 'Message-ID: <d3@example.com>', 'Date: Thu, 01 Jan 1970 00:00:00 +0000'], 'epoch'))
    const msgs = rec.messages()
    expect(msgs).toHaveLength(3)
    assertInboundContract(msgs)
    expect(msgs[0]?.timestamp).toBe(Date.parse('2025-10-14T10:00:00Z'))
    expect(msgs[1]?.timestamp).toBeGreaterThanOrEqual(before)
    expect(msgs[2]?.timestamp).toBeGreaterThanOrEqual(before)
  })
})

describe('capability contract', () => {
  it('capability flags agree with the optional methods (unsupported = absent)', () => {
    assertCapabilityContract(new EmailProvider({ address: 'bot@acme.test', smtpTransport: new FakeSmtp(), logger: silent }))
  })
})

describe('local media path that cannot be read', () => {
  it('rejects with UnsupportedContentError (cause: the fs error), not a raw ENOENT', async () => {
    const { UnsupportedContentError } = await import('@botmesh/core')
    const missing = 'C:/definitely/missing/botmesh-photo.png'
    for (const media of [missing, { path: missing }]) {
      const err = await new EmailProvider({ address: 'bot@acme.test', smtpTransport: new FakeSmtp(), logger: silent }).send('ana@example.com', { kind: 'image', media }).then(() => undefined, (e: unknown) => e)
      expect(err).toBeInstanceOf(UnsupportedContentError)
      expect((err as Error).message).toContain('botmesh-photo.png')
      expect(((err as Error).cause as { code?: string } | undefined)?.code).toBe('ENOENT')
    }
  })
})
