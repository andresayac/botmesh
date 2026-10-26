/**
 * Opt-in smoke test against a REAL Ollama server (skipped by default, like the store
 * integration suites). Run it with a pulled model:
 *
 *   BOTWA_TEST_OLLAMA_URL=http://127.0.0.1:11434 BOTWA_TEST_OLLAMA_MODEL=qwen2.5:0.5b \
 *     pnpm --filter @botmesh/ai exec vitest run tests/ollama-live.test.ts
 *
 * It only checks that the wiring works end to end (an answer arrives, streaming yields
 * text, a tool can be called); model quality is not asserted.
 */
import { describe, it, expect } from 'vitest'
import { createTestBot } from '@botmesh/core/testing'
import { aiPlugin } from '../src/plugin.js'
import { OllamaProvider } from '../src/providers/ollama.js'

const url = process.env.BOTWA_TEST_OLLAMA_URL
const model = process.env.BOTWA_TEST_OLLAMA_MODEL

describe.skipIf(!url || !model)('Ollama live smoke (BOTWA_TEST_OLLAMA_URL + BOTWA_TEST_OLLAMA_MODEL)', () => {
  it('the autoresponder answers through a real model', async () => {
    const t = await createTestBot()
    t.bot.plug(aiPlugin({ provider: 'ollama', baseUrl: url, model, timeoutMs: 120_000, persona: 'Answer in one short sentence.' }))
    await t.chat.send('Say hello.')
    const reply = await t.chat.expectReply(/\S/, 120_000)
    expect(reply.length).toBeGreaterThan(0)
    await t.bot.stop()
  }, 130_000)

  it('streams text from a real model', async () => {
    const p = new OllamaProvider({ baseUrl: url, model })
    let text = ''
    let stop: string | undefined
    for await (const piece of p.stream({ messages: [{ role: 'user', content: 'Count from 1 to 5.' }], onStreamEnd: (e) => { stop = e.stopReason } })) text += piece
    expect(text.trim().length).toBeGreaterThan(0)
    expect(stop).toBeDefined()
  }, 130_000)
})
