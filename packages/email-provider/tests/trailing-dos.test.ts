import { describe, expect, it } from 'vitest'
import { EmailProvider } from '../src/EmailProvider.js'
import { normalizeAddress, parseAddressList } from '../src/address.js'
import { parseEmail } from '../src/mime.js'

/** Wall-clock time of `fn` in ms. */
function timed(fn: () => void): number {
  const start = performance.now()
  fn()
  return performance.now() - start
}

// `/(\r?\n)+$/` and `/>+$/` retry from every position of a long run that is
// not at the end of the string: quadratic, seconds for ~100 KB of input.
describe('trailing-run trimming — linear time on hostile input', () => {
  const N = 200_000

  it('a text body of newlines followed by a character parses quickly', () => {
    const raw = `From: a@b.test\r\nTo: bot@acme.test\r\nSubject: x\r\nContent-Type: text/plain\r\n\r\n${'\n'.repeat(N)}x`
    expect(timed(() => parseEmail(raw))).toBeLessThan(1000)
  })

  it('an email whose body is newlines followed by a character is ingested quickly', async () => {
    const provider = new EmailProvider({ address: 'bot@acme.test', loopProtection: false })
    const raw = `From: a@b.test\r\nTo: bot@acme.test\r\nSubject: x\r\nMessage-ID: <nl@b.test>\r\nContent-Type: text/plain\r\n\r\n${'\n'.repeat(N)}x`
    const start = performance.now()
    expect((await provider.ingest(raw)).accepted).toBe(true)
    expect(performance.now() - start).toBeLessThan(1500)
  })

  it('normalizeAddress on a run of `>` followed by a character is quick', () => {
    expect(timed(() => normalizeAddress(`${'>'.repeat(N)}x`))).toBeLessThan(1000)
  })

  it('a From header with a run of `>` parses quickly and keeps only the angle address', async () => {
    const value = `Eve <eve@evil.example${'>'.repeat(N)}x>`
    expect(timed(() => parseAddressList(value))).toBeLessThan(1000)
    expect(parseAddressList(value)).toEqual([{ name: 'Eve', address: 'eve@evil.example' }])

    const provider = new EmailProvider({ address: 'bot@acme.test', loopProtection: false })
    const seen: string[] = []
    provider.onEvent((e) => { if (e.kind === 'message') seen.push(e.message.senderId) })
    const raw = `From: ${value}\r\nTo: bot@acme.test\r\nSubject: x\r\nMessage-ID: <gt@b.test>\r\nContent-Type: text/plain\r\n\r\nhola`
    const start = performance.now()
    expect((await provider.ingest(raw)).accepted).toBe(true)
    expect(performance.now() - start).toBeLessThan(1500)
    expect(seen).toEqual(['eve@evil.example'])
  })
})

describe('trailing-run trimming — behaviour kept', () => {
  it('strips trailing LF / CRLF runs only', () => {
    const body = (text: string) => parseEmail(`From: a@b.test\r\nContent-Type: text/plain\r\n\r\n${text}`).text
    expect(body('hola\r\n\r\n\n')).toBe('hola')
    expect(body('hola\r')).toBe('hola\r')
    expect(body('hola\r\r\n')).toBe('hola\r')
    expect(body('a\n\nb\n')).toBe('a\n\nb')
  })

  it('normalizeAddress still drops surrounding angle brackets', () => {
    expect(normalizeAddress('  <<A@B.Test>>  ')).toBe('a@b.test')
    expect(normalizeAddress('a@b.test> ')).toBe('a@b.test')
    expect(normalizeAddress('>>>')).toBe('')
  })
})
