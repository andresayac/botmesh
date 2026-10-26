/**
 * The inbound shape contract (epoch-ms timestamps, message fields), checked with the
 * reusable helper from `@botmesh/core/testing` against the Cloud API webhook parser.
 */
import { describe, it, expect } from 'vitest'
import type { IProvider } from '@botmesh/core'
import { assertCapabilityContract, assertInboundContract } from '@botmesh/core/testing'
import { CloudAPIProvider } from '../src/CloudAPIProvider.js'
import { parseInbound, type GraphWebhookBody } from '../src/parseInbound.js'
import { fixture } from './support-fixtures.js'

const wrap = (value: unknown): GraphWebhookBody => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'pnid', changes: [{ field: 'messages', value: value as never }] }],
})

describe('Cloud API parseInbound — inbound contract', () => {
  it('converts the webhook epoch seconds to epoch ms (messages, interactions, statuses)', () => {
    const events = [
      ...parseInbound(fixture('message-text') as GraphWebhookBody),
      ...parseInbound(fixture('status-failed-131047') as GraphWebhookBody),
      ...parseInbound(wrap({
        messages: [{ from: '573001', id: 'wamid.B', timestamp: '1751400301', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'yes', title: 'Sí' } } }],
      })),
    ]
    expect(events.map((e) => e.kind)).toEqual(['message', 'status', 'interaction'])
    assertInboundContract(events)
    const first = events[0]
    expect(first?.kind === 'message' && first.message.timestamp).toBe(1_751_400_300_000)
  })
})

describe('Cloud API — text limit', () => {
  it('declares the 4096-character text body limit so the core splits longer text', async () => {
    const { CloudAPIProvider } = await import('../src/CloudAPIProvider.js')
    const p = new CloudAPIProvider({ accessToken: 'TOK', phoneNumberId: 'PNID', verifyToken: 'vt', allowUnsignedWebhooks: true })
    expect(p.capabilities.maxTextLength).toBe(4096)
  })
})

describe('capability contract', () => {
  it('capability flags agree with the optional methods (unsupported = absent)', () => {
    const p = new CloudAPIProvider({ accessToken: 'T', phoneNumberId: 'P', verifyToken: 'v', allowUnsignedWebhooks: true })
    assertCapabilityContract(p)
    // No typing primitive and no delete-for-everyone: the methods are absent, not silent no-ops.
    expect((p as IProvider).typing).toBeUndefined()
    expect((p as IProvider).deleteMessage).toBeUndefined()
  })
})

describe('local media path that cannot be read', () => {
  it('rejects with UnsupportedContentError (cause: the fs error), not a raw ENOENT', async () => {
    const { UnsupportedContentError } = await import('@botmesh/core')
    const missing = 'C:/definitely/missing/botmesh-photo.png'
    for (const media of [missing, { path: missing }]) {
      const err = await new CloudAPIProvider({ accessToken: 'T', phoneNumberId: 'P', verifyToken: 'v', allowUnsignedWebhooks: true }).send('573001', { kind: 'image', media }).then(() => undefined, (e: unknown) => e)
      expect(err).toBeInstanceOf(UnsupportedContentError)
      expect((err as Error).message).toContain('botmesh-photo.png')
      expect(((err as Error).cause as { code?: string } | undefined)?.code).toBe('ENOENT')
    }
  })
})
