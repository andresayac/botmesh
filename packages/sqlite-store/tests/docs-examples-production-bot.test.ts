/**
 * Example "Production-ready bot" (docs/examples/production-bot.md,
 * docs/es/ejemplos/bot-produccion.md). Runs the page's src/bot.js as written with a
 * MockProvider (or the terminal simulator) in place of WhatsApp: the persistent flow
 * survives a fresh bot on the same SQLite file, durability is on, the health server
 * answers /healthz, /readyz and /metrics, and the graceful shutdown drains, stops the
 * bot and closes the server once. The project files around it (package.json,
 * Dockerfile, compose) are checked for the paths and ports the code uses.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Bot } from '@botmesh/core'
import { MockProvider } from '@botmesh/core/testing'
import { DevSession } from '@botmesh/core/dev'
import { createDocsProject, extractFile, readPage, simulate, transcriptBlock, type DocsProject } from '../../../test-utils/docs-examples.js'

const PAGES = [
  { page: 'docs/examples/production-bot.md', lines: ['hi', 'ticket', 'The app crashes on login', ':reset', 'ana@example.com', '/ping'] },
  { page: 'docs/es/ejemplos/bot-produccion.md', lines: ['hola', 'ticket', 'La app se cierra al entrar', ':reset', 'ana@example.com', '/ping'] },
]

interface BotModule {
  default: (p: MockProvider) => Promise<Bot> | Bot
  startHealthServer: (bot: Bot, port?: number) => Promise<Server>
  gracefulShutdown: (bot: Bot, server: Server) => (signal: string) => Promise<void>
}

const projects: DocsProject[] = []
afterEach(async () => {
  delete process.env.DB_FILE
  delete process.env.LOG_LEVEL
  while (projects.length) await projects.pop()!.remove()
})

async function load(page: string): Promise<{ project: DocsProject; mod: BotModule }> {
  const project = await createDocsProject(
    { 'src/bot.js': extractFile(readPage(page), 'src/bot.js') },
    {
      fromSource: ['@botmesh/sqlite-store'],
      stubs: { '@botmesh/baileys': 'export class BaileysProvider {}' },
    },
  )
  projects.push(project)
  process.env.DB_FILE = project.path('data/bot.db')
  process.env.LOG_LEVEL = 'silent'
  return { project, mod: await project.import<BotModule>('src/bot.js') }
}

describe.each(PAGES)('$page', ({ page, lines }) => {
  it('prints the sample transcript: the persistent flow survives a fresh bot', async () => {
    const { project } = await load(page)
    const out = await simulate(DevSession, () => project.import('src/bot.js'), lines)
    expect(out).toBe(transcriptBlock(readPage(page)))
  })

  it('serves health, readiness and metrics, and shuts down gracefully once', async () => {
    const { mod } = await load(page)
    const provider = new MockProvider()
    const bot = await mod.default(provider)
    expect(bot.durability, 'durability is on').toBeDefined()
    await bot.start()
    const server = await mod.startHealthServer(bot, 0)
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const get = async (path: string) => {
      const res = await fetch(base + path)
      return { status: res.status, type: res.headers.get('content-type'), body: await res.text() }
    }

    expect(await get('/healthz')).toMatchObject({ status: 200, body: 'ok' })
    expect(await get('/readyz')).toMatchObject({ status: 200, body: 'ready' })
    provider.incoming(lines[0]!)
    for (let i = 0; i < 100 && provider.outbox.length === 0; i++) await new Promise((r) => setTimeout(r, 10))
    const metrics = await get('/metrics')
    expect(metrics.status).toBe(200)
    expect(metrics.type).toContain('text/plain')
    expect(metrics.body).toMatch(/^botmesh_\w+/m)
    expect((await get('/nope')).status).toBe(404)

    const shutdown = mod.gracefulShutdown(bot, server)
    const first = shutdown('SIGTERM')
    expect(shutdown('SIGINT')).toBe(first) // a second signal waits for the same shutdown
    await first
    expect(bot.getConnectionState()).toBe('closed')
    expect(server.listening).toBe(false)
  })

  it('ships a project layout that matches the code', () => {
    const md = readPage(page)
    const pkg = JSON.parse(/```json\n([\s\S]*?)```/.exec(md)![1]!) as { type: string; scripts: Record<string, string> }
    expect(pkg.type).toBe('module')
    expect(pkg.scripts.start).toContain('src/bot.js')
    expect(pkg.scripts.dev).toBe('botmesh dev src/bot.js')

    const install = /```bash\n(npm install [^\n]+)\n/.exec(md)![1]!
    const imports = [...extractFile(md, 'src/bot.js').matchAll(/from '([^'.][^']*)'/g)].map((m) => m[1]!).filter((s) => !s.startsWith('node:'))
    for (const dep of new Set([...imports, 'better-sqlite3'])) expect(install.split(' '), `npm install lists ${dep}`).toContain(dep)

    const dockerfile = extractFile(md, 'Dockerfile')
    expect(dockerfile).toContain('CMD ["node", "src/bot.js"]')
    expect(dockerfile).toContain('127.0.0.1:9464/healthz')
    const compose = extractFile(md, 'docker-compose.yml')
    expect(compose).toContain('DB_FILE: /app/data/bot.db')
    expect(compose).toMatch(/stop_grace_period: \d+s/)
    expect(extractFile(md, '.dockerignore')).toMatch(/sessions[\s\S]*data[\s\S]*\.env/)
  })
})
