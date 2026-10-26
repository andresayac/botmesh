/**
 * `botmesh/require-timeout-on-ask` — every wait for user input should set its
 * timeout on purpose. Without one the wait falls back to the bot's
 * `conversation.timeout`, else the built-in 5 minutes, which is rarely what a
 * long form or a quick yes/no wants; and a timeout of `0` disables it, so an
 * abandoned conversation stays open (capturing that user's messages) until a
 * command such as `/reset`.
 *
 * - Flow DSL: `flow(...).ask(text, key, { timeout })`,
 *   `.choose(prompt, options, key, { timeout })`, `.form(definition, { timeout })`,
 *   or a `.timeout(...)` anywhere on the same chain (unless `allowFlowTimeout: false`).
 * - Conversations: `c.ask(text, { timeout })`, `c.waitText({ timeout })`,
 *   `c.waitMedia(types, { timeout })`, `c.waitLocation({ timeout })`,
 *   `c.choose(prompt, options, { timeout })` and `c.waitAny({ timeoutMs })`
 *   (milliseconds; `waitAny` ignores a `timeout` key).
 *
 * When the options argument is not an object literal (a variable, a call) or
 * holds a spread, the rule cannot see inside it and stays quiet.
 *
 * Options: `{ methods?: string[], allowFlowTimeout?: boolean }`. `methods`
 * defaults to `['ask']`; add `'waitText'`, `'waitMedia'`, `'waitLocation'`,
 * `'choose'`, `'waitAny'` and `'form'` for a stricter check.
 */

import type { Rule } from 'eslint'
import type * as ESTree from 'estree'

import { calleeName, chainCalls, findProperty, isFlowChain } from '../utils.js'

interface Options {
  methods?: string[]
  allowFlowTimeout?: boolean
}

/** Every wait the rule knows (the `methods` option accepts these). */
const WAIT_METHODS = ['ask', 'waitText', 'waitMedia', 'waitLocation', 'choose', 'waitAny', 'form']

/** Index of the options argument of each conversation-control wait. */
const CONTROL_OPTS_INDEX: Record<string, number> = { ask: 1, waitText: 0, waitMedia: 1, waitLocation: 0, choose: 2, waitAny: 0 }
/** Flow-DSL waits → index of their options argument. */
const FLOW_OPTS_INDEX: Record<string, number> = { ask: 2, choose: 3, form: 1 }

/** A literal that sets a zero timeout (`0`, `'0'`, `'0s'`, `'0 ms'`…), as source text; else undefined. */
function zeroLiteral(node: ESTree.Node | undefined): string | undefined {
  if (!node || node.type !== 'Literal') return undefined
  if (node.value === 0) return '0'
  if (typeof node.value === 'string' && /^\s*0+(?:\.0+)?\s*[a-z]*\s*$/i.test(node.value)) return `'${node.value}'`
  return undefined
}

type TimeoutCheck =
  | { kind: 'set' } // a timeout (or options the rule cannot inspect)
  | { kind: 'missing' }
  | { kind: 'zero'; value: string }
  | { kind: 'wrongKey' } // waitAny({ timeout }) — ignored at runtime

export const requireTimeoutOnAsk: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Require an explicit, non-zero timeout on ask()/choose()/wait*()/form() waits',
      recommended: true,
      url: 'https://andresayac.github.io/botmesh/guide/eslint#botmesh-require-timeout-on-ask',
    },
    schema: [
      {
        type: 'object',
        properties: {
          methods: {
            type: 'array',
            items: { type: 'string', enum: WAIT_METHODS },
            uniqueItems: true,
          },
          allowFlowTimeout: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      missing:
        '`{{method}}()` waits for the user without an explicit timeout, so it falls back to the bot\'s ' +
        '`conversation.timeout` or the built-in 5 minutes. Pass `{{example}}`{{flowHint}}.',
      neverExpires:
        '`{{method}}()` has a timeout of {{value}}, which never expires: a user who stops answering keeps the ' +
        'conversation open (capturing their messages) until a command such as /reset. Use a positive duration such as \'5m\'.',
      waitAnyTimeout:
        '`waitAny()` reads `timeoutMs` (milliseconds), not `timeout`: this option is ignored and the wait falls back ' +
        'to the default. Pass `{ timeoutMs: 300_000 }`.',
    },
  },
  create(context) {
    const options = (context.options[0] ?? {}) as Options
    const methods = new Set(options.methods ?? ['ask'])
    const allowFlowTimeout = options.allowFlowTimeout !== false

    const inspect = (arg: ESTree.Node | undefined, key: 'timeout' | 'timeoutMs'): TimeoutCheck => {
      if (!arg) return { kind: 'missing' }
      if (arg.type !== 'ObjectExpression') return { kind: 'set' }
      if (arg.properties.some((p) => p.type === 'SpreadElement')) return { kind: 'set' }
      const prop = findProperty(arg, key)
      if (prop) {
        const zero = zeroLiteral(prop.value)
        return zero ? { kind: 'zero', value: zero } : { kind: 'set' }
      }
      if (key === 'timeoutMs' && findProperty(arg, 'timeout')) return { kind: 'wrongKey' }
      return { kind: 'missing' }
    }

    const report = (node: ESTree.CallExpression, method: string, check: TimeoutCheck, flow: boolean): void => {
      const at = (node.callee as ESTree.MemberExpression).property
      if (check.kind === 'zero') {
        context.report({ node: at, messageId: 'neverExpires', data: { method, value: check.value } })
      } else if (check.kind === 'wrongKey') {
        context.report({ node: at, messageId: 'waitAnyTimeout' })
      } else if (check.kind === 'missing') {
        context.report({
          node: at,
          messageId: 'missing',
          data: {
            method,
            example: method === 'waitAny' ? '{ timeoutMs: 300_000 }' : "{ timeout: '5m' }",
            flowHint: flow && allowFlowTimeout ? " or add `.timeout('10m')` to the flow" : '',
          },
        })
      }
    }

    return {
      CallExpression(node: ESTree.CallExpression) {
        if (node.callee.type !== 'MemberExpression') return
        const method = calleeName(node)
        if (!method || !methods.has(method)) return

        if (isFlowChain(node)) {
          const idx = FLOW_OPTS_INDEX[method]
          if (idx === undefined) return
          let check = inspect(node.arguments[idx], 'timeout')
          if (check.kind === 'missing' && allowFlowTimeout) {
            const flowTimeout = chainCalls(node).find((c) => c.callee.type === 'MemberExpression' && calleeName(c) === 'timeout')
            if (flowTimeout) {
              const zero = zeroLiteral(flowTimeout.arguments[0])
              check = zero ? { kind: 'zero', value: zero } : { kind: 'set' }
            }
          }
          report(node, method, check, true)
          return
        }

        const idx = CONTROL_OPTS_INDEX[method]
        if (idx === undefined) return
        report(node, method, inspect(node.arguments[idx], method === 'waitAny' ? 'timeoutMs' : 'timeout'), false)
      },
    }
  },
}
