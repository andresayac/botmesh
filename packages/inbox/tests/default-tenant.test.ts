/** attachInbox without a tenantId files conversations under the BOT's tenant (BotConfig.tenantId). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestBot, type TestBot } from '@botmesh/core/testing'
import { Inbox, attachInbox } from '../src/index.js'

let t: TestBot | undefined
afterEach(async () => { await t?.bot.stop(); t = undefined })

describe('attachInbox default tenant', () => {
  it("uses the bot's own tenant, not 'local', when tenantId is omitted", async () => {
    t = await createTestBot({ tenantId: 'acme' })
    const inbox = new Inbox()
    attachInbox(t.bot, inbox)
    await t.chat.send('hola')
    await vi.waitFor(async () => { expect(await inbox.get('acme', t!.chat.chatId)).toBeDefined() })
    expect(await inbox.list('local')).toEqual([])
  })

  it("stays 'local' for a bot without a tenant", async () => {
    t = await createTestBot()
    const inbox = new Inbox()
    attachInbox(t.bot, inbox)
    await t.chat.send('hola')
    await vi.waitFor(async () => { expect(await inbox.get('local', t!.chat.chatId)).toBeDefined() })
  })
})
