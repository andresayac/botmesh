/**
 * SMTP transport ownership across stop()/start(): a transport the provider
 * created from `smtp` is closed on stop() and rebuilt on the next send (a
 * closed nodemailer pool queues mail forever); an injected `smtpTransport`
 * belongs to the caller and is never closed by the provider.
 */
import { describe, expect, it, vi } from 'vitest'
import { EmailProvider } from '../src/index.js'
import type { SmtpMailOptions, SmtpSendInfo } from '../src/types.js'
import { FakeSmtp } from './support/fakes.js'

const created: PoolLike[] = []

/** Behaves like a nodemailer pool: once closed, sendMail never settles. */
class PoolLike {
  closed = false
  sent: SmtpMailOptions[] = []
  sendMail(mail: SmtpMailOptions): Promise<SmtpSendInfo> {
    if (this.closed) return new Promise(() => {})
    this.sent.push(mail)
    const to = typeof mail.to === 'string' ? mail.to : mail.to.address
    return Promise.resolve({ messageId: mail.messageId, accepted: [to], rejected: [] })
  }
  close(): void { this.closed = true }
}

vi.mock('nodemailer', () => ({
  default: { createTransport: () => { const t = new PoolLike(); created.push(t); return t } },
}))

const silent = { debug() {}, info() {}, warn() {}, error() {} }
const settled = <T>(p: Promise<T>, ms = 1000): Promise<T | 'pending'> =>
  Promise.race([p, new Promise<'pending'>((r) => setTimeout(() => r('pending'), ms))])

describe('EmailProvider — SMTP transport across stop()/start()', () => {
  it('rebuilds the transport it created after stop(), so sends keep working', async () => {
    const provider = new EmailProvider({ address: 'bot@acme.test', smtp: { host: 'smtp.acme.test', options: { pool: true } }, logger: silent })
    await provider.start()
    await provider.send('ana@x.test', { kind: 'text', text: 'one' })
    await provider.stop()
    expect(created[0]!.closed).toBe(true)

    await provider.start()
    const second = await settled(provider.send('ana@x.test', { kind: 'text', text: 'two' }))
    expect(second).not.toBe('pending')
    expect(created).toHaveLength(2)
    expect(created[1]!.sent.map((m) => m.text)).toEqual(['two'])
    await provider.stop()
  })

  it('never closes an injected smtpTransport', async () => {
    const smtp = new FakeSmtp()
    const provider = new EmailProvider({ address: 'bot@acme.test', smtpTransport: smtp, logger: silent })
    await provider.start()
    await provider.stop()
    expect(smtp.closed).toBe(false)
    await provider.start()
    await provider.send('ana@x.test', { kind: 'text', text: 'again' })
    expect(smtp.sent).toHaveLength(1)
  })
})
