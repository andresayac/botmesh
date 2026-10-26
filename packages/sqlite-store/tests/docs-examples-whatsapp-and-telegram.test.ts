/**
 * The "WhatsApp and Telegram at once" example (docs/examples/whatsapp-and-telegram.md,
 * docs/es/ejemplos/whatsapp-y-telegram.md) runs as written: its bot.js block, with the
 * real transports left out, replays the page's simulator transcript on a real SQLite
 * file. Then the factory builds two bots, as the page's start block does, on mock
 * providers that carry the Baileys and Telegram provider ids and their id formats: the
 * ids table on the page is what `whoami` prints, the two bots share the database file
 * without seeing each other's profiles, and a restart keeps both.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DevSession } from '@botmesh/core/dev'
import { MockProvider } from '@botmesh/core/testing'
import type { Bot, BotFactory } from '@botmesh/core'
import { exampleModuleSource, exampleTranscripts, exampleWorkspace, replayTranscript } from '../../../test-utils/docs-example-sim.js'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const require = createRequire(import.meta.url)
const core = pathToFileURL(require.resolve('@botmesh/core')).href
const store = pathToFileURL(fileURLToPath(new URL('../src/index.ts', import.meta.url))).href

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!()
})

/** A MockProvider that reports another provider id (the bot's default storage namespace). */
function mockAs(id: string): MockProvider {
  const provider = new MockProvider()
  Object.defineProperty(provider, 'id', { value: id })
  return provider
}

const WA_USER = '573001234567@s.whatsapp.net'
const WA_GROUP = '120363025555555555@g.us'
const TG_USER = '123456789'
const TG_GROUP = '-1001234567890'

/** Send `text` and resolve with the bot's replies to that chat once it goes quiet. */
async function say(p: MockProvider, text: string, from: string, sender = from): Promise<string> {
  const before = p.outbox.length
  p.incoming(text, { from, sender, isGroup: from !== sender })
  for (let i = 0; i < 200 && p.outbox.length === before; i++) await new Promise((r) => setTimeout(r, 5))
  for (let seen = -1; seen !== p.outbox.length; ) {
    seen = p.outbox.length
    await new Promise((r) => setTimeout(r, 40))
  }
  return p.outbox.slice(before).map((o) => (o.content.kind === 'text' ? o.content.text : `[${o.content.kind}]`)).join('\n')
}

describe.each([
  { page: 'docs/examples/whatsapp-and-telegram.md', whoami: 'whoami', signup: 'signup', dm: 'DM', group: 'group', user: 'user', noName: 'no name yet', visit: 'visit' },
  { page: 'docs/es/ejemplos/whatsapp-y-telegram.md', whoami: 'quien soy', signup: 'registro', dm: 'privado', group: 'grupo', user: 'usuario', noName: 'sin nombre', visit: 'visita' },
])('$page runs as documented', (p) => {
  async function load(): Promise<{ md: string; url: string; dir: string }> {
    const md = await readFile(join(root, p.page), 'utf8')
    const ws = await exampleWorkspace()
    cleanup.push(ws.dispose)
    const url = await ws.write('bot.ts', exampleModuleSource(md, p.page, {
      imports: { '@botmesh/core': core, '@botmesh/sqlite-store': store, '@botmesh/baileys': null, '@botmesh/telegram': null },
      replace: [["'./bot.db'", JSON.stringify(join(ws.dir, 'bot.db'))]],
    }))
    return { md, url, dir: ws.dir }
  }

  it('replays the transcript on the page', async () => {
    const { md, url } = await load()
    const transcripts = exampleTranscripts(md)
    expect(transcripts).toHaveLength(1)
    const { expected, actual } = await replayTranscript(DevSession, url, transcripts[0]!)
    expect(actual).toBe(expected)
  }, 30_000)

  it('runs two bots from the factory on one database, with the ids the page shows', async () => {
    const { md, url } = await load()
    const page = md.replace(/\r\n/g, '\n')
    // The start block builds both bots from the same factory, on Baileys and Telegram.
    expect(page).toContain('const whatsapp = await createBot(new BaileysProvider(')
    expect(page).toContain('const telegram = await createBot(new TelegramProvider(')
    const createBot = (await import(url)).default as BotFactory

    const boot = async () => {
      const wa = mockAs('baileys')
      const tg = mockAs('telegram')
      const bots = [await createBot(wa), await createBot(tg)] as Bot[]
      await Promise.all(bots.map((b) => b.start()))
      return { wa, tg, stop: () => Promise.all(bots.map((b) => b.stop())) }
    }

    let run = await boot()
    try {
      // The ids table: what whoami prints for the same person on each channel.
      const rows = [
        { provider: run.wa, channel: 'WhatsApp (`baileys`)', id: 'baileys', where: p.dm, from: WA_USER, sender: WA_USER },
        { provider: run.wa, channel: 'WhatsApp (`baileys`)', id: 'baileys', where: p.group, from: WA_GROUP, sender: WA_USER },
        { provider: run.tg, channel: 'Telegram (`telegram`)', id: 'telegram', where: p.dm, from: TG_USER, sender: TG_USER },
        { provider: run.tg, channel: 'Telegram (`telegram`)', id: 'telegram', where: p.group, from: TG_GROUP, sender: TG_USER },
      ]
      for (const r of rows) {
        expect(page).toContain(`| ${r.channel} | ${r.where} | \`${r.from}\` | \`${r.sender}\` |`)
        expect(await say(r.provider, p.whoami, r.from, r.sender)).toContain(`📡 ${r.id} · chat ${r.from} · ${p.user} ${r.sender}`)
      }

      // A name saved on WhatsApp stays on WhatsApp: the bots share the file, not the profiles.
      await say(run.wa, p.signup, WA_USER)
      await say(run.wa, 'Ana', WA_USER)
      expect(await say(run.wa, p.whoami, WA_USER)).toContain(`👤 Ana · ${p.visit} 3`)
      expect(await say(run.tg, p.whoami, TG_USER)).toContain(`👤 ${p.noName} · ${p.visit} 3`)
    } finally {
      await run.stop()
    }

    // A restart (new bots, new store instances, same file) keeps both profiles.
    run = await boot()
    try {
      expect(await say(run.wa, p.whoami, WA_USER)).toContain(`👤 Ana · ${p.visit} 4`)
      expect(await say(run.tg, p.whoami, TG_USER)).toContain(`👤 ${p.noName} · ${p.visit} 4`)
    } finally {
      await run.stop()
    }
  }, 30_000)
})
