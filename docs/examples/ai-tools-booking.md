# AI booking assistant with tools

A barbershop assistant that books, lists and cancels appointments by calling your functions, and asks the customer to confirm every change first.

**Level:** Intermediate · **Tags:** AI, Tools, WhatsApp, Telegram

**Features shown:** [AI tool calling](/guide/ai-tools) ·
[human confirmation (`confirm: true`)](/guide/ai-tools#human-confirmation) ·
[`confirmLines` with prices from your code](/guide/ai-tools#readable-values-and-totals) ·
[`dedupe` of repeated side effects](/guide/ai-tools#repeated-side-effects) ·
[`enum` validation of arguments](/guide/ai-tools#schemas) ·
[Yes/No buttons](/guide/ai-tools#yes-no-buttons) ·
[audit events](/guide/ai-tools#audit-events)

## Prerequisites

- Node.js 22.12 or newer.
- An Anthropic API key in the `ANTHROPIC_API_KEY` environment variable (or
  another model with tool calling, see [below](#other-model-providers)).

```bash
npm install @botmesh/core @botmesh/ai @anthropic-ai/sdk @botmesh/baileys
```

While the packages are in prerelease, add the dist-tag shown in
[Getting started](/guide/getting-started#requirements).

## The bot

```js
// bot.js
import { Bot, defineBot, isMainModule, slashCommandsPlugin } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'
import { aiPlugin } from '@botmesh/ai'

// Catalog and calendar. In production, read them from your database.
const SERVICES = {
  haircut: { name: 'Haircut', price: 25 },
  beard: { name: 'Beard trim', price: 15 },
  colour: { name: 'Hair colour', price: 60 },
}
const SLOTS = ['Mon 10:00', 'Mon 15:00', 'Tue 11:00', 'Wed 17:30']

const bookings = [] // in memory for the example; use your database in production
const isFree = (slot) => !bookings.some((b) => b.slot === slot && b.status === 'booked')
const bookedBy = (chat) => bookings.filter((b) => b.chat === chat && b.status === 'booked')
const view = ({ id, service, slot }) => ({ id, service: SERVICES[service].name, slot, price: SERVICES[service].price })

// `enum` rejects an invented service or time before the customer is asked anything.
const BOOKING = {
  type: 'object',
  properties: {
    service: { type: 'string', enum: Object.keys(SERVICES) },
    slot: { type: 'string', enum: SLOTS },
  },
  required: ['service', 'slot'],
  additionalProperties: false,
}

const tools = {
  // Read-only tools run without confirmation.
  list_availability: {
    description: 'List the services with their price, and the free appointment slots.',
    handler: () => ({
      services: Object.entries(SERVICES).map(([key, s]) => ({ key, name: s.name, price: s.price })),
      free: SLOTS.filter(isFree),
    }),
  },
  my_appointments: {
    description: "List the customer's booked appointments with their id.",
    handler: (_args, { ctx }) => bookedBy(ctx?.from).map(view),
  },
  // Tools with side effects: the customer confirms first.
  book_appointment: {
    title: 'Book appointment',
    description: 'Book a service in a free slot.',
    schema: BOOKING,
    confirm: true,
    dedupe: 'args', // the same booking is never made twice in a row
    // The confirmation shows what YOUR code computed, never a price the model wrote.
    confirmLines: ({ service, slot }) => [`• ${SERVICES[service].name}, ${slot}`, `Price: $${SERVICES[service].price}`],
    handler: ({ service, slot }, { ctx }) => {
      if (!isFree(slot)) return { error: `${slot} is taken. Check list_availability.` }
      const booking = { id: `B-${bookings.length + 1}`, chat: ctx?.from, service, slot, status: 'booked' }
      bookings.push(booking)
      return view(booking)
    },
  },
  cancel_appointment: {
    title: 'Cancel appointment',
    description: 'Cancel a booked appointment by id (from my_appointments).',
    schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    confirm: true,
    confirmLines: ({ id }) => [`• Appointment ${id}`],
    handler: ({ id }, { ctx }) => {
      const booking = bookedBy(ctx?.from).find((b) => b.id === id)
      if (!booking) return { error: `No booked appointment ${id}. Check my_appointments.` }
      booking.status = 'cancelled'
      return { id, status: 'cancelled' }
    },
  },
}

const PERSONA = [
  'You are the booking assistant of the Fade & Co. barbershop.',
  'Use list_availability for services, prices and free slots: never invent them.',
  'Book, list and cancel appointments only with the tools. Answer briefly.',
].join(' ')

const createBot = defineBot((provider) => {
  const bot = new Bot({ provider })

  bot.plug(slashCommandsPlugin, {
    greeting: '💈 Hi! I am the Fade & Co. booking assistant. Ask me for an appointment, your bookings or a cancellation.',
  })

  bot.plug(aiPlugin({
    provider: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-sonnet-5-5',
    persona: PERSONA,
    tools,
    maxSteps: 4, // at most 4 model calls per customer message
  }))

  // Audit trail: every tool run (the arguments can hold personal data).
  bot.on('ai.tool', (e) => {
    if (e.type === 'tool.result') bot.logger.info({ tool: e.tool, ms: e.durationMs }, 'ai tool ran')
  })

  return bot
})

export default createBot

// `node bot.js` connects to WhatsApp; `npx botmesh dev bot.js` skips this block.
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'booking-bot' }))
  bot.on('ready', () => console.log('✅ Connected'))
  await bot.start()
}
```

## How it works

- **Tools are plain functions.** Each entry of `tools` has a `description` the
  model reads, an optional JSON `schema` and a `handler`. The plugin runs the
  tool loop: it calls the model, runs the tools it asks for and sends the
  results back until the model writes the answer (`maxSteps` bounds it).
- **Confirmation before side effects.** `confirm: true` makes the plugin ask
  the customer and run the tool only after a clear "yes". The question is
  asked inside a conversation, so the chat is never blocked while waiting. On
  channels with buttons (Telegram, WhatsApp Cloud API, the simulator) it shows
  Yes/No buttons; on WhatsApp through Baileys it asks for a typed yes/no.
- **Your code owns the numbers.** `confirmLines` prints the service and the
  price from `SERVICES`, and the handler returns them too, so the model repeats
  them instead of calculating.
- **No double bookings.** `dedupe: 'args'` skips a call with the same
  arguments as a booking made in the last 10 minutes; the model is told it was
  already done. A handler that returns `{ error }` did nothing and is not
  remembered.
- **Every create has its list and cancel.** Without `my_appointments` and
  `cancel_appointment` a model "fixes" a booking by making another one.
- **Audit.** Each step of the loop is an `'ai.tool'` event; the example logs
  the runs.

## Try it

```bash
npx botmesh dev bot.js --env-file .env   # .env has the line ANTHROPIC_API_KEY=sk-ant-...
```

A run of the code above in the terminal simulator. The model is scripted by the
test that runs this page (`packages/ai/tests/docs-examples-ai.test.ts`); the
confirmations, buttons and tool results are the real ones. In the simulator you
can also answer a confirmation with `:click 1`. In the fourth message the model
asks for the same booking again: `dedupe` skips it without asking, and the
declined cancellation leaves the appointment as it was.

```text
user › hi! can I get a haircut on Monday?
bot › Sure! A haircut is $25. On Monday I have 10:00 and 15:00 free. Which one suits you?
user › 15:00 please
bot › About to: Book appointment
      • Haircut, Mon 15:00
      Price: $25
      Do you confirm?
        [1] Yes
        [2] No
      (:click <n> to choose)
user › yes
bot › Done! Your haircut is booked for Mon 15:00 (booking B-1). See you then! 💈
user › yes, book the haircut at 15:00
bot › That one is already booked (B-1, Mon 15:00), so I did not book it twice.
user › actually, cancel it
bot › About to: Cancel appointment
      • Appointment B-1
      Do you confirm?
        [1] Yes
        [2] No
      (:click <n> to choose)
user › no
bot › OK, I kept your appointment on Mon 15:00.
```

## Other model providers

::: details Switch to OpenAI, Gemini or a local Ollama model
Tool calling works on every provider; on Ollama pick a model tagged *tools*.

OpenAI (`npm install openai`, key in `OPENAI_API_KEY`):

```js
aiPlugin({ provider: 'openai', apiKey: process.env.OPENAI_API_KEY, model: 'gpt-5-mini', persona: PERSONA, tools })
```

Gemini (`npm install @google/genai`, key in `GEMINI_API_KEY`):

```js
aiPlugin({ provider: 'gemini', apiKey: process.env.GEMINI_API_KEY, model: 'gemini-3.8-flash', persona: PERSONA, tools })
```

Ollama on your machine (no package, no key; run `ollama pull qwen3` first):

```js
aiPlugin({ provider: 'ollama', model: 'qwen3', persona: PERSONA, tools })
```
:::

## Run it on WhatsApp or Telegram

`node bot.js` prints a QR code: scan it with WhatsApp (**Linked devices**).
For Telegram, install `@botmesh/telegram` and start the factory with
`new TelegramProvider({ token: process.env.TELEGRAM_TOKEN ?? '' })`: the
confirmation then uses inline Yes/No buttons, which are removed once answered.

## Next steps

- [Bakery AI assistant](https://github.com/andresayac/botmesh/tree/main/examples/bakery-ai): the same ideas for food orders (quotes, update and cancel, orders kept per user), runnable on WhatsApp through Baileys or Twilio
- [AI tool calling guide](/guide/ai-tools): schemas, the loop, confirmations and best practices
- [AI with human escalation](./ai-handoff): a tool that hands the chat to a person
- [Examples overview](./index)
