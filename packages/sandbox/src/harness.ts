/**
 * Wire a real provider + Bot to a simulator over real HTTP: the bot's webhook
 * ingress is started first (so providers that sign against their public URL,
 * like Twilio, know it), then the provider is built from the simulator's
 * config and the simulator is pointed at the bot.
 */

import { Bot, type BotConfig, type IProvider } from '@botmesh/core'
import type { WebhookProvider } from '@botmesh/server'
import type { PlatformSimulator } from './sim/base.js'
import { serveWebhooks, type BotIngress } from './ingress.js'

export interface HarnessContext {
  /** Public URL of the bot's webhook route for this channel (empty for push-less channels). */
  webhookUrl: string
}

export interface HarnessOptions {
  /** Webhook path on the bot side. Default `/webhook/<channel>`. */
  path?: string
  /** How the raw body reaches `ingest` (Telegram parses text). Default `'buffer'`. */
  body?: 'buffer' | 'text'
  /** `false` for channels without inbound webhooks (Discord gateway, Telegram polling). */
  webhook?: boolean
  /** Extra Bot config. */
  bot?: Partial<BotConfig>
  /** Start the bot (default true). */
  start?: boolean
  /** Build the Bot yourself (e.g. an example's factory); `bot` config is then ignored. */
  createBot?: (provider: IProvider) => Bot | Promise<Bot>
}

export interface Harness<S extends PlatformSimulator, P extends IProvider> {
  sim: S
  provider: P
  bot: Bot
  ingress?: BotIngress
  stop(): Promise<void>
}

/**
 * Start `sim` (when needed), the bot ingress and a Bot on the provider built
 * by `makeProvider`. `setup` registers handlers before `bot.start()`.
 */
export async function startHarness<S extends PlatformSimulator, P extends IProvider>(
  sim: S,
  makeProvider: (sim: S, ctx: HarnessContext) => P,
  setup: (bot: Bot, provider: P) => void | Promise<void>,
  opts: HarnessOptions = {},
): Promise<Harness<S, P>> {
  const startedSim = !sim.started
  if (startedSim) await sim.start()
  let ingress: BotIngress | undefined
  let provider: P | undefined
  let bot: Bot | undefined
  const path = opts.path ?? `/webhook/${sim.channel}`
  try {
    if (opts.webhook !== false) {
      // Late-bound route: the ingress exists before the provider (its URL is part of the provider config).
      const lazy: WebhookProvider = {
        ingest: (raw, headers, url) => (provider as unknown as WebhookProvider).ingest?.(raw, headers, url),
        verifyChallenge: (query) => (provider as unknown as WebhookProvider).verifyChallenge?.(query) ?? null,
      }
      ingress = await serveWebhooks([{ path, provider: lazy, ...(opts.body ? { body: opts.body } : {}) }])
    }
    const webhookUrl = ingress ? ingress.webhook(path) : ''
    provider = makeProvider(sim, { webhookUrl })
    if (ingress) sim.setWebhook(webhookUrl)
    bot = opts.createBot ? await opts.createBot(provider) : new Bot({ ...(opts.bot ?? {}), provider })
    await setup(bot, provider)
    if (opts.start !== false) await bot.start()
  } catch (err) {
    // Undo what this call set up, newest first; a simulator the caller started keeps running.
    await bot?.stop().catch(() => undefined)
    await ingress?.close().catch(() => undefined)
    if (startedSim) await sim.stop().catch(() => undefined)
    throw err
  }
  const started = bot
  return {
    sim,
    provider: provider!,
    bot: started,
    ...(ingress ? { ingress } : {}),
    async stop() {
      await started.stop().catch(() => undefined)
      await ingress?.close()
      await sim.stop()
    },
  }
}
