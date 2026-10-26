import { describe, it, expect } from 'vitest'
import { parseInbound, type IgMessagingEvent, type IgWebhookBody } from '../src/parseInbound.js'

const wrap = (...messaging: IgMessagingEvent[]): IgWebhookBody => ({ object: 'instagram', entry: [{ id: 'ig', time: 1, messaging }] })

describe('parseInbound (Instagram): media MIME type', () => {
  it.each([
    ['image', 'image/jpeg'],
    ['video', 'video/mp4'],
    ['audio', 'audio/aac'],
    ['file', 'application/octet-stream'],
  ])('a %s attachment carries a default MIME type (the webhook has none)', (type, mime) => {
    const [e] = parseInbound(wrap({
      sender: { id: 'IGSID_1' }, recipient: { id: 'IG' }, timestamp: 1,
      message: { mid: `mid.${type}`, attachments: [{ type, payload: { url: 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1' } }] },
    }))
    if (e?.kind !== 'message') throw new Error('expected message')
    expect(e.message.media?.mimetype).toBe(mime)
  })
})
