import { describe, it, expect } from 'vitest'
import { createTestBot } from '../src/testing/createTestBot.js'
import type { PluginSpec } from '../src/core/types.js'

const plugin = (name: string, over: Partial<PluginSpec> = {}): PluginSpec => ({
  name,
  version: '1.0.0',
  install() {},
  ...over,
})

describe('plugins: one instance per name', () => {
  it('refuses a second plug of the same plugin name with a clear error, before install() runs', async () => {
    const { bot } = await createTestBot()
    let installs = 0
    bot.plug(plugin('crm', { install() { installs++ } }))
    expect(() => bot.plug(plugin('crm', { install() { installs++ } }))).toThrow(
      /Plugin "crm" is already plugged.*PluginSpec\.multiple/,
    )
    expect(installs).toBe(1)
    await bot.stop()
  })

  it('applies to the same spec object plugged twice and to use(plugin)', async () => {
    const { bot } = await createTestBot()
    const spec = plugin('stats')
    bot.use(spec)
    expect(() => bot.plug(spec)).toThrow(/already plugged/)
    expect(() => bot.use(spec)).toThrow(/already plugged/)
    await bot.stop()
  })

  it('allows plugging the name again once the first instance is unplugged', async () => {
    const { bot } = await createTestBot()
    const unplug = bot.plug(plugin('crm'))
    unplug()
    expect(() => bot.plug(plugin('crm'))).not.toThrow()
    await bot.stop()
  })

  it('a failed install does not leave the name taken', async () => {
    const { bot } = await createTestBot()
    expect(() => bot.plug(plugin('flaky', { install() { throw new Error('boom') } }))).toThrow('boom')
    expect(() => bot.plug(plugin('flaky'))).not.toThrow()
    await bot.stop()
  })

  it('PluginSpec.multiple: true allows several instances (each unplugged on its own)', async () => {
    const { bot } = await createTestBot()
    const seen: string[] = []
    const make = (tag: string) => plugin('webhook', { multiple: true, install() { seen.push(tag) } })
    const unA = bot.plug(make('a'))
    bot.plug(make('b'))
    expect(seen).toEqual(['a', 'b'])
    unA()
    // The other instance still satisfies `requires`.
    expect(() => bot.plug(plugin('needs-webhook', { requires: ['webhook'] }))).not.toThrow()
    await bot.stop()
  })

  it('every instance must opt in: a plugin without multiple cannot join one that has it', async () => {
    const { bot } = await createTestBot()
    bot.plug(plugin('webhook', { multiple: true }))
    expect(() => bot.plug(plugin('webhook'))).toThrow(/already plugged/)
    await bot.stop()
  })
})
