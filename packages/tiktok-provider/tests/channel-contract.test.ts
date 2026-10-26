/**
 * Cross-channel contract: epoch-ms timestamps (checked with the reusable helper from
 * `@botmesh/core/testing`) and the declared text limit.
 */
import { describe, it, expect } from 'vitest'
import { assertCapabilityContract, assertInboundContract } from '@botmesh/core/testing'
import { parseWebhook } from '../src/parseInbound.js'
import { parseJsonLossless } from '../src/json.js'
import { TikTokProvider } from '../src/TikTokProvider.js'
import type { TikTokWebhookBody } from '../src/types.js'
import * as fx from './fixtures/webhooks.js'

const parse = (body: unknown) => parseWebhook((typeof body === 'string' ? parseJsonLossless(body) : body) as TikTokWebhookBody)

describe('TikTok — channel contract', () => {
  it('emits epoch ms for comments, DMs and card clicks', () => {
    const events = [fx.commentInsertRaw, fx.dmText, fx.dmImage, fx.dmCardClick, fx.highIntentComment].flatMap((b) => parse(b))
    expect(events.length).toBeGreaterThanOrEqual(5)
    assertInboundContract(events)
  })

  it('falls back to create_time (seconds → ms), then to the receive time — never 0', () => {
    const before = Date.now()
    const content = { ...JSON.parse(fx.dmText.content as string) as Record<string, unknown>, timestamp: undefined }
    const [withCreate] = parse(fx.envelope('im_receive_msg', content))
    expect(withCreate?.kind === 'message' && withCreate.message.timestamp).toBe(1_701_090_882_000)
    const [bare] = parse(fx.envelope('im_receive_msg', content, { create_time: undefined }))
    expect(bare?.kind === 'message' && bare.message.timestamp).toBeGreaterThanOrEqual(before)
  })

  it('declares the 6000-character DM text limit', () => {
    const p = new TikTokProvider({ accessToken: 'a', businessId: 'b', allowUnsignedWebhooks: true })
    expect(p.capabilities.maxTextLength).toBe(6000)
  })
})

describe('capability contract', () => {
  it('capability flags agree with the optional methods (unsupported = absent)', () => {
    assertCapabilityContract(new TikTokProvider({ accessToken: 'a', businessId: 'b', allowUnsignedWebhooks: true }))
  })
})
