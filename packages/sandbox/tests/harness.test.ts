import { describe, expect, it } from 'vitest'
import { CloudAPIProvider } from '@botmesh/meta'
import { WhatsAppSimulator, startHarness } from '../src/index.js'
import { silent } from './_bot.js'

describe('startHarness cleans up after a partial failure', () => {
  it('stops the simulator it started when the provider cannot be built', async () => {
    const sim = new WhatsAppSimulator()
    await expect(startHarness(sim, () => { throw new Error('bad config') }, () => {})).rejects.toThrow('bad config')
    expect(sim.started).toBe(false)
  })

  it('closes the webhook ingress and stops the simulator when setup throws', async () => {
    const sim = new WhatsAppSimulator()
    await expect(startHarness(sim, (s) => new CloudAPIProvider({ ...s.providerConfig(), logger: silent }), () => { throw new Error('setup failed') }, { bot: { logger: silent } }))
      .rejects.toThrow('setup failed')
    expect(sim.started).toBe(false)
    const webhook = sim.webhook!
    expect(webhook).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/webhook\/whatsapp$/)
    await expect(fetch(webhook, { method: 'POST', body: '{}' })).rejects.toThrow()
  })

  it('leaves a simulator the caller started running', async () => {
    const sim = await new WhatsAppSimulator().start()
    try {
      await expect(startHarness(sim, () => { throw new Error('bad config') }, () => {})).rejects.toThrow('bad config')
      expect(sim.started).toBe(true)
    } finally {
      await sim.stop()
    }
  })
})
