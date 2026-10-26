/**
 * Pieces shared by the three Meta Graph simulators (WhatsApp Cloud API,
 * Messenger, Instagram): the `X-Hub-Signature-256` signer, the Graph error
 * envelope, the GET subscription handshake and the fault table.
 */

import { createHmac } from 'node:crypto'
import type { FaultKind } from '../sim/base.js'
import { ids } from '../sim/base.js'
import type { SimResponse } from '../sim/http.js'

/** `sha256=<hex HMAC-SHA256(appSecret, rawBody)>`, exactly as Meta signs webhooks. */
export function hubSignature(appSecret: string, body: string | Buffer): string {
  return `sha256=${createHmac('sha256', appSecret).update(body).digest('hex')}`
}

export interface GraphErrorSpec {
  status: number
  code: number
  message: string
  subcode?: number
  type?: string
  details?: string
}

/** A Graph error response (`{ error: { message, type, code, error_subcode, fbtrace_id } }`). */
export function graphError(spec: GraphErrorSpec, headers: Record<string, string> = {}): SimResponse {
  return {
    status: spec.status,
    headers: { ...(spec.status === 401 ? { 'www-authenticate': 'OAuth "Facebook Platform" "invalid_token"' } : {}), ...headers },
    body: {
      error: {
        message: spec.message,
        type: spec.type ?? 'OAuthException',
        code: spec.code,
        ...(spec.subcode !== undefined ? { error_subcode: spec.subcode } : {}),
        ...(spec.details ? { error_data: { messaging_product: 'whatsapp', details: spec.details } } : {}),
        fbtrace_id: `A${ids.upperHex(10)}`,
      },
    },
  }
}

/** Graph fault answers. `variant` selects the Messenger Platform subcodes. */
export function graphFault(kind: FaultKind, retryAfterSec: number, variant: 'whatsapp' | 'messenger' | 'instagram'): SimResponse {
  switch (kind) {
    case 'rateLimit':
      return graphError(
        variant === 'whatsapp'
          ? { status: 429, code: 130429, message: '(#130429) Rate limit hit', details: 'Cloud API message throughput has been reached.' }
          : { status: 429, code: 613, message: 'Calls to this api have exceeded the rate limit.' },
        { 'retry-after': String(retryAfterSec) },
      )
    case 'invalidRecipient':
      if (variant === 'whatsapp') return graphError({ status: 400, code: 131026, message: '(#131026) Message undeliverable', details: 'Unable to deliver message. The recipient may not have WhatsApp or has not accepted the latest terms.' })
      return graphError({ status: 400, code: 100, subcode: variant === 'messenger' ? 2018001 : 2534014, message: '(#100) No matching user found' })
    case 'outsideWindow':
      if (variant === 'whatsapp') return graphError({ status: 400, code: 131047, message: '(#131047) Re-engagement message', details: 'Message failed to send because more than 24 hours have passed since the customer last replied to this number.' })
      return graphError({ status: 400, code: 10, subcode: variant === 'messenger' ? 2018278 : 2534022, message: '(#10) This message is sent outside of allowed window.' })
    case 'mediaTooLarge':
      return graphError({ status: 413, code: 131053, message: '(#131053) Media upload error', details: 'File size exceeds the maximum allowed for this media type.' })
    case 'auth':
      return graphError({ status: 401, code: 190, message: 'Invalid OAuth access token - Cannot parse access token' })
    case 'serverError':
      return graphError({ status: 500, code: 131000, message: '(#131000) Something went wrong', type: 'OAuthException' })
  }
}

/** Graph validation error (`(#100) Invalid parameter`) for a request that breaks the documented shape. */
export function graphInvalid(issues: string[]): SimResponse {
  return graphError({ status: 400, code: 100, message: `(#100) Invalid parameter: ${issues.slice(0, 3).join('; ')}` })
}

/**
 * Run Meta's GET subscription handshake against the bot. Resolves with the
 * status and whether the challenge was echoed back.
 */
export async function verifySubscription(webhookUrl: string, verifyToken: string): Promise<{ status: number; ok: boolean }> {
  const challenge = ids.digits(10)
  const url = new URL(webhookUrl)
  url.searchParams.set('hub.mode', 'subscribe')
  url.searchParams.set('hub.verify_token', verifyToken)
  url.searchParams.set('hub.challenge', challenge)
  const res = await fetch(url)
  const text = await res.text()
  return { status: res.status, ok: res.ok && text === challenge }
}
