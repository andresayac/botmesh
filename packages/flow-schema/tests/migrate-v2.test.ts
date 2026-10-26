/**
 * Version 2 of the flow document format: `retries` on `ask` / `form` steps now means the
 * retries AFTER the first answer (core `WaitOptions`). A v1 document meant total answers,
 * so the 1 → 2 migration rewrites `retries: N` to `maxAttempts: N` (an old `retries: 0`
 * behaved like 1). Loading paths (validate, compile, artifacts) upgrade v1 documents
 * transparently, so published v1 flows keep their behaviour.
 */
import { describe, expect, it } from 'vitest'
import { createTestBot } from '@botmesh/core/testing'

import {
  FLOW_DOCUMENT_VERSION,
  compileFlowDocument,
  flowFromArtifact,
  isFlowDocument,
  migrateFlowDocument,
  validateFlowDocument,
} from '../src/index.js'

const v1 = () => ({
  version: 1,
  id: 'signup',
  trigger: 'go',
  steps: [
    { kind: 'ask', text: 'Q?', stateKey: 'a', retries: 2, validate: { expr: '$body == "ok"', message: 'again' } },
    { kind: 'condition', if: 'true', then: [{ kind: 'ask', text: 'Z?', stateKey: 'z', retries: 0 }] },
    { kind: 'choose', text: 'Pick', options: [{ key: '1', label: 'One', steps: [{ kind: 'ask', text: 'Y?', stateKey: 'y', retries: 5 }] }] },
    { kind: 'form', form: { id: 'f', fields: [{ name: 'n', label: 'Name', type: 'text' }] }, retries: 3 },
    { kind: 'say', text: 'done' },
  ],
})

describe('flow document v2 (retries meaning)', () => {
  it('is the current version', () => {
    expect(FLOW_DOCUMENT_VERSION).toBe(2)
  })

  it('migrates v1 retries: N to maxAttempts: N, nested steps included', () => {
    const { document, applied } = migrateFlowDocument(v1())
    expect(applied).toEqual([{ from: 1, to: 2 }])
    expect(document.version).toBe(2)
    const steps = document.steps as any[]
    expect(steps[0]).toMatchObject({ maxAttempts: 2 })
    expect(steps[0]).not.toHaveProperty('retries')
    expect(steps[1].then[0]).toMatchObject({ maxAttempts: 1 })
    expect(steps[1].then[0]).not.toHaveProperty('retries')
    expect(steps[2].options[0].steps[0]).toMatchObject({ maxAttempts: 5 })
    expect(steps[3]).toMatchObject({ maxAttempts: 3 })
    expect(steps[3]).not.toHaveProperty('retries')
    expect(validateFlowDocument(document)).toEqual([])
  })

  it('a v2 document keeps retries with its new meaning', () => {
    const doc = { ...v1(), version: 2 }
    const { document, applied } = migrateFlowDocument(doc)
    expect(applied).toEqual([])
    expect((document.steps as any[])[0].retries).toBe(2)
  })

  it('validates v1 documents through the migration; the type guard is strict', () => {
    expect(validateFlowDocument(v1())).toEqual([])
    expect(isFlowDocument(v1())).toBe(false)
    expect(isFlowDocument(migrateFlowDocument(v1()).document)).toBe(true)
  })

  it('reads a v1 artifact as the migrated v2 document', () => {
    const doc = flowFromArtifact(JSON.stringify(v1()))
    expect(doc.version).toBe(2)
    expect((doc.steps as any[])[0].maxAttempts).toBe(2)
  })

  it('a compiled v1 document keeps its old budget (retries: 2 = 2 answers in total)', async () => {
    const { bot, chat } = await createTestBot()
    bot.registerFlow(compileFlowDocument(v1()))
    await chat.send('go')
    await chat.expectReply('Q?')
    await chat.send('bad 1')
    await chat.expectReply('again')
    await chat.send('bad 2')
    await chat.expectReply(/Too many attempts/)
    await bot.stop()
  })
})
