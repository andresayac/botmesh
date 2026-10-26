/**
 * Example "Scheduled daily digest" (docs/examples/daily-digest.md,
 * docs/es/ejemplos/resumen-diario.md). Runs the page's bot.js as written, with a
 * MockProvider (or the terminal simulator) in place of WhatsApp and the clock set just
 * before 08:00 in America/Bogota: the durable task fires at 08:00 Bogota time,
 * broadcasts to subscribed private chats only, records the occurrence per user and is
 * kept in SQLite across a restart without sending twice.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Bot } from '@botmesh/core'
import { MockProvider } from '@botmesh/core/testing'
import { DevSession } from '@botmesh/core/dev'
import { createDocsProject, extractFile, readPage, simulate, transcriptBlock, type DocsProject } from '../../../test-utils/docs-examples.js'
import { SQLiteStore } from '../src/index.js'

/** Monday 2026-03-02, 07:59:57 in America/Bogota (UTC-5, no daylight saving). */
const BEFORE_EIGHT = new Date('2026-03-02T12:59:57Z')

const PAGES = [
  { page: 'docs/examples/daily-digest.md', subscribe: 'subscribe', stop: 'STOP', other: 'hello', digest: '☀️ Your digest for Monday, March 2' },
  { page: 'docs/es/ejemplos/resumen-diario.md', subscribe: 'suscribir', stop: 'BAJA', other: 'hola', digest: '☀️ Tu resumen del lunes, 2 de marzo' },
]

const projects: DocsProject[] = []
afterEach(async () => {
  vi.useRealTimers()
  delete process.env.DB_FILE
  while (projects.length) await projects.pop()!.remove()
})

/** The page's bot.js in a temp project whose DB_FILE points inside it. */
async function load(page: string): Promise<{ project: DocsProject; createBot: (p: MockProvider) => Promise<Bot> | Bot }> {
  const project = await createDocsProject(
    { 'bot.js': extractFile(readPage(page), 'bot.js') },
    { fromSource: ['@botmesh/sqlite-store'], stubs: { '@botmesh/baileys': 'export class BaileysProvider {}' } },
  )
  projects.push(project)
  process.env.DB_FILE = project.path('data/digest.db')
  const mod = await project.import<{ default: (p: MockProvider) => Promise<Bot> | Bot }>('bot.js')
  return { project, createBot: mod.default }
}

/** Fake only `Date`, advancing with real time: the scheduler's real timers still fire. */
function clockAt(at: Date): void {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
  vi.setSystemTime(at)
}

async function until(cond: () => boolean, ms = 8000): Promise<void> {
  for (const end = Date.now() + ms; !cond() && Date.now() < end; ) await new Promise((r) => setTimeout(r, 20))
  expect(cond()).toBe(true)
}

const texts = (provider: MockProvider, chatId: string): string[] =>
  provider.outbox.filter((o) => o.chatId === chatId).map((o) => (o.content.kind === 'text' ? o.content.text : `[${o.content.kind}]`))

describe.each(PAGES)('$page', ({ page, subscribe, stop, other, digest }) => {
  it('prints the sample transcript in the terminal simulator (digest at 08:00 Bogota)', async () => {
    const { project } = await load(page)
    clockAt(BEFORE_EIGHT)
    const out = await simulate(DevSession, () => project.import('bot.js'), [
      subscribe,
      async (output) => {
        // the durable task fires at 08:00:00 local time, three seconds later
        for (let i = 0; i < 400 && !output().includes('☀️'); i++) await new Promise((r) => setTimeout(r, 20))
        await new Promise((r) => setTimeout(r, 100))
      },
      stop,
      other,
    ])
    expect(out).toContain(digest)
    expect(out).toBe(transcriptBlock(readPage(page)))
  }, 20_000)

  it('broadcasts only to subscribed private chats, once per occurrence, across a restart', async () => {
    const { createBot } = await load(page)
    clockAt(BEFORE_EIGHT)
    const provider = new MockProvider()
    const bot = await createBot(provider)
    await bot.start()
    try {
      provider.incoming(subscribe, { from: 'ana' })
      provider.incoming(subscribe, { from: 'beto' })
      provider.incoming(stop, { from: 'beto' })
      provider.incoming(other, { from: 'carla' })
      provider.incoming(subscribe, { from: 'team@g.us', sender: 'ana', isGroup: true })
      await until(() => texts(provider, 'beto').length === 2 && texts(provider, 'carla').length === 1)

      await until(() => texts(provider, 'ana').some((t) => t.startsWith('☀️')))
      await new Promise((r) => setTimeout(r, 200))
      expect(texts(provider, 'ana').filter((t) => t.startsWith(digest))).toHaveLength(1)
      for (const chat of ['beto', 'carla', 'team@g.us']) expect(texts(provider, chat).some((t) => t.startsWith('☀️'))).toBe(false)
      const ana = (await bot.user('ana').get('digest')) as { subscribed: boolean; last: string }
      expect(ana).toEqual({ subscribed: true, last: 'daily-digest@2026-03-02T13:00:00.000Z' })
    } finally {
      await bot.stop()
    }

    // The schedule is in SQLite: a restart keeps tomorrow's slot and does not send again.
    const store = new SQLiteStore({ file: process.env.DB_FILE! })
    await store.start()
    const [record] = await store.schedules().list()
    expect(record).toMatchObject({ spec: 'TZ=America/Bogota 0 8 * * *', nextRunAt: Date.parse('2026-03-03T13:00:00Z') })
    await store.stop()

    const again = new MockProvider()
    const restarted = await createBot(again)
    await restarted.start()
    await new Promise((r) => setTimeout(r, 1500))
    await restarted.stop()
    expect(again.outbox).toHaveLength(0)
  }, 20_000)
})
