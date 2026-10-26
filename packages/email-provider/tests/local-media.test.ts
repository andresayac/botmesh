/** A local attachment path that cannot be read rejects with a typed, actionable error, not a raw ENOENT. */
import { describe, expect, it } from 'vitest'
import { UnsupportedContentError } from '@botmesh/core'
import { EmailProvider } from '../src/index.js'
import { FakeSmtp } from './support/fakes.js'

const silent = { debug() {}, info() {}, warn() {}, error() {} }

describe('sending an unreadable local file', () => {
  it('rejects with UnsupportedContentError naming the path and the cause', async () => {
    const provider = new EmailProvider({ address: 'bot@acme.test', smtpTransport: new FakeSmtp(), logger: silent })
    for (const media of ['./no/such/factura.pdf', { path: './no/such/factura.pdf' }]) {
      const err = await provider.send('ana@example.com', { kind: 'document', media, filename: 'factura.pdf' }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(UnsupportedContentError)
      expect((err as Error).message).toMatch(/a readable file \(ENOENT\)/)
      expect((err as { cause?: { code?: string } }).cause?.code).toBe('ENOENT')
    }
  })
})
