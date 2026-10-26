/**
 * The handlers every channel end-to-end test registers, plus a recorder of
 * send errors (so typed ProviderErrors can be asserted).
 */
import { loadMediaOf, type Bot } from '@botmesh/core'
import pino from 'pino'

export const silent = pino({ level: 'silent' })

export interface Recorded {
  sendErrors: unknown[]
}

export function standardHandlers(bot: Bot): Recorded {
  const rec: Recorded = { sendErrors: [] }
  bot.when('hola', (ctx) => ctx.reply('¡Hola!'))
  bot.when('menu', (ctx) => ctx.buttons('¿Qué quieres?', [{ id: 'cafe', title: 'Café' }, { id: 'pan', title: 'Pan' }]))
  bot.when('lista', (ctx) => bot.send(ctx.from, {
    kind: 'list', text: 'Elige un pan', buttonText: 'Ver',
    sections: [{ title: 'Panes', rows: [{ id: 'baguette', title: 'Baguette' }, { id: 'croissant', title: 'Croissant', description: 'De mantequilla' }] }],
  }))
  bot.when('cafe', (ctx) => ctx.reply(`elegiste ${ctx.body}`))
  bot.when('croissant', (ctx) => ctx.reply(`lista: ${ctx.body}`))
  bot.when('donde', (ctx) => ctx.location(4.65, -74.05, 'Tienda'))
  bot.when('foto', (ctx) => ctx.photo({ url: 'https://example.com/pan.jpg' }, 'una foto'))
  bot.when('subir', (ctx) => ctx.photo(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]), 'subida'))
  bot.when('plantilla', (ctx) => bot.send(ctx.from, { kind: 'template', name: 'hello_world', language: 'en_US' }))
  bot.when('encuesta', (ctx) => ctx.poll('¿Pan o café?', ['Pan', 'Café']))
  bot.when('enviar', async (ctx) => {
    try { await ctx.reply('intento') } catch (err) { rec.sendErrors.push(err) }
  })
  for (const type of ['image', 'video', 'audio', 'document', 'voice'] as const) {
    bot.onType(type, async (ctx) => {
      const media = await loadMediaOf(ctx, { throwOnError: true }).catch((err: unknown) => {
        rec.sendErrors.push(err)
        return undefined
      })
      await ctx.reply(media ? `media ${ctx.type} ${media.buffer.length} bytes ${media.mimetype}` : `media ${ctx.type} unavailable`)
    })
  }
  bot.onType('location', (ctx) => ctx.reply(`ubicación ${ctx.sharedLocation?.latitude},${ctx.sharedLocation?.longitude}`))
  return rec
}

/** A small JPEG-looking buffer. */
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(996, 1)])
