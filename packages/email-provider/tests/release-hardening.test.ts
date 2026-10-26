/**
 * Release-readiness hardening: defects found testing the provider like a
 * demanding user and an attacker (real GreenMail / Mailpit runs), pinned here
 * with the hermetic fakes.
 */
import { describe, expect, it } from 'vitest'
import { ProviderError, RecipientUnreachableError, UnsupportedContentError, type InboundEvent, type InboundMessage } from '@botmesh/core'
import { EmailProvider, MemoryThreadStore, toEmailError, type EmailProviderConfig, type EmailRaw } from '../src/index.js'
import { parseAddressList, parseEmail } from '../src/internal.js'
import { email, FakeImapServer, FakeSmtp } from './support/fakes.js'

const silent = { debug() {}, info() {}, warn() {}, error() {} }

function setup(overrides: Partial<EmailProviderConfig> = {}) {
  const smtp = new FakeSmtp()
  const provider = new EmailProvider({ address: 'bot@acme.test', smtpTransport: smtp, logger: silent, ...overrides })
  const events: InboundEvent[] = []
  provider.onEvent((e) => { events.push(e) })
  const messages = (): InboundMessage<EmailRaw>[] =>
    events.filter((e): e is Extract<InboundEvent, { kind: 'message' }> => e.kind === 'message').map((e) => e.message as InboundMessage<EmailRaw>)
  return { smtp, provider, messages }
}

