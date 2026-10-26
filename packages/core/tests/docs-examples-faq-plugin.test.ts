/**
 * Example "Build a plugin: FAQ with tools" (docs/examples/faq-plugin.md,
 * docs/es/ejemplos/plugin-faq.md). Runs the page's bot.js as written through the
 * terminal simulator and checks the transcript the page shows, then checks what the
 * page promises about unplug: handlers removed, onDispose callbacks run, tool gone.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createDocsProject, extractFile, readPage, simulate, transcriptBlock, type DocsProject } from '../../../test-utils/docs-examples.js'
import { DevSession } from '../src/dev/index.js'
import { MockProvider } from '../src/testing/MockProvider.js'
import { Bot } from '../src/core/Bot.js'
import type { Plugin } from '../src/core/types.js'

async function waitFor(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5))
  expect(cond()).toBe(true)
}

const PAGES = [
  { page: 'docs/examples/faq-plugin.md', lines: ['/faq', 'hours', 'Shipping', 'hours', '/faqstats', '/faqoff', 'hours', '/faqstats'] },
  { page: 'docs/es/ejemplos/plugin-faq.md', lines: ['/faq', 'horario', 'Envíos', 'horario', '/faqstats', '/faqoff', 'horario', '/faqstats'] },
]

const projects: DocsProject[] = []
afterEach(async () => {
  while (projects.length) await projects.pop()!.remove()
})

async function load(page: string): Promise<DocsProject> {
  const project = await createDocsProject(
    { 'bot.js': extractFile(readPage(page), 'bot.js') },
    { fromSource: ['@botmesh/core'], stubs: { '@botmesh/baileys': 'export class BaileysProvider {}' } },
  )
  projects.push(project)
  return project
}

describe.each(PAGES)('$page', ({ page, lines }) => {
  it('prints the sample transcript in the terminal simulator', async () => {
    const project = await load(page)
    const out = await simulate(DevSession, () => project.import('bot.js'), lines)
    expect(out).toBe(transcriptBlock(readPage(page)))
  })

  it('unplug removes the handlers, runs uninstall and onDispose, and drops the tool', async () => {
    const project = await load(page)
    const { faqPlugin } = await project.import<{ faqPlugin: Plugin }>('bot.js')
    const info: string[] = []
    const logger = { info: (o: unknown, m?: string) => info.push(m ?? String(o)), warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child: () => logger }
    const provider = new MockProvider()
    const bot = new Bot({ provider, logger: logger as never })
    await bot.start()
    try {
      const unplug = bot.plug(faqPlugin, { answers: { a: 'A' }, reportEvery: 10 })
      expect(Object.keys(bot.injectTools)).toContain('faq')
      provider.incoming('a')
      await waitFor(() => provider.outbox.length === 1)
      expect(provider.outbox[0]!.content).toEqual({ kind: 'text', text: 'A' })
      await waitFor(() => info.includes('faq stats'))

      unplug()
      expect(info).toContain('faq plugin removed')
      expect(Object.keys(bot.injectTools)).not.toContain('faq')
      provider.incoming('a')
      await new Promise((r) => setTimeout(r, 50))
      expect(provider.outbox).toHaveLength(1) // the trigger is gone
      const logged = info.length
      await new Promise((r) => setTimeout(r, 40))
      expect(info.length).toBe(logged) // onDispose stopped the timer
    } finally {
      await bot.stop()
    }
  })
})
