/**
 * Graph API version: the default follows Meta's current version (v26.0, released
 * 2026-07-29), and an explicit `apiVersion` still wins. Webhook shapes of v24+:
 * statuses without the `conversation` object and the `played` voice-note status.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_GRAPH_API_VERSION } from '@botmesh/graph-core'
import { CloudAPIProvider } from '../src/CloudAPIProvider.js'
import { parseInbound, type GraphWebhookBody } from '../src/parseInbound.js'

afterEach(() => vi.unstubAllGlobals())

function stubFetch(): string[] {
  const urls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url)
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ messages: [{ id: 'wamid.OUT' }] }) }
  }))
  return urls
}

const cfg = { accessToken: 'TOK', phoneNumberId: 'PNID', verifyToken: 'vt', allowUnsignedWebhooks: true }

describe('Cloud API Graph version', () => {
  it('defaults to the shared current version (v26.0)', async () => {
    expect(DEFAULT_GRAPH_API_VERSION).toBe('v26.0')
    const urls = stubFetch()
    await new CloudAPIProvider(cfg).send('573001112233', { kind: 'text', text: 'hi' })
    expect(urls[0]).toBe('https://graph.facebook.com/v26.0/PNID/messages')
  })

  it('keeps an explicit apiVersion', async () => {
    const urls = stubFetch()
    await new CloudAPIProvider({ ...cfg, apiVersion: 'v24.0' }).send('573001112233', { kind: 'text', text: 'hi' })
    expect(urls[0]).toBe('https://graph.facebook.com/v24.0/PNID/messages')
  })
})

function statusBody(status: Record<string, unknown>): GraphWebhookBody {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: 'PNID' }, statuses: [{ id: 'wamid.S', recipient_id: '573001112233', timestamp: '1760000000', ...status }] } }] }],
  } as GraphWebhookBody
}

describe('v24+ status webhooks', () => {
  it('a status without the conversation object (v24.0+) is still delivered', () => {
    const events = parseInbound(statusBody({ status: 'delivered', pricing: { billable: true, pricing_model: 'PMP', category: 'utility' } }))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'status', status: { status: 'delivered', ref: { id: 'wamid.S' } } })
    const pd = (events[0] as { status: { platformData?: Record<string, unknown> } }).status.platformData
    expect(pd).toBeDefined()
    expect(pd).not.toHaveProperty('conversation')
  })

  it('maps the played voice-note status to read with platformData.played', () => {
    const events = parseInbound(statusBody({ status: 'played' }))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'status', status: { status: 'read', ref: { id: 'wamid.S' }, platformData: { played: true } } })
  })
})
