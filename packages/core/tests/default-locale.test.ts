/**
 * Stable default: the built-in texts are English unless the bot picks another language
 * (`BotConfig.lang: 'es'` keeps the old Spanish texts without turning on language
 * resolution; `i18n.defaultLocale` does the same with resolution on).
 */
import { describe, it, expect } from 'vitest'

import { Bot, CORE_MESSAGES, flow } from '../src/index.js'
import { I18n } from '../src/spi.js'
import type { FormDefinition } from '../src/forms/types.js'
import { createTestBot } from '../src/testing/index.js'
import { MockProvider } from '../src/testing/MockProvider.js'

describe('default locale', () => {
  it('a bare registry defaults to English', () => {
    const i18n = new I18n()
    expect(i18n.defaultLocale).toBe('en')
    expect(i18n.translate(undefined, CORE_MESSAGES.retries)).toBe('❌ Too many attempts. Conversation ended.')
  })

  it('an unknown locale falls back to the English built-ins', () => {
    const i18n = new I18n()
    expect(i18n.translate('fr', CORE_MESSAGES.formSkipWord)).toBe('skip')
  })

  it('a bot without language options answers built-ins in English', async () => {
    const { bot, chat } = await createTestBot()
    bot.registerFlow(flow('ask').ask('Name?', 'name', { validate: () => 'nope', maxAttempts: 1 }))
    await chat.send('ask')
    await chat.expectReply('Name?')
    await chat.send('x')
    await chat.expectReply('❌ Too many attempts. Conversation ended.')
    await bot.stop()
  })

  it('degraded forms skip optional fields with "skip" by default', async () => {
    const { bot, chat } = await createTestBot()
    const form: FormDefinition = { id: 'f', fields: [{ type: 'text', name: 'nick', label: 'Nick', required: false }] }
    bot.registerFlow(flow('form').form(form, { mode: 'degraded' }).say((_ctx, c) => `nick=${String((c.state.f as { nick?: string }).nick)}`))
    await chat.send('form')
    await chat.expectReply(/type "skip" to skip/)
    await chat.send('skip')
    await chat.expectReply('nick=undefined')
    await bot.stop()
  })

  it("lang: 'es' restores the Spanish built-ins without enabling resolution", async () => {
    const { bot, chat } = await createTestBot({ lang: 'es' })
    const i18n = (bot as unknown as { i18n: I18n }).i18n
    expect(i18n.defaultLocale).toBe('es')
    expect(i18n.enabled).toBe(false)
    bot.registerFlow(flow('ask').ask('¿Nombre?', 'name', { validate: () => 'no', maxAttempts: 1 }))
    await chat.send('ask')
    await chat.expectReply('¿Nombre?')
    await chat.send('x')
    await chat.expectReply('❌ Demasiados intentos. Conversación terminada.')
    await bot.stop()
  })

  it("i18n.defaultLocale: 'es' also gives the Spanish built-ins", async () => {
    const provider = new MockProvider()
    const bot = new Bot({ provider, i18n: { defaultLocale: 'es' } })
    expect(bot.t(CORE_MESSAGES.commandsReset)).toBe('✅ Conversación reiniciada.')
  })

  it('rejects an invalid lang', () => {
    expect(() => new Bot({ provider: new MockProvider(), lang: '' })).toThrow(/lang/)
  })

  it('lang and i18n.defaultLocale of the same language (es / es-MX) are accepted; the more specific tag wins', () => {
    const defaultOf = (bot: Bot) => (bot as unknown as { i18n: I18n }).i18n.defaultLocale.toLowerCase()
    expect(defaultOf(new Bot({ provider: new MockProvider(), lang: 'es', i18n: { defaultLocale: 'es-MX' } }))).toBe('es-mx')
    expect(defaultOf(new Bot({ provider: new MockProvider(), lang: 'es-MX', i18n: { defaultLocale: 'es' } }))).toBe('es-mx')
    expect(defaultOf(new Bot({ provider: new MockProvider(), lang: 'pt_BR', i18n: { defaultLocale: 'pt-BR' } }))).toBe('pt-br')
  })

  it('lang and i18n.defaultLocale of different languages (or regions) still throw', () => {
    expect(() => new Bot({ provider: new MockProvider(), lang: 'en', i18n: { defaultLocale: 'es-MX' } })).toThrow(/lang/)
    expect(() => new Bot({ provider: new MockProvider(), lang: 'es-AR', i18n: { defaultLocale: 'es-MX' } })).toThrow(/lang/)
  })
})
