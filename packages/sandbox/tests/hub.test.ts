import { afterEach, describe, expect, it } from 'vitest'
import pino from 'pino'
import { startSandbox, type RunningSandbox } from '../src/index.js'
import { CHANNELS } from '../src/providers.js'

let sandbox: RunningSandbox | undefined
afterEach(async () => { await sandbox?.stop(); sandbox = undefined })
const logger = pino({ level: 'silent' })

describe('startSandbox (UI server + every channel)', () => {
  it('starts all nine channels with the demo bot and serves the UI and its API', async () => {
    sandbox = await startSandbox({ port: 0, logger, autoStatus: false })
    const html = await (await fetch(sandbox.url)).text()
    expect(html).toContain('<title>botmesh sandbox</title>')
    const channels = await (await fetch(`${sandbox.url}/api/channels`)).json() as Array<{ channel: string; ready: string }>
    expect(channels.map((c) => c.channel)).toEqual([...CHANNELS])
    for (const channel of CHANNELS) {
      const res = await fetch(`${sandbox.url}/api/${channel}/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'hola' }) })
      expect(res.status, channel).toBe(200)
      const reply = await sandbox.sims[channel]!.waitForOutbound((r) => r.kind === 'buttons' || (r.text ?? '').includes('Hola'), 8_000)
      expect(reply.text ?? '', channel).toContain('panadería de prueba')
      expect(sandbox.sims[channel]!.issues(), channel).toEqual([])
    }
  }, 60_000)

  it('the AI fallback answers free text with the scripted model', async () => {
    sandbox = await startSandbox({ port: 0, logger, channels: ['telegram'], autoStatus: false })
    await sandbox.sims.telegram!.sendText('quiero algo dulce')
    expect((await sandbox.sims.telegram!.waitForOutbound((r) => r.kind === 'text')).text).toContain('IA simulada')
  })

  it('accepts media and locations from the UI API and serves media back', async () => {
    sandbox = await startSandbox({ port: 0, logger, channels: ['whatsapp'], autoStatus: false })
    const post = (body: unknown) => fetch(`${sandbox!.url}/api/whatsapp/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    await post({ media: { kind: 'image', base64: Buffer.from('fake-jpeg').toString('base64'), mimetype: 'image/jpeg', filename: 'a.jpg' } })
    expect((await sandbox.sims.whatsapp!.waitForOutbound((r) => r.text?.startsWith('📎') === true)).text).toContain('image')
    await post({ location: { latitude: 4.6, longitude: -74.08, name: 'Parque' } })
    expect((await sandbox.sims.whatsapp!.waitForOutbound((r) => r.text?.startsWith('📍') === true)).text).toContain('4.6, -74.08')
    const timeline = await (await fetch(`${sandbox.url}/api/whatsapp/timeline`)).json() as { inbox: unknown[]; outbox: unknown[] }
    expect(timeline.inbox.length).toBeGreaterThanOrEqual(2)
    const media = sandbox.sims.whatsapp!.media.list('user')[0]!
    expect(await (await fetch(`${sandbox.url}/api/whatsapp/media/${media.id}`)).text()).toBe('fake-jpeg')
  })

  it('runs the bakery example with its scripted AI', async () => {
    sandbox = await startSandbox({ port: 0, logger, channels: ['whatsapp'], bot: 'bakery', autoStatus: false })
    await sandbox.sims.whatsapp!.sendText('show me the menu')
    const reply = await sandbox.sims.whatsapp!.waitForOutbound((r) => r.kind === 'text' && /croissant/i.test(r.text ?? ''), 8_000)
    expect(reply.text).toMatch(/croissant/i)
  })
})
