/**
 * webhookPath behind @botmesh/server: Twilio signs the exact console URL, so
 * the query string must reach `ingest` byte for byte (not re-encoded by
 * URLSearchParams), through a real node:http server and the fetch handler.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import pino from 'pino'
import { createFetchHandler, createIngress, createNodeHandler } from '@botmesh/server'
import { TwilioProvider } from '../src/TwilioProvider.js'
import { computeTwilioSignature } from '../src/signature.js'

const silent = pino({ level: 'silent' })
const params = { MessageSid: `SM${'b'.repeat(32)}`, From: 'whatsapp:+15550001111', To: 'whatsapp:+14155238886', Body: 'hola', NumMedia: '0' }
const body = new URLSearchParams(params).toString()
const QUERIES = ['', 'tenant=a', 'tenant=a%20b', 'flag', 'next=/x', 't=~x', 'b=2&a=1', 'tenant=a+b']

let server: Server | undefined
afterEach(async () => {
  const s = server
  server = undefined
  if (s) await new Promise<void>((resolve) => { s.closeAllConnections(); s.close(() => resolve()) })
})

function provider(): TwilioProvider {
  return new TwilioProvider({ accountSid: 'AC1', authToken: 'tok', webhookPath: '/twilio', logger: silent })
}

describe('TwilioProvider webhookPath behind @botmesh/server', () => {
  it.each(QUERIES)('node handler accepts a correctly signed request (query "%s")', async (query) => {
    const ingress = createIngress({ routes: [{ path: '/twilio', provider: provider() }] })
    server = createServer(createNodeHandler(ingress))
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const suffix = query ? `?${query}` : ''
    const signature = computeTwilioSignature('tok', `https://bot.example.com/twilio${suffix}`, params)
    const res = await fetch(`http://127.0.0.1:${port}/twilio${suffix}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-host': 'bot.example.com', 'x-twilio-signature': signature },
      body,
    })
    expect(res.status).toBe(200)
  })

  it.each(QUERIES)('fetch handler accepts a correctly signed request (query "%s")', async (query) => {
    const handler = createFetchHandler(createIngress({ routes: [{ path: '/twilio', provider: provider() }] }))
    const suffix = query ? `?${query}` : ''
    const url = `https://bot.example.com/twilio${suffix}`
    const res = await handler(new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', host: 'bot.example.com', 'x-twilio-signature': computeTwilioSignature('tok', url, params) },
      body,
    }))
    expect(res.status).toBe(200)
  })
})
