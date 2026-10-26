/**
 * `@botmesh/sandbox/providers` — one place that knows how to build each
 * channel's simulator and its real provider pointed at it. Used by the CLI,
 * the web UI and tests that want "a bot on every channel".
 */

import type { Bot, IProvider, LoggerLike } from '@botmesh/core'
import { CloudAPIProvider } from '@botmesh/meta'
import { MessengerProvider } from '@botmesh/messenger'
import { InstagramProvider } from '@botmesh/instagram'
import { TwilioProvider } from '@botmesh/twilio'
import { GupshupProvider } from '@botmesh/gupshup'
import { GoHighLevelProvider } from '@botmesh/gohighlevel'
import { TikTokProvider } from '@botmesh/tiktok'
import { DiscordProvider } from '@botmesh/discord'
import { TelegramProvider } from '@botmesh/telegram'
import type { BaseSimulatorOptions, ChannelName, PlatformSimulator } from './sim/base.js'
import { WhatsAppSimulator } from './channels/whatsapp.js'
import { InstagramSimulator, MessengerSimulator } from './channels/messenger.js'
import { TwilioSimulator } from './channels/twilio.js'
import { GupshupSimulator } from './channels/gupshup.js'
import { GoHighLevelSimulator } from './channels/gohighlevel.js'
import { TikTokSimulator } from './channels/tiktok.js'
import { DiscordSimulator } from './channels/discord.js'
import { TelegramSimulator } from './channels/telegram.js'
import { startHarness, type Harness, type HarnessOptions } from './harness.js'

/**
 * Channels whose provider turns a native poll vote into a 'poll' event, so
 * the UI sends a real vote there (elsewhere it sends the option text). Empty
 * while the Telegram (`poll_answer`) and Discord (`MESSAGE_POLL_VOTE_ADD`)
 * providers ignore votes; `tests/poll-votes.test.ts` fails as soon as one of
 * them starts parsing them, so this set is kept in sync.
 */
export const POLL_VOTE_PARSING: ReadonlySet<ChannelName> = new Set<ChannelName>()

/** Every simulated channel, in UI order. */
export const CHANNELS: readonly ChannelName[] = ['whatsapp', 'messenger', 'instagram', 'telegram', 'discord', 'twilio', 'gupshup', 'gohighlevel', 'tiktok']

/** Build the simulator of a channel. */
export function createSimulator(channel: ChannelName, options: BaseSimulatorOptions = {}): PlatformSimulator {
  switch (channel) {
    case 'whatsapp': return new WhatsAppSimulator(options)
    case 'messenger': return new MessengerSimulator(options)
    case 'instagram': return new InstagramSimulator(options)
    case 'twilio': return new TwilioSimulator(options)
    case 'gupshup': return new GupshupSimulator(options)
    case 'gohighlevel': return new GoHighLevelSimulator(options)
    case 'tiktok': return new TikTokSimulator(options)
    case 'discord': return new DiscordSimulator(options)
    case 'telegram': return new TelegramSimulator(options)
  }
}

export interface ProviderOptions {
  logger?: LoggerLike
  /** Telegram transport. Default `'polling'`. */
  telegramMode?: 'polling' | 'webhook'
}

/** Build the real provider of `sim`'s channel, configured to talk to it. `webhookUrl` is the bot's public route. */
export function createProvider(sim: PlatformSimulator, webhookUrl: string, opts: ProviderOptions = {}): IProvider {
  const logger = opts.logger ? { logger: opts.logger } : {}
  if (sim instanceof WhatsAppSimulator) return new CloudAPIProvider({ ...sim.providerConfig(), ...logger })
  if (sim instanceof InstagramSimulator) return new InstagramProvider({ ...sim.providerConfig(), ...logger })
  if (sim instanceof MessengerSimulator) return new MessengerProvider({ ...sim.providerConfig(), ...logger })
  if (sim instanceof TwilioSimulator) return new TwilioProvider({ ...sim.providerConfig(webhookUrl), statusCallback: webhookUrl, ...logger })
  if (sim instanceof GupshupSimulator) return new GupshupProvider({ ...sim.providerConfig(), ...logger })
  if (sim instanceof GoHighLevelSimulator) return new GoHighLevelProvider({ ...sim.providerConfig(), ...logger })
  if (sim instanceof TikTokSimulator) return new TikTokProvider({ ...sim.providerConfig(), ...logger })
  if (sim instanceof DiscordSimulator) return new DiscordProvider({ ...sim.providerConfig(), reconnectDelayMs: 100, ...logger })
  if (sim instanceof TelegramSimulator) return new TelegramProvider({ ...sim.providerConfig(opts.telegramMode ?? 'polling'), ...logger })
  throw new Error(`no provider for ${sim.channel}`)
}

/** Harness options a channel needs (webhook route or not, raw body type). */
export function harnessOptionsFor(sim: PlatformSimulator, opts: ProviderOptions = {}): HarnessOptions {
  if (sim instanceof DiscordSimulator) return { webhook: false }
  if (sim instanceof TelegramSimulator) return (opts.telegramMode ?? 'polling') === 'polling' ? { webhook: false } : { body: 'text' }
  return {}
}

/**
 * Start `sim` and a Bot on its real provider. `setup` registers the bot's
 * handlers; `createBot` replaces the default `new Bot({ provider })`.
 */
export async function connectBot(
  sim: PlatformSimulator,
  setup: (bot: Bot, channel: ChannelName) => void | Promise<void>,
  opts: ProviderOptions & { createBot?: (provider: IProvider) => Bot | Promise<Bot>; bot?: HarnessOptions['bot'] } = {},
): Promise<Harness<PlatformSimulator, IProvider>> {
  const h = await startHarness(sim, (s, ctx) => createProvider(s, ctx.webhookUrl, opts), (bot) => setup(bot, sim.channel), {
    ...harnessOptionsFor(sim, opts),
    ...(opts.createBot ? { createBot: opts.createBot } : {}),
    ...(opts.bot ? { bot: opts.bot } : {}),
  })
  if (sim instanceof DiscordSimulator) await sim.waitForGateway(10_000)
  return h
}
