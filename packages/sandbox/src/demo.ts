/**
 * The demo bot the sandbox starts by default: a small bakery menu that
 * exercises buttons, lists, polls, locations, media in both directions and an
 * AI fallback answered by a scripted MockAIProvider (no API key needed).
 */

import { loadMediaOf, type Bot } from '@botmesh/core'
import { MockAIProvider, aiPlugin, type GenerateInput } from '@botmesh/ai'
import type { ChannelName } from './sim/base.js'

export interface DemoOptions {
  /** Base URL of the sandbox UI (serves the demo images the bot sends by URL). */
  assetsUrl: string
}

const PRODUCTS = [
  { id: 'croissant', title: 'Croissant', price: 2.5, description: 'De mantequilla' },
  { id: 'baguette', title: 'Baguette', price: 1.8, description: 'Recién horneada' },
  { id: 'pan_queso', title: 'Pan de queso', price: 1.2, description: 'Receta de la casa' },
  { id: 'cafe', title: 'Café', price: 1.5, description: 'Americano o con leche' },
]

/** The scripted "model": answers with what it understood and points at the menu. */
export function demoModel(): MockAIProvider {
  return new MockAIProvider({
    model: 'sandbox-mock',
    reply: (input: GenerateInput) => {
      const last = input.messages[input.messages.length - 1]
      const text = last?.role === 'user' && typeof last.content === 'string' ? last.content : ''
      return `🤖 (IA simulada) Entendí: "${text.slice(0, 120)}". Escribe *menu* para ver el catálogo, *ubicacion* para saber dónde estamos o *encuesta* para votar.`
    },
  })
}

/** Register the demo handlers on `bot`. */
export function setupDemoBot(bot: Bot, channel: ChannelName, opts: DemoOptions): void {
  const image = (id: string) => ({ url: `${opts.assetsUrl}/assets/${id}.svg` })

  bot.when(['hola', 'hi', 'hello', 'inicio', 'start', '/start'], (ctx) =>
    ctx.buttons(`¡Hola! Soy la panadería de prueba en ${channel}. ¿Qué quieres hacer?`, [
      { id: 'menu', title: 'Ver menú' },
      { id: 'ubicacion', title: 'Ubicación' },
      { id: 'encuesta', title: 'Encuesta' },
    ]))

  bot.when(['menu', 'menú', '/menu'], (ctx) => bot.send(ctx.from, {
    kind: 'list',
    text: 'Nuestro menú de hoy',
    buttonText: 'Ver productos',
    sections: [{ title: 'Panadería', rows: PRODUCTS.map((p) => ({ id: p.id, title: p.title, description: `$${p.price.toFixed(2)} · ${p.description}` })) }],
  }))

  for (const p of PRODUCTS) {
    bot.when(p.id, async (ctx) => {
      try {
        await ctx.photo(image(p.id), `${p.title}: $${p.price.toFixed(2)}`)
      } catch {
        await ctx.reply(`${p.title}: $${p.price.toFixed(2)}`)
      }
      await ctx.buttons('¿Lo agrego a tu pedido?', [{ id: `pedir_${p.id}`, title: 'Sí, pedir' }, { id: 'menu', title: 'Ver menú' }])
    })
    bot.when(`pedir_${p.id}`, (ctx) => ctx.reply(`✅ Pedido: 1 × ${p.title} ($${p.price.toFixed(2)}). Gracias por probar el sandbox.`))
  }

  bot.when(['ubicacion', 'ubicación', 'donde'], async (ctx) => {
    try {
      await ctx.location(4.6533, -74.0836, 'Panadería Sandbox')
    } catch {
      await ctx.reply('Estamos en 4.6533, -74.0836 (Panadería Sandbox): https://maps.google.com/?q=4.6533,-74.0836')
    }
  })

  bot.when(['encuesta', '/encuesta'], async (ctx) => {
    try {
      await ctx.poll('¿Qué prefieres para el desayuno?', ['Croissant', 'Pan de queso', 'Café'])
    } catch {
      await ctx.buttons('¿Qué prefieres para el desayuno?', [{ id: 'croissant', title: 'Croissant' }, { id: 'pan_queso', title: 'Pan de queso' }, { id: 'cafe', title: 'Café' }])
    }
  })

  for (const type of ['image', 'video', 'audio', 'voice', 'document', 'sticker'] as const) {
    bot.onType(type, async (ctx) => {
      const media = await loadMediaOf(ctx).catch(() => undefined)
      await ctx.reply(media
        ? `📎 Recibí tu ${type}: ${(media.buffer.length / 1024).toFixed(1)} KB (${media.mimetype}).`
        : `📎 Recibí tu ${type}, pero no pude descargarlo (¿URL vencida?).`)
    })
  }
  bot.onType('location', (ctx) => {
    const l = ctx.sharedLocation
    return ctx.reply(l ? `📍 Recibí tu ubicación: ${l.latitude}, ${l.longitude}${l.name ? ` (${l.name})` : ''}.` : '📍 Recibí una ubicación sin coordenadas válidas.')
  })

  bot.plug(aiPlugin({ instance: demoModel(), persona: 'Asistente de una panadería de prueba.' }))
}

/** A tiny SVG "photo" of a product, served by the UI server for the demo bot. */
export function productSvg(id: string): string {
  const p = PRODUCTS.find((x) => x.id === id)
  const label = p?.title ?? id
  const hue = [...id].reduce((h, c) => (h + c.charCodeAt(0) * 7) % 360, 0)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320">
<rect width="480" height="320" rx="24" fill="hsl(${hue} 70% 88%)"/>
<circle cx="240" cy="140" r="80" fill="hsl(${hue} 60% 62%)"/>
<text x="240" y="270" font-family="system-ui, sans-serif" font-size="32" text-anchor="middle" fill="hsl(${hue} 40% 25%)">${label.replace(/[<&>]/g, '')}</text>
</svg>`
}
