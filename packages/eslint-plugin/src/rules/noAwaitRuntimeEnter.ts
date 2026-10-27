/**
 * `botmesh/no-await-runtime-enter` — `ConversationRuntime.enter()` resolves when
 * the conversation ENDS, so awaiting it inside a handler blocks that chat's
 * FIFO queue (the user's next message, the one the conversation waits for,
 * never gets dispatched). Launch it fire-and-forget instead:
 * `void runtime.enter(...).catch(...)`.
 */

import type { Rule } from 'eslint'
import type * as ESTree from 'estree'

import { memberPropertyName, tailName, unwrapChain } from '../utils.js'

interface Options {
  /** Regex (source) the receiver name must match. Default: names ending in "runtime" (case-insensitive). */
  receiverPattern?: string
}

export const noAwaitRuntimeEnter: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow awaiting ConversationRuntime.enter() (it blocks the chat queue until the conversation ends)',
      recommended: true,
      url: 'https://botmesh.afaya.com.co/guide/eslint#botmesh/no-await-runtime-enter',
    },
    schema: [
      {
        type: 'object',
        properties: { receiverPattern: { type: 'string' } },
        additionalProperties: false,
      },
    ],
    messages: {
      awaited:
        '`{{receiver}}.enter()` resolves only when the conversation ends; awaiting it blocks this chat\'s queue. ' +
        'Launch it fire-and-forget: `void {{receiver}}.enter(...).catch(...)`.',
    },
  },
  create(context) {
    const options = (context.options[0] ?? {}) as Options
    const pattern = options.receiverPattern ?? 'runtime$'
    let receiverRe: RegExp
    try {
      receiverRe = new RegExp(pattern, 'i')
    } catch (error) {
      throw new TypeError(
        `botmesh/no-await-runtime-enter: receiverPattern ${JSON.stringify(pattern)} is not a valid regular expression ` +
          `(${(error as Error).message}). Pass a RegExp source such as "runtime$".`,
      )
    }

    const check = (node: ESTree.Node, reportNode: ESTree.Node) => {
      let expr = unwrapChain(node)
      // `runtime.enter(...).catch(...)` (or .then/.finally, optional calls too) still settles
      // only when the whole conversation does: look through the chain to the `enter()` call.
      for (;;) {
        if (expr.type !== 'CallExpression' || expr.callee.type !== 'MemberExpression') return
        const name = memberPropertyName(expr.callee)
        if (name === 'enter') break
        if (name !== 'then' && name !== 'catch' && name !== 'finally') return
        expr = unwrapChain(expr.callee.object)
      }
      const receiver = tailName(expr.callee.object)
      if (!receiver || !receiverRe.test(receiver)) return
      context.report({ node: reportNode, messageId: 'awaited', data: { receiver } })
    }

    return {
      AwaitExpression(node: ESTree.AwaitExpression) {
        check(node.argument, node)
      },
      // Returning the promise from a handler makes the dispatcher await it just the same.
      ReturnStatement(node: ESTree.ReturnStatement) {
        if (node.argument) check(node.argument, node)
      },
      ArrowFunctionExpression(node: ESTree.ArrowFunctionExpression) {
        if (node.body.type !== 'BlockStatement') check(node.body, node.body)
      },
    }
  },
}
