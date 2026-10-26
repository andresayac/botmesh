#!/usr/bin/env node
/**
 * `botmesh-sandbox` — start every simulator, a bot on each channel and the
 * web chat UI:
 *
 *   pnpm --filter @botmesh/sandbox start
 *   pnpm --filter @botmesh/sandbox start -- --bot bakery --channels whatsapp,telegram --port 4610
 */

import { parseArgs } from 'node:util'
import { pino } from 'pino'
import { CHANNELS } from './providers.js'
import { startSandbox } from './hub.js'
import type { ChannelName } from './sim/base.js'

const HELP = `botmesh sandbox — local platform simulators + web chat UI

Options:
  --port <n>          UI port (default 4610; 0 picks a free one)
  --host <addr>       bind address (default 127.0.0.1)
  --channels <list>   comma-separated channels (default: all)
                      ${CHANNELS.join(', ')}
  --bot <name>        demo (default) | bakery (examples/bakery-ai, scripted AI) | none
  --telegram <mode>   polling (default) | webhook
  --no-status         do not send delivered/read receipts automatically
  --log <level>       provider/bot log level (default warn)
  -h, --help          this help
`

const { values } = parseArgs({
  options: {
    port: { type: 'string' },
    host: { type: 'string' },
    channels: { type: 'string' },
    bot: { type: 'string' },
    telegram: { type: 'string' },
    'no-status': { type: 'boolean' },
    log: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: true,
})

if (values.help) {
  process.stdout.write(HELP)
  process.exit(0)
}

const channels = values.channels
  ? values.channels.split(',').map((c) => c.trim()).filter(Boolean)
  : [...CHANNELS]
const unknown = channels.filter((c) => !CHANNELS.includes(c as ChannelName))
if (unknown.length) {
  process.stderr.write(`Unknown channel(s): ${unknown.join(', ')}\n\n${HELP}`)
  process.exit(1)
}
const bot = (values.bot ?? 'demo') as 'demo' | 'bakery' | 'none'
if (!['demo', 'bakery', 'none'].includes(bot)) {
  process.stderr.write(`Unknown --bot ${bot}\n\n${HELP}`)
  process.exit(1)
}

const logger = pino({ level: values.log ?? 'warn', base: undefined })
const sandbox = await startSandbox({
  channels: channels as ChannelName[],
  ...(values.port !== undefined ? { port: Number(values.port) } : {}),
  ...(values.host ? { host: values.host } : {}),
  bot,
  ...(values.telegram === 'webhook' ? { telegramMode: 'webhook' as const } : {}),
  ...(values['no-status'] ? { autoStatus: false as const } : {}),
  logger,
}).catch((err: unknown) => {
  process.stderr.write(`Could not start the sandbox: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})

const lines = Object.values(sandbox.sims).map((s) => `  ${s!.channel.padEnd(12)} simulator ${s!.url}${s!.webhook ? `  → bot webhook ${s!.webhook}` : ''}`)
process.stdout.write(`\nbotmesh sandbox ready (${bot} bot)\n\n  Open the chat UI: ${sandbox.url}\n\n${lines.join('\n')}\n\nCtrl+C to stop.\n`)

let stopping = false
const shutdown = () => {
  if (stopping) process.exit(1)
  stopping = true
  sandbox.stop().then(() => process.exit(0), () => process.exit(1))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
