import { describe, expect, it } from 'vitest'
import { TwilioProvider } from '../src/TwilioProvider.js'

describe('TwilioProvider — configuration errors are actionable', () => {
  const base = { accountSid: 'AC1', authToken: 'tok', webhookUrl: 'https://bot.example.com/hook' }
  it('rejects a whatsappFrom without the whatsapp: prefix (Twilio would send an SMS pair and fail)', () => {
    expect(() => new TwilioProvider({ ...base, whatsappFrom: '+14155238886' })).toThrow(/whatsappFrom.*'whatsapp:\+14155238886'/)
    expect(() => new TwilioProvider({ ...base, whatsappFrom: 'whatsapp:+14155238886' })).not.toThrow()
  })
  it('rejects a webhookUrl that is not an absolute http(s) URL', () => {
    expect(() => new TwilioProvider({ ...base, webhookUrl: '/twilio/webhook' })).toThrow(/webhookUrl.*absolute/)
  })
})
