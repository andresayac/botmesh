/**
 * The beginner examples of the docs (docs/examples/*, docs/es/ejemplos/*) are the showcase a
 * visitor copies. Each page's complete `bot.js` runs in the terminal simulator with the
 * inputs of its "Sample transcript", and the simulator output must be exactly the transcript
 * printed on the page, in English and in Spanish.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MockProvider } from '../src/testing/MockProvider.js'
import { cleanupDocsExamples, loadPageFactory, readPage, runPageTranscript, type RunOptions } from './support/docsExample.js'

afterEach(cleanupDocsExamples)

interface ExamplePage extends RunOptions {
  en: string
  es: string
}

const EXAMPLES: Record<string, ExamplePage> = {
  'greeting bot': { en: 'docs/examples/greeting-bot.md', es: 'docs/es/ejemplos/bot-saludo.md', name: 'Ana' },
  'FAQ bot': { en: 'docs/examples/faq-bot.md', es: 'docs/es/ejemplos/bot-faq.md' },
  'menu bot': { en: 'docs/examples/menu-bot.md', es: 'docs/es/ejemplos/bot-menu.md' },
  'poll bot': { en: 'docs/examples/poll-bot.md', es: 'docs/es/ejemplos/bot-encuesta.md' },
  messages: { en: 'docs/examples/messages.md', es: 'docs/es/ejemplos/mensajes.md', name: 'Ana' },
  'media replies': { en: 'docs/examples/media.md', es: 'docs/es/ejemplos/media.md' },
  'registration flow': { en: 'docs/examples/registration-flow.md', es: 'docs/es/ejemplos/flujo-registro.md' },
  'shopping flow': { en: 'docs/examples/shopping-flow.md', es: 'docs/es/ejemplos/flujo-compra.md' },
  'support flow': { en: 'docs/examples/support-flow.md', es: 'docs/es/ejemplos/flujo-soporte.md' },
  'rate limiter plugin': { en: 'docs/examples/rate-limiter.md', es: 'docs/es/ejemplos/rate-limiter.md' },
  'reminder bot': {
    en: 'docs/examples/reminders.md',
    es: 'docs/es/ejemplos/recordatorios.md',
    // The transcript shows the 2-second reminder arriving before the next input.
    afterInput: async (_input, index) => {
      if (index === 0) await new Promise((r) => setTimeout(r, 2300))
    },
  },
}

describe.each(Object.entries(EXAMPLES))('%s example', (_name, example) => {
  it.each([example.en, example.es])('%s prints its sample transcript in the simulator', async (page) => {
    const { actual, expected } = await runPageTranscript(page, example)
    expect(actual).toBe(expected)
  }, 30_000)
})

describe.each(Object.entries(EXAMPLES))('%s page follows the example standard', (_name, example) => {
  it.each([
    { page: example.en, level: /^\*\*Level:\*\* (Beginner|Intermediate|Advanced) · \*\*Tags:\*\* \S/m, features: /^\*\*Features shown:\*\* /m, guide: '](/guide/', index: 'docs/examples/index.md' },
    { page: example.es, level: /^\*\*Nivel:\*\* (Principiante|Intermedio|Avanzado) · \*\*Etiquetas:\*\* \S/m, features: /^\*\*Funciones que muestra:\*\* /m, guide: '](/es/guide/', index: 'docs/es/ejemplos/index.md' },
  ])('$page has a level, tags, linked features and an entry in the index', async ({ page, level, features, guide, index }) => {
    const md = await readPage(page)
    expect(md).toMatch(level)
    const shown = md.slice(md.search(features)).split('\n\n')[0]!
    expect(shown.split(guide).length - 1, 'features link to their guide').toBeGreaterThanOrEqual(2)
    expect(md, 'one complete bot.js').toMatch(/```js\n\/\/ bot\.js\n/)
    expect((md.match(/```js\n\/\/ bot\.js\n/g) ?? []).length).toBe(1)
    const slug = page.split('/').pop()!.replace(/\.md$/, '')
    expect(await readPage(index), `${index} lists ${slug}`).toContain(`](./${slug})`)
  })
})

describe('support flow timeout', () => {
  afterEach(() => { vi.useRealTimers() })

  it.each([EXAMPLES['support flow']!.en, EXAMPLES['support flow']!.es])('%s answers the timeout message the page promises after 2 minutes', async (page) => {
    const md = await readPage(page)
    // The sentence under the transcript quotes the timeout reply.
    const promised = /`(⏰[^`]+)`/.exec(md.slice(md.indexOf('```text')))?.[1]
    expect(promised, 'the page quotes the timeout reply').toBeTruthy()
    const createBot = await loadPageFactory(page)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    const provider = new MockProvider()
    const bot = await createBot(provider)
    await bot.start()
    try {
      provider.incoming(/user › (\S+)/.exec(md.slice(md.indexOf('```text')))![1]!)
      await vi.advanceTimersByTimeAsync(500)
      expect(provider.outbox).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(2 * 60_000)
      const last = provider.outbox.at(-1)!.content
      expect(last).toEqual({ kind: 'text', text: promised })
    } finally {
      await bot.stop()
    }
  })
})

describe('reminder bot daily tip', () => {
  afterEach(() => { vi.useRealTimers() })

  it.each([EXAMPLES['reminder bot']!.en, EXAMPLES['reminder bot']!.es])('%s sends the tip at 9:00 Bogota time to subscribers only', async (page) => {
    const createBot = await loadPageFactory(page)
    // 08:59:58 in Bogota (UTC-5, no daylight saving).
    vi.useFakeTimers({ now: new Date('2026-03-02T13:59:58Z'), toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    const provider = new MockProvider()
    const bot = await createBot(provider)
    await bot.start()
    try {
      const subscribe = /```text\n[\s\S]*?user › (daily on|tip diario)\n/.exec(await readPage(page))?.[1]
      expect(subscribe, 'the transcript subscribes').toBeTruthy()
      provider.incoming(subscribe!, { from: 'ana@s.whatsapp.net' })
      provider.incoming('hi', { from: 'beto@s.whatsapp.net' })
      await vi.advanceTimersByTimeAsync(500)
      const before = provider.outbox.length
      await vi.advanceTimersByTimeAsync(3000)
      const tips = provider.outbox.slice(before)
      expect(tips).toHaveLength(1)
      expect(tips[0]!.chatId).toBe('ana@s.whatsapp.net')
      expect(tips[0]!.content).toMatchObject({ kind: 'text', text: expect.stringContaining('☀️') })
    } finally {
      await bot.stop()
    }
  })
})

describe('media replies example beyond the simulator', () => {
  const pages = [
    { page: EXAMPLES['media replies']!.en, location: '📍 You are at 4.6, -74.08', tooLarge: 'That image is too large (5 MB max).' },
    { page: EXAMPLES['media replies']!.es, location: '📍 Estás en 4.6, -74.08', tooLarge: 'Esa imagen es demasiado grande (máximo 5 MB).' },
  ]

  it.each(pages)('$page answers a shared location and refuses an image over 5 MB', async ({ page, location, tooLarge }) => {
    const createBot = await loadPageFactory(page)
    const provider = new MockProvider()
    const bot = await createBot(provider)
    const errors: unknown[] = []
    bot.on('error', (e: unknown) => { errors.push(e) })
    await bot.start()
    try {
      provider.incomingLocation({ latitude: 4.6, longitude: -74.08 })
      await vi.waitFor(() => expect(provider.outbox).toHaveLength(1))
      expect(provider.outbox[0]!.content).toEqual({ kind: 'text', text: location })

      // The size the provider declares is checked before downloading anything.
      provider.incomingMedia('image', { url: 'https://example.com/huge.jpg' }, { size: 6 * 1024 * 1024 })
      await vi.waitFor(() => expect(provider.outbox).toHaveLength(2))
      expect(provider.outbox[1]!.content).toEqual({ kind: 'text', text: tooLarge })
      expect(errors).toEqual([])
    } finally {
      await bot.stop()
    }
  })
})
