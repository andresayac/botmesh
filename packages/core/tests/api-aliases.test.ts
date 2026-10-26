/**
 * One canonical name per concept (docs/release-readiness.md, "API freeze"): every other
 * spelling stays callable but is tagged `@deprecated` with its replacement in the TSDoc,
 * and the canonical names are never tagged.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createTestBot } from '../src/testing/createTestBot.js'
import { addKeyword, flow } from '../src/index.js'

const src = join(dirname(fileURLToPath(import.meta.url)), '../src')
const read = (file: string) => readFileSync(join(src, file), 'utf8')

/** The TSDoc block right before the declaration of `member` (a method, property or overload). */
function docOf(source: string, member: RegExp): string[] {
  const docs: string[] = []
  const re = new RegExp(String.raw`(\/\*\*(?:(?!\*\/)[\s\S])*\*\/)\s*` + member.source, 'g')
  for (const m of source.matchAll(re)) docs.push(m[1]!)
  return docs
}

const DEPRECATED_MEMBERS: Array<[file: string, member: RegExp, replacement: RegExp]> = [
  ['core/provider.ts', /say\(text: string/, /ctx\.reply/],
  ['core/provider.ts', /answer\(text: string/, /ctx\.reply/],
  ['core/provider.ts', /text\(t: string/, /ctx\.reply/],
  ['core/Bot.ts', /async sendText\(/, /bot\.send/],
  ['core/Bot.ts', /sendTo\(chatId/, /bot\.send/],
  ['core/Bot.ts', /useFlow\(/, /bot\.use/],
  ['core/Bot.ts', /triggerFlow\(id/, /bot\.trigger/],
  ['core/Bot.ts', /enterConversation\(name: string/, /bot\.trigger/],
  ['core/Bot.ts', /use\(item: Plugin/, /bot\.plug/],
  ['core/Bot.ts', /onImage\(/, /onType\('image'/],
  ['core/Bot.ts', /onAudio\(/, /onType\('audio'/],
  ['core/Bot.ts', /onVideo\(/, /onType\('video'/],
  ['core/Bot.ts', /onDocument\(/, /onType\('document'/],
  ['core/Bot.ts', /onSticker\(/, /onType\('sticker'/],
  ['core/Bot.ts', /onLocation\(/, /onType\('location'/],
  ['core/Bot.ts', /onContact\(/, /onType\('contact'/],
  ['core/Bot.ts', /onPoll\(/, /onType\('poll'/],
  ['flows/FlowBuilder.ts', /export const addKeyword/, /flow/],
  ['durability/types.ts', /journal\?: DurabilityBackend/, /backend/],
  ['core/provider.ts', /storeConfig\?:/, /store: new MemoryStore/],
  ['index.ts', /export type Config\b/, /BotConfig/],
  ['index.ts', /ConversationFn,\s*\} from '\.\/conversations\/ConversationRuntime\.js'/, /ConversationHandler/],
  ['index.ts', /Whitelist,\s*\} from '\.\/gates\/accessList\.js'/, /bot\.whitelist/],
]

const CANONICAL_MEMBERS: Array<[file: string, member: RegExp]> = [
  ['core/provider.ts', /reply\(text: string/],
  ['core/Bot.ts', /async send\(chatId/],
  ['core/Bot.ts', /use\(flow: FlowBuilder/],
  ['core/Bot.ts', /plug\(plugin: Plugin/],
  ['core/Bot.ts', /trigger\(name: string/],
  ['core/Bot.ts', /registerFlow\(flow/],
  ['core/Bot.ts', /when\(trigger: Trigger/],
  ['core/Bot.ts', /onType\(type: MessageType/],
  ['core/Bot.ts', /enterConversation\(handler: ConversationHandler/],
  ['durability/types.ts', /backend\?: DurabilityBackend/],
]

describe('API aliases', () => {
  it.each(DEPRECATED_MEMBERS)('%s %s is @deprecated and names its replacement', (file, member, replacement) => {
    const docs = docOf(read(file), member)
    expect(docs.length, String(member)).toBeGreaterThan(0)
    for (const doc of docs) {
      expect(doc, String(member)).toMatch(/@deprecated/)
      expect(doc.slice(doc.indexOf('@deprecated')), String(member)).toMatch(replacement)
    }
  })

  it.each(CANONICAL_MEMBERS)('%s %s (canonical) is not deprecated', (file, member) => {
    const docs = docOf(read(file), member)
    expect(docs.length, String(member)).toBeGreaterThan(0)
    for (const doc of docs) expect(doc, String(member)).not.toMatch(/@deprecated/)
  })

  it('the deprecated aliases still behave like their canonical names', async () => {
    expect(addKeyword).toBe(flow)
    const { bot, provider } = await createTestBot()
    bot.when('hi', async (ctx) => { await ctx.say('a'); await ctx.answer('b'); await ctx.text('c') })
    await bot.sendText('u1', 'd')
    await bot.sendTo('u1', 'e')
    provider.incoming('hi', { from: 'u1' })
    await new Promise((r) => setTimeout(r, 50))
    expect(provider.outbox.map((m) => (m.content.kind === 'text' ? m.content.text : m.content.kind)).sort())
      .toEqual(['a', 'b', 'c', 'd', 'e'])
    await bot.stop()
  })
})
