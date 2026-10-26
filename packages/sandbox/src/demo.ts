/**
 * The demo bot the sandbox starts by default: a small bakery menu that
 * exercises buttons, lists, polls, locations, media in both directions and an
 * AI fallback answered by a scripted MockAIProvider (no API key needed).
 */

import { loadMediaOf, type Bot } from '@botmesh/core'
import { aiPlugin, type GenerateInput } from '@botmesh/ai'
import { MockAIProvider } from '@botmesh/ai/testing'
import type { ChannelName } from './sim/base.js'

export interface DemoOptions {
  /** Base URL of the sandbox UI (serves the demo images the bot sends by URL). */
  assetsUrl: string
}

const PRODUCTS = [
  { id: 'croissant', title: 'Croissant', price: 2.5, description: 'All butter' },
  { id: 'baguette', title: 'Baguette', price: 1.8, description: 'Freshly baked' },
  { id: 'pan_queso', title: 'Cheese bread', price: 1.2, description: 'House recipe' },
  { id: 'cafe', title: 'Coffee', price: 1.5, description: 'Black or with milk' },
]

/** The scripted "model": answers with what it understood and points at the menu. */
export function demoModel(): MockAIProvider {
  return new MockAIProvider({
    model: 'sandbox-mock',
    reply: (input: GenerateInput) => {
      const last = input.messages[input.messages.length - 1]
      const text = last?.role === 'user' && typeof last.content === 'string' ? last.content : ''
      return `🤖 (simulated AI) I understood: "${text.slice(0, 120)}". Type *menu* to see the catalog, *location* to find us or *poll* to vote.`
    },
  })
}

/** Register the demo handlers on `bot`. */
export function setupDemoBot(bot: Bot, channel: ChannelName, opts: DemoOptions): void {
  const image = (id: string) => ({ url: `${opts.assetsUrl}/assets/${id}.svg` })

  bot.when(['hi', 'hello', 'start', '/start', 'hola', 'inicio'], (ctx) =>
    ctx.buttons(`Hi! I am the test bakery on ${channel}. What would you like to do?`, [
      { id: 'menu', title: 'See the menu' },
      { id: 'ubicacion', title: 'Location' },
      { id: 'encuesta', title: 'Poll' },
    ]))

  bot.when(['menu', 'menú', '/menu'], (ctx) => bot.send(ctx.from, {
    kind: 'list',
    text: "Today's menu",
    buttonText: 'See products',
    sections: [{ title: 'Bakery', rows: PRODUCTS.map((p) => ({ id: p.id, title: p.title, description: `$${p.price.toFixed(2)} · ${p.description}` })) }],
  }))

  for (const p of PRODUCTS) {
    bot.when(p.id, async (ctx) => {
      try {
        await ctx.photo(image(p.id), `${p.title}: $${p.price.toFixed(2)}`)
      } catch {
        await ctx.reply(`${p.title}: $${p.price.toFixed(2)}`)
      }
      await ctx.buttons('Add it to your order?', [{ id: `pedir_${p.id}`, title: 'Yes, order' }, { id: 'menu', title: 'See the menu' }])
    })
    bot.when(`pedir_${p.id}`, (ctx) => ctx.reply(`✅ Order: 1 × ${p.title} ($${p.price.toFixed(2)}). Thanks for trying the sandbox.`))
  }

  bot.when(['location', 'where', 'ubicacion', 'ubicación', 'donde'], async (ctx) => {
    try {
      await ctx.location(4.6533, -74.0836, 'Sandbox Bakery')
    } catch {
      await ctx.reply('We are at 4.6533, -74.0836 (Sandbox Bakery): https://maps.google.com/?q=4.6533,-74.0836')
    }
  })

  bot.when(['poll', '/poll', 'encuesta', '/encuesta'], async (ctx) => {
    try {
      await ctx.poll('What do you prefer for breakfast?', ['Croissant', 'Cheese bread', 'Coffee'])
    } catch {
      await ctx.buttons('What do you prefer for breakfast?', [{ id: 'croissant', title: 'Croissant' }, { id: 'pan_queso', title: 'Cheese bread' }, { id: 'cafe', title: 'Coffee' }])
    }
  })

  for (const type of ['image', 'video', 'audio', 'voice', 'document', 'sticker'] as const) {
    bot.onType(type, async (ctx) => {
      const media = await loadMediaOf(ctx).catch(() => undefined)
      await ctx.reply(media
        ? `📎 Got your ${type}: ${(media.buffer.length / 1024).toFixed(1)} KB (${media.mimetype}).`
        : `📎 Got your ${type}, but I could not download it (expired URL?).`)
    })
  }
  bot.onType('location', (ctx) => {
    const l = ctx.sharedLocation
    return ctx.reply(l ? `📍 Got your location: ${l.latitude}, ${l.longitude}${l.name ? ` (${l.name})` : ''}.` : '📍 Got a location without valid coordinates.')
  })

  bot.plug(aiPlugin({ instance: demoModel(), persona: 'Assistant of a test bakery.' }))
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
