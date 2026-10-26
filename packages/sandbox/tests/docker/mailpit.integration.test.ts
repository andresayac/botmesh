/**
 * Mailpit (real SMTP server in Docker) + EmailProvider outbound: the bot's
 * SMTP sends, checked through Mailpit's HTTP API (headers, threading, the
 * Auto-Submitted loop guard, attachments). Mailpit has no IMAP: inbound mail is
 * covered by the GreenMail suite of @botmesh/email (BOTWA_TEST_EMAIL).
 *
 *   docker compose -f packages/sandbox/docker/compose.yml up -d mailpit
 *   BOTWA_TEST_MAILPIT_URL=http://127.0.0.1:47814 BOTWA_TEST_MAILPIT_SMTP_PORT=47815 \
 *     pnpm --filter @botmesh/sandbox exec vitest run tests/docker
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EmailProvider } from '@botmesh/email'

const API = process.env.BOTWA_TEST_MAILPIT_URL
const SMTP_PORT = Number(process.env.BOTWA_TEST_MAILPIT_SMTP_PORT ?? 47815)
const HOST = process.env.BOTWA_TEST_MAILPIT_HOST ?? '127.0.0.1'
const silent = { debug() {}, info() {}, warn() {}, error() {} }

interface MailpitSummary { ID: string; Subject: string; To: Array<{ Address: string }> }
interface MailpitMessage { From: { Address: string; Name: string }; Subject: string; Text: string; Attachments: Array<{ FileName: string; ContentType: string; Size: number }> }

async function waitForMail(to: string): Promise<MailpitSummary> {
  const end = Date.now() + 15_000
  while (Date.now() < end) {
    const res = await fetch(`${API}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)
    const body = await res.json() as { messages: MailpitSummary[] }
    if (body.messages.length) return body.messages[0]!
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`no mail for ${to}`)
}

describe.skipIf(!API)('Mailpit (Docker) + EmailProvider SMTP', () => {
  const run = randomUUID().slice(0, 8)
  let provider: EmailProvider

  beforeAll(async () => {
    provider = new EmailProvider({
      smtp: { host: HOST, port: SMTP_PORT, secure: false, user: 'bot', pass: 'sandbox', options: { ignoreTLS: true } },
      address: `bot-${run}@sandbox.test`,
      fromName: 'Sandbox Bot',
      logger: silent,
    })
    await provider.start()
  })
  afterAll(async () => { await provider?.stop() })

  it('delivers a text reply with the bot identity and the Auto-Submitted header', async () => {
    const to = `user-${run}@example.test`
    const sent = await provider.send(to, { kind: 'text', text: `Hola desde el sandbox ${run}` })
    expect(sent.ref.id).toBeTruthy()
    const summary = await waitForMail(to)
    const msg = await (await fetch(`${API}/api/v1/message/${summary.ID}`)).json() as MailpitMessage
    expect(msg.From).toMatchObject({ Address: `bot-${run}@sandbox.test`, Name: 'Sandbox Bot' })
    expect(msg.Text).toContain(`Hola desde el sandbox ${run}`)
    const headers = await (await fetch(`${API}/api/v1/message/${summary.ID}/headers`)).json() as Record<string, string[]>
    expect(headers['Auto-Submitted']?.[0]).toMatch(/auto-/)
    expect(headers['Message-Id']?.[0] ?? headers['Message-ID']?.[0]).toBeTruthy()
  })

  it('delivers a document as a MIME attachment', async () => {
    const to = `files-${run}@example.test`
    await provider.send(to, { kind: 'document', media: Buffer.from('%PDF-1.4 sandbox'), filename: 'pedido.pdf', mimetype: 'application/pdf', caption: 'Tu pedido' })
    const summary = await waitForMail(to)
    const msg = await (await fetch(`${API}/api/v1/message/${summary.ID}`)).json() as MailpitMessage
    expect(msg.Attachments).toEqual([expect.objectContaining({ FileName: 'pedido.pdf', ContentType: 'application/pdf' })])
  })
})
