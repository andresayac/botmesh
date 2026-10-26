/** `BotConfig.storeConfig` is deprecated in favour of `store: new MemoryStore({ ... })`. */
import { describe, expect, it } from 'vitest'
import { Bot, MemoryStore, type BotConfig, type LoggerLike } from '../src/index.js'
import { MockProvider } from '../src/testing/index.js'

function capture(): LoggerLike & { warns: unknown[][] } {
  const warns: unknown[][] = []
  const noop = () => {}
  const l = { debug: noop, info: noop, error: noop, warn: (...a: unknown[]) => { warns.push(a) }, child: () => l, warns }
  return l
}

const text = (warns: unknown[][]) => warns.map((a) => a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')).join('\n')

describe('BotConfig.storeConfig (deprecated)', () => {
  it('still configures the built-in MemoryStore, and warns once with the replacement', async () => {
    const logger = capture()
    const config: BotConfig = { provider: new MockProvider(), logger, storeConfig: { maxMessagesPerChat: 2 } }
    const bot = new Bot(config)
    await bot.start()
    for (const id of ['a', 'b', 'c']) {
      await bot.getStore().saveMessage({ ref: { chatId: 'u1', id }, chatId: 'u1', body: id, type: 'text', timestamp: 1 })
    }
    expect((await bot.getStore().getMessagesByChat('u1', 10)).map((m) => m.body)).toEqual(['b', 'c'])
    expect(text(logger.warns)).toMatch(/storeConfig is deprecated.*store: new MemoryStore\(/)
    expect(logger.warns).toHaveLength(1)
    await bot.stop()
  })

  it('warns that it is ignored when an IStore instance is passed as store', async () => {
    const logger = capture()
    const bot = new Bot({ provider: new MockProvider(), logger, store: new MemoryStore(), storeConfig: { file: './x.json' } })
    expect(text(logger.warns)).toMatch(/storeConfig is ignored.*store/)
    await bot.stop()
  })

  it('says nothing when storeConfig is not set', async () => {
    const logger = capture()
    const bot = new Bot({ provider: new MockProvider(), logger, store: new MemoryStore() })
    expect(text(logger.warns)).not.toMatch(/storeConfig/)
    await bot.stop()
  })
})
