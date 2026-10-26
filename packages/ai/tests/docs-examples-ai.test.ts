/**
 * The AI examples of the docs (docs/examples/ai-*.md and their Spanish mirrors in
 * docs/es/ejemplos/ia-*.md) are the showcase a visitor copies. Each page's `bot.js` is run
 * as written in the terminal simulator (DevSession, the engine of `npx botmesh dev`) with a
 * scripted MockAIProvider in place of the real model, and the simulator output must equal
 * the transcript printed on the page, character for character.
 *
 * To refresh a transcript after changing an example: DOCS_CAPTURE=<dir> pnpm --filter
 * @botmesh/ai exec vitest run tests/docs-examples-ai.test.ts writes each run's output to
 * <dir>/<page>.txt.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MockProvider } from '@botmesh/core/testing'
import type { GenerateInput } from '../src/index.js'
import { MockAIProvider, type MockTurn } from '../src/testing.js'
import { docsAIHarness } from './fixtures/docs-ai-shim.js'
import {
  botBlock, importProgram, lastUserText, namedBlock, pageTranscript, readPage, runInSimulator, userLines, type SimOptions, type SimRun,
} from './fixtures/docs-examples-harness.js'

const runs: SimRun[] = []
afterEach(async () => {
  while (runs.length) await runs.pop()!.close()
})

type Reply = (input: GenerateInput) => string | MockTurn

/** Run a page and compare the simulator output with its transcript. */
async function runPage(page: string, reply: Reply, extra: Partial<SimOptions> = {}): Promise<SimRun> {
  const md = await readPage(page)
  const transcript = pageTranscript(md)
  const run = await runInSimulator(botBlock(md), { reply, lines: userLines(transcript), ...extra })
  runs.push(run)
  if (process.env.DOCS_CAPTURE) {
    await mkdir(process.env.DOCS_CAPTURE, { recursive: true })
    await writeFile(join(process.env.DOCS_CAPTURE, page.replace(/[/\\]/g, '_') + '.txt'), run.output)
  }
  // Blank lines of a multi-line message carry the label's indent: editors strip it on the page.
  const trimEnds = (text: string) => text.replace(/[ \t]+$/gm, '')
  expect(trimEnds(run.output)).toBe(trimEnds(transcript))
  return run
}

/** A scripted model: the first rule whose pattern matches the last user text answers. */
function byQuestion(rules: Array<[RegExp, string]>, fallback = '?'): Reply {
  return (input) => rules.find(([re]) => re.test(lastUserText(input)))?.[1] ?? fallback
}

/** Run a page's factory on a MockProvider (no simulator), for failure paths the transcript does not show. */
async function onMockProvider(page: string, reply: Reply, prepare: (provider: MockProvider) => void = () => {}) {
  const md = await readPage(page)
  const program = await importProgram(botBlock(md), reply)
  const provider = new MockProvider()
  prepare(provider)
  const bot = await program.factory(provider)
  const warnings: unknown[][] = []
  bot.logger.warn = (...args: unknown[]) => { warnings.push(args) }
  await bot.start()
  const texts = (chat?: string) =>
    provider.outbox.filter((o) => chat === undefined || o.chatId === chat).map((o) => (o.content.kind === 'text' ? o.content.text : `[${o.content.kind}]`))
  const settle = async () => {
    await expect.poll(() => bot.isBusy(), { timeout: 5000 }).toBe(false)
    await new Promise((r) => setTimeout(r, 20))
  }
  return { provider, bot, program, warnings, texts, settle, async close() { await bot.stop(); await program.cleanup() } }
}

// ---------------------------------------------------------------------------------------
// 1. AI FAQ assistant with guardrails

