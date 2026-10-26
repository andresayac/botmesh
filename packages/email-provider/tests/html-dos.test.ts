import { describe, expect, it } from 'vitest'
import { htmlToText } from '../src/html.js'
import { EmailProvider } from '../src/EmailProvider.js'
import { parseAddressList } from '../src/address.js'

/** Wall-clock time of `fn` in ms. */
function timed(fn: () => void): number {
  const start = performance.now()
  fn()
  return performance.now() - start
}

// A 300 KB HTML-only email used to block the event loop for ~30 s: every `<`
// with no later `>` made the tag regexes rescan the rest of the body.
describe('htmlToText — linear time on hostile HTML', () => {
  const N = 300_000
  const cases: Array<[string, string]> = [
    ['unclosed `<`', '<'.repeat(N)],
    ['unclosed anchors', '<a href=x>'.repeat(N / 10)],
    ['unclosed raw-text elements', '<script>'.repeat(N / 8)],
    ['unclosed comments', '<!--'.repeat(N / 4)],
    ['`<` inside a link label', `<a href="https://x.test">${'<'.repeat(N)}</a>`],
    ['open tags with no `>`', '<p '.repeat(N / 3)],
  ]
  for (const [name, html] of cases) {
    it(`${name} (${Math.round(html.length / 1000)} KB) converts in well under a second`, () => {
      expect(timed(() => htmlToText(html))).toBeLessThan(1000)
    })
  }

  it('an HTML-only email full of `<` is ingested quickly', async () => {
    const provider = new EmailProvider({ address: 'bot@acme.test', loopProtection: false })
    const raw = `From: a@b.test\r\nTo: bot@acme.test\r\nSubject: x\r\nMessage-ID: <dos@b.test>\r\nContent-Type: text/html\r\n\r\n${'<'.repeat(N)}`
    const start = performance.now()
    expect((await provider.ingest(raw)).accepted).toBe(true)
    expect(performance.now() - start).toBeLessThan(1500)
  })
})

describe('htmlToText — behaviour kept by the linear scanner', () => {
  it('drops styles and comments inside a link label', () => {
    expect(htmlToText('<a href="https://acme.test/x"><style>.x{}</style><!-- c -->Ver <b>pedido</b></a>')).toBe('Ver pedido (https://acme.test/x)')
  })

  it('keeps unterminated markup as text and drops unclosed comments up to the next `>`', () => {
    expect(htmlToText('5 < 10')).toBe('5 < 10')
    expect(htmlToText('a <> b')).toBe('a <> b')
    expect(htmlToText('<p>a</p><!-- open <br> b')).toBe('a\nb')
    expect(htmlToText('<script>never closed<p>x</p>')).toBe('never closed\nx')
  })
})

describe('parseAddressList — linear time on hostile headers', () => {
  const N = 300_000
  for (const [name, value] of [
    ['unclosed comments', '('.repeat(N)],
    ['unclosed comments before an address', `${'('.repeat(N)}a@b.test`],
    ['many open comments in a display name', `${'x ( '.repeat(N / 4)}<a@b.test>`],
  ] as const) {
    it(`${name} parse in well under a second`, () => {
      expect(timed(() => parseAddressList(value))).toBeLessThan(1000)
    })
  }

  it('still drops RFC 5322 comments', () => {
    expect(parseAddressList('Ana (soporte) <ana@x.test>, (c) bob@y.test (home)')).toEqual([
      { name: 'Ana', address: 'ana@x.test' },
      { name: undefined, address: 'bob@y.test' },
    ])
  })
})
