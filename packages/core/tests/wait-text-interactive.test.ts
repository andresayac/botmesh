import { describe, it, expect } from 'vitest'
import { createTestBot } from '../src/testing/index.js'

describe('c.ask / c.waitText accept native button and list taps', () => {
  it('a native button tap answers c.ask() with its data, like a typed answer', async () => {
    const { bot, chat } = await createTestBot()
    bot.conversation('pedido', async (c, ctx) => {
      await ctx.buttons('¿Entrega o recogida?', [{ id: 'delivery', title: 'Entrega' }, { id: 'pickup', title: 'Recogida' }])
      const mode = await c.ask('Elige una opción')
      await c.say(`modo=${mode}`)
    }, { trigger: 'pedido' })
    await chat.send('pedido')
    await chat.expectReply('Elige una opción')
    await chat.pressButton('pickup')
    await chat.expectReply('modo=pickup')
    await bot.stop()
  })

  it('a list row tap answers c.waitText() and runs validate on its body', async () => {
    const { bot, chat } = await createTestBot()
    bot.conversation('talla', async (c) => {
      const size = await c.waitText({ validate: (b) => b !== 'xl' || 'agotada' })
      await c.say(`talla=${size}`)
    }, { trigger: 'talla' })
    await chat.send('talla')
    await chat.sendInteraction('xl', { kind: 'list' })
    await chat.expectReply('agotada')
    await chat.sendInteraction('m', { kind: 'list' })
    await chat.expectReply('talla=m')
    await bot.stop()
  })

  it('a button reply that arrives as a message (type buttons, Baileys-style) answers c.ask()', async () => {
    const { bot, chat } = await createTestBot()
    bot.conversation('si', async (c) => {
      const v = await c.ask('¿Confirmas?')
      await c.say(`v=${v}`)
    }, { trigger: 'confirmar' })
    await chat.send('confirmar')
    await chat.expectReply('¿Confirmas?')
    await chat.send('Sí', { type: 'buttons' })
    await chat.expectReply('v=Sí')
    await bot.stop()
  })

  it('a tap with no text still does not satisfy a text wait', async () => {
    const { bot, chat } = await createTestBot()
    let answered = false
    bot.conversation('vacio', async (c) => {
      await c.ask('¿Nombre?')
      answered = true
    }, { trigger: 'vacio' })
    await chat.send('vacio')
    await chat.expectReply('¿Nombre?')
    await chat.send('', { type: 'buttons' })
    await chat.expectReply(/.+/)
    expect(answered).toBe(false)
    await bot.stop()
  })

  it('media still does not satisfy a text wait', async () => {
    const { bot, chat } = await createTestBot()
    let answered = false
    bot.conversation('img', async (c) => { await c.ask('¿Nombre?'); answered = true }, { trigger: 'img' })
    await chat.send('img')
    await chat.expectReply('¿Nombre?')
    await chat.send('', { type: 'sticker' })
    await chat.expectReply(/.+/)
    expect(answered).toBe(false)
    await bot.stop()
  })
})
