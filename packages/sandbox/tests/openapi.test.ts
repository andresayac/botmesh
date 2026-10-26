import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DiscordSimulator, TwilioSimulator, validate, type Schema } from '../src/index.js'
import { DISCORD_MESSAGE_CREATE_OPENAPI, DISCORD_MESSAGE_EDIT_OPENAPI, DISCORD_WEBHOOK_EXECUTE_OPENAPI } from '../src/specs/discord.js'
import { TWILIO_CREATE_MESSAGE_OPENAPI } from '../src/specs/twilio.js'

/** Every `$ref` inside a vendored fragment must point at one of its own `$defs`. */
function refs(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) for (const n of node) refs(n, out)
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string') out.push(v)
      else refs(v, out)
    }
  }
  return out
}

describe('vendored official OpenAPI fragments', () => {
  it.each([
    ['twilio CreateMessageRequest', TWILIO_CREATE_MESSAGE_OPENAPI],
    ['discord MessageCreateRequest', DISCORD_MESSAGE_CREATE_OPENAPI],
    ['discord MessageEditRequest', DISCORD_MESSAGE_EDIT_OPENAPI],
    ['discord webhook execute', DISCORD_WEBHOOK_EXECUTE_OPENAPI],
  ] as Array<[string, Schema]>)('%s is self-contained', (_name, schema) => {
    for (const ref of refs(schema)) {
      expect(ref.startsWith('#/$defs/'), ref).toBe(true)
      expect(Object.hasOwn(schema.$defs ?? {}, ref.slice('#/$defs/'.length)), ref).toBe(true)
    }
  })

  it('accepts what the providers send and rejects what the official spec forbids', () => {
    expect(validate(DISCORD_MESSAGE_CREATE_OPENAPI, { content: 'hola', components: [{ type: 1, components: [{ type: 2, style: 1, label: 'Café', custom_id: 'cafe' }] }] })).toEqual([])
    expect(validate(DISCORD_MESSAGE_CREATE_OPENAPI, { content: 'hola', nonce: 'x'.repeat(26) })).not.toEqual([])
    expect(validate(TWILIO_CREATE_MESSAGE_OPENAPI, { To: 'whatsapp:+1', From: 'whatsapp:+2', Body: 'hola' })).toEqual([])
    expect(validate(TWILIO_CREATE_MESSAGE_OPENAPI, { From: 'whatsapp:+2', Body: 'hola' })).toEqual(['$.To: required'])
  })
})

describe('simulators check requests against the official specs', () => {
  const twilio = new TwilioSimulator()
  const discord = new DiscordSimulator()
  beforeAll(async () => { await twilio.start(); await discord.start() })
  afterAll(async () => { await twilio.stop(); await discord.stop() })

  it('Twilio: a parameter outside CreateMessageRequest is answered with a validation error tagged [openapi]', async () => {
    const auth = 'Basic ' + Buffer.from(`${twilio.accountSid}:${twilio.authToken}`).toString('base64')
    const res = await fetch(`${twilio.url}/2010-04-01/Accounts/${twilio.accountSid}/Messages.json`, {
      method: 'POST',
      headers: { authorization: auth, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: 'whatsapp:+573001112233', From: twilio.whatsappFrom, Body: 'hola', RiskCheck: 'maybe' }).toString(),
    })
    expect(res.status).toBe(400)
    expect(twilio.issues().at(-1)?.issues).toEqual([expect.stringMatching(/^\[openapi\] \$\.RiskCheck: "maybe" is not one of/)])
  })

  it('Discord: a nonce longer than the spec allows is rejected with Invalid Form Body', async () => {
    const res = await fetch(`${discord.url}/api/v10/channels/123/messages`, {
      method: 'POST',
      headers: { authorization: `Bot ${discord.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'hola', nonce: 'x'.repeat(26) }),
    })
    expect(res.status).toBe(400)
    expect(discord.issues().at(-1)?.issues.some((i) => i.startsWith('[openapi] $.nonce'))).toBe(true)
  })

  it('Discord: edits are checked against MessageEditRequest', async () => {
    const res = await fetch(`${discord.url}/api/v10/channels/123/messages/456`, {
      method: 'PATCH',
      headers: { authorization: `Bot ${discord.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ content: 42 }),
    })
    expect(res.status).toBe(400)
    expect(discord.issues().at(-1)?.issues.some((i) => i.startsWith('[openapi] $.content'))).toBe(true)
  })

  it('Discord: a malformed payload_json is a validation error, not a simulator crash', async () => {
    const form = new FormData()
    form.set('payload_json', '{not json')
    const res = await fetch(`${discord.url}/api/v10/channels/123/messages`, { method: 'POST', headers: { authorization: `Bot ${discord.token}` }, body: form })
    expect(res.status).toBe(400)
  })
})