describe('addresses with control characters or whitespace', () => {
  it('are not addresses: a bare CR in From never becomes a senderId or an SMTP recipient', async () => {
    expect(parseAddressList('<ana@x\r.test>')).toEqual([])
    expect(parseAddressList('Ana <ana@x\u0000.test>')).toEqual([])
    expect(parseAddressList('<ana@x\rRCPT TO:evil@e.test\r>')).toEqual([])
    expect(parseAddressList('Ana <ana @x.test>')).toEqual([])
    expect(parseAddressList('Ana < ana@x.test >')).toEqual([{ name: 'Ana', address: 'ana@x.test' }])
    expect(parseAddressList('<ana@x.test')).toEqual([{ name: undefined, address: 'ana@x.test' }])
    expect(parseAddressList('ana@x.test>')).toEqual([])

    const { provider, messages } = setup({ loopProtection: false })
    const result = await provider.ingest('From: <ana@x\r.test>\r\nMessage-ID: <m1@x.test>\r\nSubject: hi\r\n\r\nhola')
    expect(result).toEqual({ status: 200, accepted: false, reason: 'invalid' })
    expect(messages()).toHaveLength(0)
  })

  it('a Reply-To with control characters is ignored and the reply goes to From', async () => {
    const { provider, smtp, messages } = setup({ replyTo: 'always' })
    await provider.ingest('From: ana@x.test\r\nReply-To: <r@x\r.test>\r\nMessage-ID: <m2@x.test>\r\nSubject: hi\r\n\r\nhola')
    await provider.send(messages()[0]!.chatId, { kind: 'text', text: 'ok' })
    expect(smtp.sent[0]!.to).toMatchObject({ address: 'ana@x.test' })
  })

  it('send() refuses a stored recipient that is not a single plain address, before SMTP', async () => {
    const threadStore = new MemoryThreadStore()
    await threadStore.setThread('thread:x', { chatId: 'thread:x', subject: 's', counterpart: { address: 'ana@x\r.test' }, references: [], updatedAt: 0 })
    const { provider, smtp } = setup({ threadStore })
    await expect(provider.send('thread:x', { kind: 'text', text: 'hi' })).rejects.toBeInstanceOf(RecipientUnreachableError)
    expect(smtp.sent).toHaveLength(0)
  })

  it('an address chatId that is a list says so instead of "unknown thread"', async () => {
    const { provider } = setup()
    const err = await provider.send('a@x.test,b@y.test', { kind: 'text', text: 'hi' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RecipientUnreachableError)
    expect((err as Error).message).toMatch(/not a valid single email address/)
  })
})

describe('hostile Message-ID / References headers', () => {
  it('ignores a Message-ID longer than the 998-character line limit (synthetic id instead)', async () => {
    const huge = `${'a'.repeat(5000)}@x.test`
    const parsed = parseEmail(`From: ana@x.test\r\nMessage-ID: <${huge}>\r\nIn-Reply-To: <${huge}>\r\nReferences: <root@x.test> <${huge}>\r\n\r\nhi`)
    expect(parsed.messageId).toBeUndefined()
    expect(parsed.inReplyTo).toBeUndefined()
    expect(parsed.references).toEqual(['root@x.test'])

    const { provider, messages } = setup()
    await provider.ingest(`From: ana@x.test\r\nMessage-ID: <${huge}>\r\nSubject: hi\r\n\r\nhola`)
    expect(messages()[0]!.chatId.length).toBeLessThan(100)
  })

  it('caps a huge References chain (root kept) so one email cannot stall the ingest loop', async () => {
    const refs = Array.from({ length: 200_000 }, (_, i) => `<r${i}@x.test>`).join(' ')
    const parsed = parseEmail(`From: ana@x.test\r\nReferences: ${refs}\r\n\r\nhi`)
    expect(parsed.references.length).toBeLessThanOrEqual(100)
    expect(parsed.references[0]).toBe('r0@x.test')
    expect(parsed.references.at(-1)).toBe('r199999@x.test')

    let lookups = 0
    const store = new MemoryThreadStore()
    const counting = Object.assign(Object.create(store) as MemoryThreadStore, {
      getChatIdForMessage: (id: string) => { lookups++; return store.getChatIdForMessage(id) },
    })
    const { provider, messages } = setup({ threadStore: counting })
    await provider.ingest(`From: ana@x.test\r\nMessage-ID: <m3@x.test>\r\nReferences: ${refs}\r\nSubject: hi\r\n\r\nhola`)
    expect(messages()[0]!.chatId).toBe('thread:r0@x.test')
    expect(lookups).toBeLessThan(500)
  })
})

describe('quoted message ids on replies', () => {
  it('ctx.reply() to mail without a Message-ID does not put the synthetic id in In-Reply-To', async () => {
    const { provider, smtp, messages } = setup()
    await provider.ingest('From: ana@x.test\r\nSubject: hi\r\n\r\nhola')
    const m = messages()[0]!
    expect(m.ref.id).toMatch(/^synthetic-/)
    await provider.send(m.chatId, { kind: 'text', text: 'ok' }, { quoted: m.ref })
    expect(smtp.sent[0]!.inReplyTo).toBeUndefined()
    expect(smtp.sent[0]!.references ?? []).toEqual([])
  })

  it('ignores a quoted id that is not a plain Message-ID', async () => {
    const { provider, smtp, messages } = setup()
    await provider.ingest('From: ana@x.test\r\nMessage-ID: <m9@x.test>\r\nSubject: hi\r\n\r\nhola')
    const m = messages()[0]!
    await provider.send(m.chatId, { kind: 'text', text: 'ok' }, { quoted: { id: 'a@b>\r\nBcc: e@e.test', chatId: m.chatId } })
    expect(smtp.sent[0]!.inReplyTo).toBe('<m9@x.test>')
    expect(smtp.sent[0]!.references).toEqual(['<m9@x.test>'])
  })

  it('threads a reply to a real Message-ID without "@" or with a quoted local part', async () => {
    for (const id of ['1234567890.ABCDEF.JavaMail', '"a@b"@x.test']) {
      const { provider, smtp, messages } = setup()
      await provider.ingest(`From: ana@x.test\r\nMessage-ID: <${id}>\r\nSubject: hi\r\n\r\nhola`)
      const m = messages()[0]!
      expect(m.ref.id).toBe(id)
      await provider.send(m.chatId, { kind: 'text', text: 'ok' }, { quoted: m.ref })
      expect(smtp.sent[0]!.inReplyTo).toBe(`<${id}>`)
      expect(smtp.sent[0]!.references).toEqual([`<${id}>`])
    }
  })
})

describe('outbound attachment metadata', () => {
  it('rejects a document mimetype that is not a media type (it produced mail servers drop)', async () => {
    const { provider, smtp } = setup()
    await expect(provider.send('ana@x.test', { kind: 'document', media: Buffer.from('x'), filename: 'x.txt', mimetype: 'text/plain\r\nBcc: e@e.test' }))
      .rejects.toBeInstanceOf(UnsupportedContentError)
    await expect(provider.send('ana@x.test', { kind: 'document', media: Buffer.from('x'), filename: 'x.txt', mimetype: 'not a type' }))
      .rejects.toBeInstanceOf(UnsupportedContentError)
    await provider.send('ana@x.test', { kind: 'document', media: Buffer.from('x'), filename: 'x.txt', mimetype: 'text/plain; charset=utf-8' })
    expect(smtp.sent).toHaveLength(1)
  })

  it('accepts real-world mimetypes: trailing ";", RFC 2231 parameters, quoted values; "" means none', async () => {
    const { provider, smtp } = setup()
    const doc = (mimetype: string) => provider.send('ana@x.test', { kind: 'document', media: Buffer.from('%PDF-1.4 x'), filename: 'x.bin', mimetype })
    await doc('text/csv; charset=utf-8;')
    await doc("application/octet-stream; name*=UTF-8''x%20y.pdf")
    await doc('text/plain; name="a \\"b\\".txt"')
    await doc('application/vnd.ms-excel')
    await doc('')
    expect(smtp.sent).toHaveLength(5)
    const types = smtp.sent.map((m) => (m.attachments as { contentType?: string }[] | undefined)?.[0]?.contentType)
    expect(types.slice(0, 4)).toEqual(['text/csv; charset=utf-8;', "application/octet-stream; name*=UTF-8''x%20y.pdf", 'text/plain; name="a \\"b\\".txt"', 'application/vnd.ms-excel'])
    expect(types[4]).toBe('application/pdf')
    await expect(doc('text/ plain')).rejects.toBeInstanceOf(UnsupportedContentError)
    await expect(doc('text/plain; charset=utf-8\u0000')).rejects.toBeInstanceOf(UnsupportedContentError)
  })

  it('rejects native attachment contentType / cid with control characters', async () => {
    const { provider } = setup()
    const send = (att: Record<string, unknown>) => provider.send('ana@x.test', { kind: 'native', provider: 'email', payload: { text: 'x', attachments: [{ content: Buffer.from('x'), ...att }] } })
    await expect(send({ contentType: 'text/plain\r\nBcc: e@e.test' })).rejects.toBeInstanceOf(UnsupportedContentError)
    await expect(send({ cid: 'logo>\r\nBcc: e@e.test' })).rejects.toBeInstanceOf(UnsupportedContentError)
    await expect(send({ filename: 'a\r\nb.txt' })).rejects.toBeInstanceOf(UnsupportedContentError)
    await send({ filename: 'a.csv', contentType: 'text/csv; charset=utf-8;' })
    await send({ filename: 'a.txt', contentType: '' })
  })
})

describe('actionable connection errors', () => {
  const tlsError = (): Error => Object.assign(new Error('EC330100:error:0A0000C6:SSL routines:tls_get_more_records:packet length too long'), {
    code: 'ERR_SSL_PACKET_LENGTH_TOO_LONG', library: 'SSL routines', reason: 'packet length too long',
  })

  it('IMAP TLS on a plain-text port suggests imap.secure: false', async () => {
    const server = new FakeImapServer()
    server.connectError = tlsError()
    const provider = new EmailProvider({ address: 'bot@acme.test', imap: { host: 'imap.acme.test', port: 3143, user: 'bot@acme.test', pass: 'x' }, createImapClient: server.createClient, logger: silent })
    const err = await provider.start().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as Error).message).toMatch(/TLS/)
    expect((err as Error).message).toMatch(/imap\.secure: false/)
    expect((err as Error).message).toMatch(/imap\.acme\.test:3143/)
  })

  it('a missing IMAP mailbox is named, not "Command failed"', async () => {
    const server = new FakeImapServer()
    const create = () => {
      const c = server.createClient()
      c.getMailboxLock = async () => {
        throw Object.assign(new Error('Command failed'), { responseText: 'SELECT failed. No such mailbox', mailboxMissing: true, responseStatus: 'NO' })
      }
      return c
    }
    const provider = new EmailProvider({ address: 'bot@acme.test', imap: { host: 'h', user: 'bot@acme.test', pass: 'x', mailbox: 'Soporte' }, createImapClient: create, logger: silent })
    const err = await provider.start().catch((e: unknown) => e)
    expect((err as Error).message).toMatch(/mailbox "Soporte"/)
    expect((err as Error).message).toMatch(/No such mailbox/)
  })

  it('SMTP TLS on a plain-text port suggests smtp.secure: false', async () => {
    const smtp = new FakeSmtp()
    smtp.failWith = Object.assign(new Error('EC330100:error:0A00010B:SSL routines:tls_validate_record_header:wrong version number'), {
      code: 'ESOCKET', command: 'CONN', library: 'SSL routines', reason: 'wrong version number',
    })
    const { provider } = setup({ smtpTransport: smtp })
    const err = await provider.send('ana@x.test', { kind: 'text', text: 'hi' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as Error).message).toMatch(/SMTP/)
    expect((err as Error).message).toMatch(/smtp\.secure: false/)
  })

  it('SMTP connection failures say they are SMTP connection failures', () => {
    const err = toEmailError(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ESOCKET', command: 'CONN' }), 'ana@x.test')
    expect(err.message).toMatch(/^SMTP connection failed/)
    expect(err.message).toMatch(/ECONNREFUSED/)
  })
})

describe('sender-controlled Date header', () => {
  it('a Date in the future does not become ctx.timestamp', async () => {
    const { provider, messages } = setup()
    const before = Date.now()
    await provider.ingest(email(['From: ana@x.test', 'Message-ID: <d1@x.test>', 'Date: Fri, 31 Dec 9999 23:59:59 +0000'], 'hola'))
    await provider.ingest(email(['From: ana@x.test', 'Message-ID: <d2@x.test>', 'Date: Mon, 1 Jan 2024 10:00:00 +0000'], 'hola'))
    const [future, past] = messages()
    expect(future!.timestamp).toBeGreaterThanOrEqual(before)
    expect(future!.timestamp).toBeLessThanOrEqual(Date.now())
    expect(past!.timestamp).toBe(Date.UTC(2024, 0, 1, 10))
  })
})
