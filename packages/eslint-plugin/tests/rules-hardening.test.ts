/**
 * Cases found by the beta release audit: shapes of the real @botmesh API the
 * rules got wrong (false positives on correct code, false negatives on code
 * that does not do what it looks like).
 */
import { Linter, RuleTester } from 'eslint'
import { describe, expect, it } from 'vitest'

import { configs, rules } from '../src/index.js'

RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2024, sourceType: 'module' } })

const rule = (name: string) => {
  const r = rules[name]
  if (!r) throw new Error('missing rule ' + name)
  return r
}

const ALL = ['ask', 'waitText', 'waitMedia', 'choose', 'waitAny', 'waitLocation', 'form']

tester.run('require-timeout-on-ask (real API shapes)', rule('require-timeout-on-ask'), {
  valid: [
    // A flow `.choose(prompt, options, stateKey, opts)` takes a per-step `{ timeout }` (ChooseStepOptions).
    { code: "flow('m').choose('Pick', { a: 'A' }, 'k', { timeout: '5m' })", options: [{ methods: ALL }] },
    // `c.waitAny()` reads `timeoutMs`, not `timeout`.
    { code: "bot.conversation('x', async (c) => { await c.waitAny({ timeoutMs: 60_000 }) })", options: [{ methods: ALL }] },
    { code: "bot.conversation('x', async (c) => { await c.waitLocation({ timeout: '2m' }) })", options: [{ methods: ALL }] },
    { code: "flow('f').form(def, { timeout: '10m' })", options: [{ methods: ALL }] },
    { code: "flow('f').form(def).timeout('10m')", options: [{ methods: ALL }] },
    // Not in the default method list.
    "bot.conversation('x', async (c) => { await c.waitLocation() })",
    "flow('f').form(def)",
  ],
  invalid: [
    {
      code: "bot.conversation('x', async (c) => { await c.waitAny() })",
      options: [{ methods: ALL }],
      errors: [{ messageId: 'missing', data: { method: 'waitAny', example: '{ timeoutMs: 300_000 }', flowHint: '' } }],
    },
    {
      code: "bot.conversation('x', async (c) => { await c.waitAny({ timeout: '5m' }) })",
      options: [{ methods: ALL }],
      errors: [{ messageId: 'waitAnyTimeout' }],
    },
    {
      code: "bot.conversation('x', async (c) => { await c.waitLocation({ otherwise: 'Send it' }) })",
      options: [{ methods: ALL }],
      errors: [{ messageId: 'missing', data: { method: 'waitLocation', example: "{ timeout: '5m' }", flowHint: '' } }],
    },
    {
      code: "flow('f').form(def, { flatten: true })",
      options: [{ methods: ALL }],
      errors: [{ messageId: 'missing', data: { method: 'form', example: "{ timeout: '5m' }", flowHint: " or add `.timeout('10m')` to the flow" } }],
    },
    {
      code: "flow('m').choose('Pick', { a: 'A' }, 'k', { delay: '1s' })",
      options: [{ methods: ALL }],
      errors: [{ messageId: 'missing' }],
    },
    // A zero timeout disables it: the wait never expires.
    { code: "bot.conversation('x', async (c) => { await c.ask('?', { timeout: 0 }) })", errors: [{ messageId: 'neverExpires', data: { method: 'ask', value: '0' } }] },
    { code: "flow('a').ask('?', 'k', { timeout: '0s' })", errors: [{ messageId: 'neverExpires', data: { method: 'ask', value: "'0s'" } }] },
    { code: "flow('a').ask('?', 'k').timeout(0)", errors: [{ messageId: 'neverExpires', data: { method: 'ask', value: '0' } }] },
    {
      code: "bot.conversation('x', async (c) => { await c.waitAny({ timeoutMs: 0 }) })",
      options: [{ methods: ALL }],
      errors: [{ messageId: 'neverExpires', data: { method: 'waitAny', value: '0' } }],
    },
  ],
})

tester.run('no-await-runtime-enter (chains and optional calls)', rule('no-await-runtime-enter'), {
  valid: [
    'async function f() { return void runtime.enter(x).catch(onError) }',
    'async function f() { await runtime?.wait(x) }',
  ],
  invalid: [
    { code: 'async function f() { await runtime?.enter(x) }', errors: [{ messageId: 'awaited', data: { receiver: 'runtime' } }] },
    { code: 'async function f() { await this.runtime?.enter(x)?.catch(onError) }', errors: [{ messageId: 'awaited' }] },
    // Returning `.catch()`'s promise still makes the dispatcher wait for the whole conversation.
    { code: 'async function f() { return runtime.enter(x).catch(onError) }', errors: [{ messageId: 'awaited' }] },
    { code: "bot.when('x', () => runtime.enter(x).catch(onError))", errors: [{ messageId: 'awaited' }] },
    { code: "bot.when('x', () => runtime.enter(x).then(a).finally(b))", errors: [{ messageId: 'awaited' }] },
  ],
})

tester.run('prefer-ctx-user-over-global-state (optional chaining)', rule('prefer-ctx-user-over-global-state'), {
  valid: [],
  invalid: [
    { code: "const users = new Map(); bot.when('x', (ctx) => users.get(ctx?.from))", errors: [{ messageId: 'moduleMap', data: { name: 'users', key: 'ctx.from' } }] },
    { code: "const users = {}; bot.when('x', (ctx) => users[ctx?.sender])", errors: [{ messageId: 'moduleMap', data: { name: 'users', key: 'ctx.sender' } }] },
  ],
})

tester.run('no-empty-trigger (trigger-less sub-flows)', rule('no-empty-trigger'), {
  valid: [
    // `flow([])` is the documented idiom for a sub-flow with no trigger of its own
    // (run from a choose `then`, `.use()` or a goto); bot.lint() reports the unreachable ones.
    "const order = flow([]).choose('Size?', { s: 'S' }, 'size')",
    "flow('shop').choose('Ship?', { yes: { label: 'Yes', then: flow([]).ask('Street?', 'street', { timeout: '5m' }) } })",
    'addKeyword([])',
  ],
  invalid: [
    { code: "flow([''])", errors: [{ messageId: 'empty', data: { reason: 'an array of empty strings' } }] },
    { code: "bot.conversation('x', fn, { trigger: [] })", errors: [{ messageId: 'empty', data: { reason: 'an empty array' } }] },
  ],
})

describe('strict preset', () => {
  it('checks every wait of the real API, waitLocation and flow forms included', () => {
    const linter = new Linter({ configType: 'flat' })
    const code = [
      "bot.conversation('x', async (c) => {",
      '  await c.waitLocation()',
      '})',
      "bot.use(flow('f').form(def))",
    ].join('\n')
    const found = linter
      .verify(code, [{ languageOptions: { ecmaVersion: 'latest', sourceType: 'module' } }, configs.strict], 'bot.js')
      .map((m) => `${m.ruleId}:${m.line}`)
    expect(found).toEqual(['botmesh/require-timeout-on-ask:2', 'botmesh/require-timeout-on-ask:4'])
  })
})

describe('option errors', () => {
  it('an invalid receiverPattern names the rule, the option and the pattern', () => {
    const linter = new Linter({ configType: 'flat' })
    const run = () =>
      linter.verify(
        'async function f() { await runtime.enter(x) }',
        [{ plugins: { botmesh: { rules } }, rules: { 'botmesh/no-await-runtime-enter': ['error', { receiverPattern: '(' }] } }],
        'a.js',
      )
    expect(run).toThrow(/receiverPattern "\(" is not a valid regular expression/)
  })
})
