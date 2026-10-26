import { describe, it, expect } from 'vitest'
import pino from 'pino'
import type { InboundEvent } from '@botmesh/core'
import { EmailProvider } from '../src/EmailProvider.js'
import { parseEmail } from '../src/mime.js'
import { eventProblem, int, pick, randomBytes, randomString, rng, type Rng } from './fuzz.js'

const SEEDS: string[] = [
  'From: Ana <ana@x.test>\r\nTo: bot@acme.test\r\nSubject: Hola\r\nMessage-ID: <m1@x.test>\r\n\r\nquiero 3\r\n',
  'From: "B, Bob" <bob@y.test>\r\nTo: bot@acme.test\r\nSubject: =?utf-8?B?w5Fhbs7Fk2Eg8J+YgA==?=\r\nIn-Reply-To: <out1@acme.test>\r\nReferences: <root@y.test> <out1@acme.test>\r\nMessage-ID: <m2@y.test>\r\n' +
    'Content-Type: multipart/mixed; boundary="b1"\r\n\r\n--b1\r\nContent-Type: multipart/alternative; boundary=b2\r\n\r\n--b2\r\nContent-Type: text/plain; charset=iso-8859-1\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nS=ED, gracias\r\n\r\nOn Tue, Bot wrote:\r\n> hola\r\n--b2\r\nContent-Type: text/html\r\n\r\n<p>S&iacute;</p>\r\n--b2--\r\n' +
    '--b1\r\nContent-Type: image/png; name="a.png"\r\nContent-Disposition: attachment; filename*=utf-8\'\'%C3%B1.png\r\nContent-Transfer-Encoding: base64\r\n\r\niVBORw0KGgo=\r\n--b1--\r\n',
  'From: MAILER-DAEMON@x.test\r\nTo: bot@acme.test\r\nSubject: Undelivered\r\nContent-Type: multipart/report; report-type=delivery-status; boundary=r\r\n\r\n--r\r\nContent-Type: text/plain\r\n\r\nfailed\r\n--r\r\nContent-Type: message/delivery-status\r\n\r\nFinal-Recipient: rfc822; ana@x.test\r\nAction: failed\r\nStatus: 5.1.1\r\n\r\n--r\r\nContent-Type: message/rfc822\r\n\r\nMessage-ID: <out1@acme.test>\r\n\r\nx\r\n--r--\r\n',
  'From: c@z.test\r\nAuto-Submitted: auto-replied\r\nPrecedence: bulk\r\nList-Id: <l.z.test>\r\nContent-Type: text/html; charset="utf-8"\r\n\r\n<html><body><a href="https://z.test/x">ver</a><br>ok</body></html>',
]

const FRAGMENTS = ['\r\n', '\n', '\r\n\r\n', ': ', '--b1', '--b1--', '--b2\r\n', 'boundary=', '=?utf-8?Q?=C3=B1?=', '=?x?B?***?=', '<', '>', '"', '(', ')', ',', ';', '@',
  'Content-Type: multipart/mixed; boundary=b1\r\n', 'Content-Transfer-Encoding: base64\r\n', 'Content-Transfer-Encoding: quoted-printable\r\n', '=\r\n', '=ZZ', 'From: ', 'From: <>\r\n',
  'Message-ID: <a b@c>\r\n', 'Date: Mon, 99 Foo 2025 99:99:99 +9999\r\n', 'charset=bogus', 'filename*0*=utf-8\'\'%E2', 'filename*1*=%82%AC', '\u0000', '😀', '\uD800']

/** Splice random fragments / bytes into, and cut random slices out of, a seed email. */
function mutateMime(r: Rng): string {
  let s = pick(r, SEEDS)
  for (let k = 1 + int(r, 6); k > 0; k--) {
    const at = int(r, s.length + 1)
    const roll = r()
    if (roll < 0.45) s = s.slice(0, at) + pick(r, FRAGMENTS) + s.slice(at)
    else if (roll < 0.7) s = s.slice(0, at) + s.slice(at + int(r, 40))
    else if (roll < 0.85) s = s.slice(0, at) + randomString(r) + s.slice(at)
    else s = s.slice(0, at) + s.slice(at, at + int(r, 200)).repeat(1 + int(r, 5)) + s.slice(at)
  }
  return s
}

function harness() {
  const provider = new EmailProvider({ address: 'bot@acme.test', logger: pino({ level: 'silent' }), loopProtection: { maxPerSender: { max: 1e9, windowMs: 1000 } } })
  const events: InboundEvent[] = []
  provider.onEvent((e) => { events.push(e as InboundEvent) })
  return { provider, events }
}

describe('EmailProvider — fuzzed MIME', () => {
  it('parseEmail never throws on mutated messages or random bytes', () => {
    for (let seed = 1; seed <= 3000; seed++) {
      const r = rng(seed)
      const input = r() < 0.8 ? mutateMime(r) : randomBytes(r)
      expect(() => parseEmail(input), `seed ${seed}`).not.toThrow()
    }
  })

  it('ingest() never rejects and only emits well-formed events', async () => {
    for (let seed = 1; seed <= 1500; seed++) {
      const r = rng(seed)
      const { provider, events } = harness()
      const input = pick(r, [mutateMime(r), mutateMime(r), randomBytes(r), int(r, 3), null, {}])
      const result = await provider.ingest(input).catch((err: unknown) => ({ thrown: err }))
      expect(result, `seed ${seed}`).not.toHaveProperty('thrown')
      expect([200, 400, 413], `seed ${seed}`).toContain((result as { status: number }).status)
      for (const e of events) {
        expect(eventProblem(e), `seed ${seed}`).toBeUndefined()
        if (e.kind === 'message') {
          expect(e.message.senderId, `seed ${seed}`).toBe(e.message.senderId.toLowerCase())
          expect(e.message.senderId, `seed ${seed}`).toContain('@')
        }
      }
    }
  })
})
