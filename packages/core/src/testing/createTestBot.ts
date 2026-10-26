/**
 * createTestBot — spin up a {@link Bot} wired to a {@link MockProvider} for tests.
 *
 * No sockets, no filesystem. The returned `chat` drives one DM (`user@s.whatsapp.net`)
 * and asserts on what the bot sent back; `dm()` and `group()` open other chats and
 * `chat.as(userId)` is the same chat seen by another participant.
 *
 * @example
 * ```ts
 * const { bot, chat } = await createTestBot()
 * bot.when('hola', async (ctx) => await ctx.reply('👋'))
 * await chat.send('hola')
 * await chat.expectReply('👋')
 * await chat.expectNoReply()
 * expect(chat.transcript()).toMatchSnapshot()
 * ```
 *
 * Pass a {@link defineBot} factory instead of a config to test the bot module you
 * ship: `await createTestBot(createBot)` builds it around the MockProvider.
 *
 * Pass `{ chaos }` to put a seeded {@link ChaosProvider} between the mock and
 * the bot (duplicates, reordering, latency, send failures, drops, aliases):
 *
 * ```ts
 * const { bot, provider, chaos } = await createTestBot({}, { chaos: { seed: 7, duplicates: 1 } })
 * provider.incoming('hola')   // drive the mock as usual; chaos sits in between
 * await chaos.settle()
 * ```
 */

import { Bot } from '../core/Bot.js'
import { MockProvider, type MockProviderOptions } from './MockProvider.js'
import { ChaosProvider, type ChaosOptions } from './chaos.js'
import { DEFAULT_TEST_USER, TestChatFactory, type TestChat } from './testChat.js'
import type { BotConfig, IProvider } from '../core/provider.js'
import type { BotFactory } from '../dev/defineBot.js'

export type { TestChat } from './testChat.js'

/**
 * Extra knobs for {@link createTestBot}.
 *
 * @category Test bot
 */
export interface CreateTestBotOptions {
  /** Wrap the MockProvider in a {@link ChaosProvider} with these options. */
  chaos?: ChaosOptions
  /** Options for the underlying {@link MockProvider} (e.g. `{ streaming: 'edit' }`). */
  provider?: MockProviderOptions
}

/**
 * What {@link createTestBot} returns.
 *
 * @category Test bot
 */
export interface TestBot {
  bot: Bot
  /** The MockProvider (drive inbound traffic and read `outbox` / `journal` here). */
  provider: MockProvider
  /** The default DM (`user@s.whatsapp.net`). */
  chat: TestChat
  /** The chaos wrapper the bot talks to — present only when `options.chaos` was given. */
  chaos?: ChaosProvider<MockProvider>
  /** Another DM chat (`chatId === senderId === userId`). */
  dm(userId: string, opts?: { displayName?: string }): TestChat
  /** A group chat driven by participant `as` (default `'user@s.whatsapp.net'`); `chat.as(other)` adds participants. */
  group(groupId: string, opts?: { as?: string; displayName?: string }): TestChat
}

/**
 * Starts a {@link Bot} on a {@link MockProvider}: no network and no phone. Resolves to
 * the bot, the provider and chat helpers that send inbound messages and check the replies.
 * `options.chaos` wraps the provider in a {@link ChaosProvider}.
 *
 * @example
 * ```ts
 * import { createTestBot } from '@botmesh/core/testing'
 *
 * const { bot, chat } = await createTestBot()
 * bot.when('hi', (ctx) => ctx.reply('Hello!'))
 *
 * await chat.send('hi')
 * await chat.expectReply('Hello!')
 * await bot.stop()
 * ```
 *
 * @category Test bot
 */
export async function createTestBot(config?: Omit<BotConfig, 'provider'>, options?: CreateTestBotOptions & { chaos?: undefined }): Promise<TestBot>
export async function createTestBot(
  config: Omit<BotConfig, 'provider'> | undefined,
  options: CreateTestBotOptions & { chaos: ChaosOptions },
): Promise<TestBot & { chaos: ChaosProvider<MockProvider> }>
/**
 * Test the bot a {@link defineBot} factory builds: the factory is called with the
 * {@link MockProvider} (or its chaos wrapper) and the bot it returns is started.
 *
 * @example
 * ```ts
 * import createBot from '../src/bot.js'
 *
 * const { bot, chat } = await createTestBot(createBot)
 * await chat.send('hola')
 * await chat.expectReply(/Hola/)
 * await bot.stop()
 * ```
 *
 * @throws {TypeError} when the factory does not return a Bot built around the provider it was given.
 */
export async function createTestBot(factory: BotFactory, options?: CreateTestBotOptions & { chaos?: undefined }): Promise<TestBot>
export async function createTestBot(
  factory: BotFactory,
  options: CreateTestBotOptions & { chaos: ChaosOptions },
): Promise<TestBot & { chaos: ChaosProvider<MockProvider> }>
export async function createTestBot(
  configOrFactory: Omit<BotConfig, 'provider'> | BotFactory = {},
  options: CreateTestBotOptions = {},
): Promise<TestBot> {
  const provider = new MockProvider(options.provider)
  const chaos = options.chaos ? new ChaosProvider(provider, options.chaos) : undefined
  const transport = chaos ?? provider
  const bot = typeof configOrFactory === 'function'
    ? await fromFactory(configOrFactory, transport)
    : new Bot({ ...configOrFactory, provider: transport })
  await bot.start()

  const chats = new TestChatFactory(provider)
  const base: TestBot = {
    bot,
    provider,
    chat: chats.dm(DEFAULT_TEST_USER),
    dm: (userId, opts) => chats.dm(userId, opts),
    group: (groupId, opts) => chats.group(groupId, opts),
  }
  return chaos ? { ...base, chaos } : base
}

/** Build the bot of a `defineBot` factory around `provider`, refusing one built on another provider. */
async function fromFactory(factory: BotFactory, provider: IProvider): Promise<Bot> {
  const bot: unknown = await factory(provider)
  const candidate = bot as Partial<Pick<Bot, 'start' | 'getProvider'>> | null
  if (typeof candidate?.start !== 'function' || typeof candidate.getProvider !== 'function') {
    throw new TypeError('createTestBot(factory): the factory must return the Bot it built: defineBot((provider) => new Bot({ provider }))')
  }
  if (candidate.getProvider() !== provider) {
    throw new TypeError(
      'createTestBot(factory): the bot was built with its own provider; build it with the provider the factory receives: ' +
        'defineBot((provider) => new Bot({ provider }))',
    )
  }
  return bot as Bot
}