const FAQ = [
  {
    page: 'docs/examples/ai-faq.md',
    brand: 'Northwind Bikes',
    reply: byQuestion([
      [/electric/, 'Yes, our workshop services electric bikes too: motor, battery and brakes. Bring it in Mon-Sat, 9:00-19:00.'],
      [/poem/, 'Sorry, I can only help with Northwind Bikes. Type "agent" to talk to a person.'],
    ]),
    long: 'Please ask one short question',
  },
  {
    page: 'docs/es/ejemplos/ia-faq.md',
    brand: 'Bicicletas Northwind',
    reply: byQuestion([
      [/eléctricas/, 'Sí, nuestro taller también repara bicicletas eléctricas: motor, batería y frenos. Tráela de lunes a sábado, de 9:00 a 19:00.'],
      [/poema/, 'Lo siento, solo puedo ayudarte con Bicicletas Northwind. Escribe "asesor" para hablar con una persona.'],
    ]),
    long: 'Haz una pregunta corta',
  },
]

describe.each(FAQ)('$page', (p) => {
  it('runs as documented: fixed answers skip the model, the rest goes to the persona', async () => {
    const run = await runPage(p.page, p.reply)
    // Only the two open questions reached the model, with the business persona.
    expect(run.mock.calls).toHaveLength(2)
    expect(run.mock.calls[0]!.system).toContain(p.brand)
    expect(run.mock.calls[0]!.maxTokens).toBe(300)
    // The key comes from the environment, never from the code.
    expect(run.configs[0]).toMatchObject({ provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY })
  })

  it('answers an over-long message without calling the model', async () => {
    const md = await readPage(p.page)
    const run = await runInSimulator(botBlock(md), { reply: p.reply, lines: ['x'.repeat(600)] })
    runs.push(run)
    expect(run.output).toContain(p.long)
    expect(run.mock.calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------------------
// 2. AI booking assistant with tools

/** The last tool turn's first result, when the model is reading tool results. */
function toolResult(input: GenerateInput): { name: string; content: string; isError: boolean } | undefined {
  const last = input.messages.at(-1)
  if (last?.role !== 'tool') return undefined
  const r = last.results[0]!
  return { name: r.name, content: r.content, isError: r.isError === true }
}

/** A tool result as an object (`{}` for a plain-text result such as a declined confirmation). */
function parseJson(text: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(text)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

interface BookingTexts {
  /** Tool names as the page declares them. */
  tools: { list: string; mine: string; book: string; cancel: string }
  bookArgs: Record<string, string>; bookingId: string
  ask: RegExp; pick: RegExp; again: RegExp; cancel: RegExp
  offer: string; booked: (data: Record<string, unknown>) => string; duplicate: string; kept: string; cancelled: string
}

function bookingModel(t: BookingTexts): Reply {
  return (input) => {
    const r = toolResult(input)
    if (r) {
      const data = parseJson(r.content)
      if (r.name === t.tools.list) return t.offer
      if (r.name === t.tools.book) return data.reason === 'duplicate' ? t.duplicate : t.booked(data)
      if (r.name === t.tools.cancel) return r.isError || data.executed === false ? t.kept : t.cancelled
      return '?'
    }
    const text = lastUserText(input)
    if (t.ask.test(text)) return { toolCalls: [{ name: t.tools.list }] }
    if (t.pick.test(text) || t.again.test(text)) return { toolCalls: [{ name: t.tools.book, args: t.bookArgs }] }
    if (t.cancel.test(text)) return { toolCalls: [{ name: t.tools.cancel, args: { id: t.bookingId } }] }
    return '?'
  }
}

const BOOKING = [
  {
    page: 'docs/examples/ai-tools-booking.md',
    tools: ['list_availability', 'my_appointments', 'book_appointment', 'cancel_appointment'],
    reply: bookingModel({
      tools: { list: 'list_availability', mine: 'my_appointments', book: 'book_appointment', cancel: 'cancel_appointment' },
      bookArgs: { service: 'haircut', slot: 'Mon 15:00' }, bookingId: 'B-1',
      ask: /haircut on Monday/, pick: /^15:00/, again: /book the haircut/, cancel: /cancel/,
      offer: 'Sure! A haircut is $25. On Monday I have 10:00 and 15:00 free. Which one suits you?',
      booked: (d) => `Done! Your haircut is booked for ${String(d.slot)} (booking ${String(d.id)}). See you then! 💈`,
      duplicate: 'That one is already booked (B-1, Mon 15:00), so I did not book it twice.',
      kept: 'OK, I kept your appointment on Mon 15:00.',
      cancelled: 'Your appointment is cancelled.',
    }),
    invented: { name: 'book_appointment', args: { service: 'haircut', slot: 'Sun 03:00' } },
    sorry: 'Sorry, that time is not available.',
  },
  {
    page: 'docs/es/ejemplos/ia-herramientas-citas.md',
    tools: ['consultar_disponibilidad', 'mis_citas', 'reservar_cita', 'cancelar_cita'],
    reply: bookingModel({
      tools: { list: 'consultar_disponibilidad', mine: 'mis_citas', book: 'reservar_cita', cancel: 'cancelar_cita' },
      bookArgs: { servicio: 'corte', horario: 'lun 15:00' }, bookingId: 'C-1',
      ask: /corte de pelo el lunes/, pick: /^a las 15:00/, again: /resérvame el corte/, cancel: /cancél/,
      offer: '¡Claro! Un corte de pelo cuesta $25. El lunes tengo libres las 10:00 y las 15:00. ¿Cuál te va mejor?',
      booked: (d) => `¡Listo! Tu corte quedó reservado para el ${String(d.horario)} (cita ${String(d.id)}). ¡Te esperamos! 💈`,
      duplicate: 'Esa cita ya está reservada (C-1, lun 15:00), así que no la reservé dos veces.',
      kept: 'De acuerdo, mantengo tu cita del lun 15:00.',
      cancelled: 'Tu cita quedó cancelada.',
    }),
    invented: { name: 'reservar_cita', args: { servicio: 'corte', horario: 'dom 03:00' } },
    sorry: 'Lo siento, esa hora no está disponible.',
  },
]

describe.each(BOOKING)('$page', (p) => {
  it('runs as documented: confirmation with your prices, one booking, a declined cancel', async () => {
    const run = await runPage(p.page, p.reply)
    expect(run.configs[0]).toMatchObject({ provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY, maxSteps: 4 })
    // The model saw the four tools; the first booking ran once, the repeat was deduplicated.
    expect(run.mock.calls[0]!.tools?.map((t) => t.name)).toEqual(p.tools)
    const book = p.tools[2]!
    const results = run.mock.calls.flatMap((c) => {
      const last = c.messages.at(-1)
      return last?.role === 'tool' ? last.results.map((r) => `${r.name}:${r.content}`) : []
    })
    expect(results.filter((r) => r.startsWith(`${book}:{"id":`))).toHaveLength(1)
    expect(results.some((r) => r.startsWith(`${book}:`) && r.includes('"reason":"duplicate"'))).toBe(true)
  })

  it('rejects an invented slot before asking the customer', async () => {
    const md = await readPage(p.page)
    const invented: Reply = (input) => toolResult(input) ? p.sorry : { toolCalls: [p.invented] }
    const run = await runInSimulator(botBlock(md), { reply: invented, lines: ['Sunday at 3am'] })
    runs.push(run)
    expect(run.output).not.toMatch(/About to|Voy a/)
    expect(run.output).toContain(p.sorry)
  })
})

// ---------------------------------------------------------------------------------------
// 3. AI answers from your own FAQ (RAG)

interface RagTexts { shipping: RegExp; returns: RegExp; shippingText: string; returnsText: string; shippingAnswer: string; returnsAnswer: string; unknown: string }

/** Answers from the passage the plugin injected into the system prompt, like a grounded model. */
function ragModel(t: RagTexts): Reply {
  return (input) => {
    const q = lastUserText(input)
    const system = input.system ?? ''
    if (t.shipping.test(q) && system.includes(t.shippingText)) return t.shippingAnswer
    if (t.returns.test(q) && system.includes(t.returnsText)) return t.returnsAnswer
    return t.unknown
  }
}

const RAG = [
  {
    page: 'docs/examples/ai-rag.md',
    reply: ragModel({
      shipping: /shipping/, returns: /return/,
      shippingText: 'Orders arrive in 2-3 business days', returnsText: 'within 30 days of delivery',
      shippingAnswer: 'Orders arrive in 2-3 business days, or the next business day with express shipping [1].',
      returnsAnswer: 'Yes: you can return a lamp within 30 days of delivery, unused and in its box [1].',
      unknown: 'Sorry, I do not know that. Please write to help@lumen.example.',
    }),
  },
  {
    page: 'docs/es/ejemplos/ia-rag.md',
    reply: ragModel({
      shipping: /envío/, returns: /devolver/,
      shippingText: 'Los pedidos llegan en 2-3 días hábiles', returnsText: 'en los 30 días siguientes a la entrega',
      shippingAnswer: 'Los pedidos llegan en 2-3 días hábiles, o al día hábil siguiente con envío exprés [1].',
      returnsAnswer: 'Sí: puedes devolver una lámpara en los 30 días siguientes a la entrega, sin usar y en su caja [1].',
      unknown: 'Lo siento, no lo sé. Escribe a ayuda@lumen.example, por favor.',
    }),
  },
]

describe.each(RAG)('$page', (p) => {
  it('runs as documented: answers from faq.md with sources, admits what it does not know', async () => {
    const md = await readPage(p.page)
    const run = await runPage(p.page, p.reply, { files: { 'faq.md': namedBlock(md, 'md', 'faq.md') } })
    expect(run.configs[0]).toMatchObject({ provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY })
    // The unrelated question reached the model with no FAQ passage.
    const [shipping, unknown, returns] = run.mock.calls
    expect(shipping!.system).toContain('faq.md')
    expect(unknown!.system ?? '').not.toContain('faq.md')
    expect(returns!.system).toMatch(/within 30 days|en los 30 días/)
  })
})

// ---------------------------------------------------------------------------------------
// 4. AI router: intents to flows, chit-chat to the AI

interface RouterTexts { payment: RegExp; order: RegExp; labels: [string, string, string]; chat: string }

/** The classifier call (its system prompt starts with "Classify"/"Clasifica") answers a label. */
function routerModel(t: RouterTexts): Reply {
  return (input) => {
    const text = lastUserText(input)
    const [payment, order, chat] = t.labels
    if (/^Clasifica|^Classify/.test(input.system ?? '')) return t.payment.test(text) ? payment : t.order.test(text) ? order : chat
    return t.chat
  }
}

const ROUTER = [
  {
    page: 'docs/examples/ai-router.md',
    reply: routerModel({ payment: /pay/, order: /SIM|order/, labels: ['payment', 'order', 'chat'], chat: 'Happy to help! 😊 Anything else about your Nimbus plan?' }),
    keyword: 'payment',
    firstAsk: 'account number',
    modelDown: '😕 I cannot answer that right now. Type "payment" or "order", or try again in a moment.',
    textOnly: '✍️ I can only read text for now. Type "payment", "order" or your question.',
  },
  {
    page: 'docs/es/ejemplos/ia-enrutador.md',
    reply: routerModel({ payment: /pagar/, order: /SIM|pedido/, labels: ['pago', 'pedido', 'charla'], chat: '¡Con gusto! 😊 ¿Algo más sobre tu plan de Nimbus?' }),
    keyword: 'pago',
    firstAsk: 'número de cuenta',
    modelDown: '😕 Ahora mismo no puedo responder a eso. Escribe "pago" o "pedido", o vuelve a intentarlo en un momento.',
    textOnly: '✍️ Por ahora solo leo texto. Escribe "pago", "pedido" o tu pregunta.',
  },
]

describe.each(ROUTER)('$page', (p) => {
  it('runs as documented: the model only classifies, the flows do the work', async () => {
    const run = await runPage(p.page, p.reply)
    expect(run.configs[0]).toMatchObject({ provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY, autoReply: false })
    // Three free-text messages, three classifier calls (bounded) plus one chit-chat answer.
    const classifier = run.mock.calls.filter((c) => /^Clasifica|^Classify/.test(c.system ?? ''))
    expect(classifier).toHaveLength(3)
    for (const c of classifier) expect(c.maxTokens).toBe(100)
    expect(run.mock.calls).toHaveLength(4)
  })

  it('starts a flow by its keyword without calling the model', async () => {
    const md = await readPage(p.page)
    const run = await runInSimulator(botBlock(md), { reply: p.reply, lines: [p.keyword] })
    runs.push(run)
    expect(run.output).toContain(p.firstAsk)
    expect(run.mock.calls).toHaveLength(0)
  })

  it('falls back to chit-chat when the classifier answers something unexpected', async () => {
    const md = await readPage(p.page)
    const run = await runInSimulator(botBlock(md), { reply: (input) => (input.system?.match(/^Clasifica|^Classify/) ? 'refund!!' : 'ok'), lines: ['hello'] })
    runs.push(run)
    expect(run.output).toContain('bot › ok')
  })

  it('never leaves the customer in silence when the model fails', async () => {
    const t = await onMockProvider(p.page, () => { throw new Error('model outage') })
    try {
      t.provider.incoming('hello there')
      await t.settle()
      expect(t.texts()).toEqual([p.modelDown])
      expect(t.warnings).toHaveLength(1)
    } finally {
      await t.close()
    }
  })

  it('answers a message without text with a fixed reply and no model call', async () => {
    const t = await onMockProvider(p.page, p.reply)
    try {
      t.provider.incomingMedia('image', Buffer.from('jpg'))
      await t.settle()
      expect(t.texts()).toEqual([p.textOnly])
      expect(t.program.mock.calls).toHaveLength(0)
    } finally {
      await t.close()
    }
  })
})

// ---------------------------------------------------------------------------------------
// 5. AI support with human escalation

interface HandoffTexts { tool: string; args: Record<string, string>; down: RegExp; escalate: RegExp; restart: string; handedOff: string }

function handoffModel(t: HandoffTexts): Reply {
  return (input) => {
    const r = toolResult(input)
    if (r?.name === t.tool) return t.handedOff
    const text = lastUserText(input)
    if (t.escalate.test(text)) return { toolCalls: [{ name: t.tool, args: t.args }] }
    if (t.down.test(text)) return t.restart
    return '?'
  }
}

const HANDOFF = [
  {
    page: 'docs/examples/ai-handoff.md',
    reply: handoffModel({
      tool: 'escalate_to_human',
      args: {
        reason: 'technician',
        summary: 'Internet down since yesterday; router restarted twice with no change. Wants a technician visit and a refund for the days without service.',
      },
      down: /down/, escalate: /technician/,
      restart: 'Sorry about that! Please unplug your router for 30 seconds and plug it back in. Did that help?',
      handedOff: 'I have passed your case to our team: a person will write to you here shortly.',
    }),
    agents: 'agents',
    escalateText: 'I already did that twice. I want a technician and a refund',
    handedOffText: 'I have passed your case to our team: a person will write to you here shortly.',
  },
  {
    page: 'docs/es/ejemplos/ia-escalado-humano.md',
    reply: handoffModel({
      tool: 'escalar_a_humano',
      args: {
        motivo: 'tecnico',
        resumen: 'Sin internet desde ayer; reinició el router dos veces sin cambios. Pide la visita de un técnico y un reembolso por los días sin servicio.',
      },
      down: /internet/, escalate: /técnico/,
      restart: '¡Lo siento! Desenchufa el router 30 segundos y vuelve a enchufarlo. ¿Se arregló?',
      handedOff: 'He pasado tu caso a nuestro equipo: una persona te escribirá por aquí en breve.',
    }),
    agents: 'agentes',
    escalateText: 'ya lo hice dos veces. Quiero un técnico y un reembolso',
    handedOffText: 'He pasado tu caso a nuestro equipo: una persona te escribirá por aquí en breve.',
  },
]

describe.each(HANDOFF)('$page', (p) => {
  it('runs as documented: the model escalates with a summary, the bot goes quiet until /bot', async () => {
    const run = await runPage(p.page, p.reply)
    expect(run.configs[0]).toMatchObject({ provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY })
    // The model was not called while the chat was handed off ("hello?").
    expect(run.mock.calls).toHaveLength(3)
    expect(run.bot.isHandedOff('user')).toBe(false)
  })

  it('still hands the chat off when the agents chat cannot be reached', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (err: unknown) => { unhandled.push(err) }
    process.on('unhandledRejection', onUnhandled)
    const t = await onMockProvider(p.page, p.reply, (provider) => {
      const send = provider.send.bind(provider)
      provider.send = async (chatId, content, options) => {
        if (chatId === p.agents) throw new Error('agents chat unreachable')
        return send(chatId, content, options)
      }
    })
    try {
      t.provider.incoming(p.escalateText, { from: 'customer' })
      await t.settle()
      expect(t.bot.isHandedOff('customer')).toBe(true)
      expect(t.texts('customer')).toEqual([p.handedOffText])
      // The case and the relay of the escalating message both failed, and both were logged.
      expect(t.warnings).toHaveLength(2)
      t.provider.incoming('hello?', { from: 'customer' })
      await t.settle()
      expect(t.warnings).toHaveLength(3)
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
      await t.close()
    }
  })
})

// ---------------------------------------------------------------------------------------
// 6. Streaming AI replies on Telegram

class SlowMockAIProvider extends MockAIProvider {
  override async *stream(input: GenerateInput): AsyncIterable<string> {
    let text = ''
    for await (const piece of super.stream(input)) text += piece
    for (const word of text.split(/(?<= )/)) {
      await new Promise((r) => setTimeout(r, 30))
      yield word
    }
  }
}

const STREAMING = [
  {
    page: 'docs/examples/ai-streaming.md',
    answer: [
      'Sauté a chopped onion and two garlic cloves in olive oil for five minutes.',
      'Add a 400 g can of crushed tomatoes, a cup of stock, salt and a pinch of sugar, and simmer for 15 minutes.',
      'Blend until smooth, then finish with fresh basil and a splash of cream.',
      'Serve it hot with toasted bread.',
    ].join(' '),
    question: 'how do I make a quick tomato soup?',
  },
  {
    page: 'docs/es/ejemplos/ia-streaming.md',
    answer: [
      'Sofríe una cebolla picada y dos dientes de ajo en aceite de oliva durante cinco minutos.',
      'Añade una lata de 400 g de tomate triturado, una taza de caldo, sal y una pizca de azúcar, y cuece 15 minutos.',
      'Tritúralo hasta que quede fino y termina con albahaca fresca y un chorrito de nata.',
      'Sírvela caliente con pan tostado.',
    ].join(' '),
    question: '¿cómo hago una sopa de tomate rápida?',
  },
]

describe.each(STREAMING)('$page', (p) => {
  it('runs as documented: the answer is streamed in sentence chunks in the simulator', async () => {
    const run = await runPage(p.page, () => p.answer)
    expect(run.configs[0]).toMatchObject({
      provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY, maxTokens: 800, timeoutMs: 20_000,
      stream: { cursor: ' ▌', canStop: true },
    })
  })

  it('streams a growing draft on a Telegram-like provider, then sends the final text once', async () => {
    const md = await readPage(p.page)
    const program = await importProgram(botBlock(md), () => p.answer)
    // A model that writes a word every 30 ms, so the draft is updated several times.
    docsAIHarness().provider = new SlowMockAIProvider({ reply: p.answer })
    const provider = new MockProvider({ streaming: 'draft' })
    const bot = await program.factory(provider)
    try {
      await bot.start()
      provider.incoming(p.question)
      await expect.poll(() => provider.outbox.length, { timeout: 5000 }).toBeGreaterThan(0)
      await expect.poll(() => bot.isBusy(), { timeout: 5000 }).toBe(false)
      expect(provider.drafts.length).toBeGreaterThan(0)
      const texts = provider.outbox.map((o) => (o.content.kind === 'text' ? o.content.text : ''))
      expect(texts).toEqual([p.answer])
      expect(texts[0]).not.toContain('▌')
    } finally {
      await bot.stop()
      await program.cleanup()
    }
  })
})
