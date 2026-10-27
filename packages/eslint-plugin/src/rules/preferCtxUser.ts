/**
 * `botmesh/prefer-ctx-user-over-global-state` — per-user data belongs in
 * `ctx.user` (persistent, keyed by the provider-resolved sender, shared by
 * every replica through the store), not in a v1 `globalState` nor in a
 * module-level `Map`/object keyed by `ctx.from` / `ctx.sender`, which is lost
 * on restart, grows forever and breaks with several replicas.
 *
 * Writes keyed by the sender (`set`/`add`/`delete`, `x[ctx.from] = …`,
 * `x[ctx.from].n++`, `delete x[ctx.from]`) are always reported. Reads
 * (`get`/`has`, `x[ctx.from]`) are reported only when the binding is also
 * mutated inside some function: a constant allow/deny list
 * (`ADMINS.has(ctx.from)`), even one filled at module level, holds no
 * per-user state.
 *
 * Options: `{ contextNames?: string[] }` — names of the handler context
 * parameter (default `['ctx']`).
 */

import type { Rule, Scope } from 'eslint'
import type * as ESTree from 'estree'

import { memberPropertyName, unwrapChain, type NodeWithParent } from '../utils.js'

interface Options {
  contextNames?: string[]
}

const ID_PROPS = new Set(['from', 'sender', 'senderId'])
/** Keyed calls that write per-user state. */
const WRITE_METHODS = new Set(['set', 'add', 'delete'])
/** Keyed calls that only read. */
const READ_METHODS = new Set(['get', 'has'])
/** Calls that mutate a Map/Set/object, whatever their argument. */
const MUTATING_METHODS = new Set(['set', 'add', 'delete', 'clear'])

/** Is `node` (or the member chain it starts) the target of an assignment, update or `delete`? */
function isWriteTarget(node: NodeWithParent): boolean {
  let current = node
  for (;;) {
    const parent = current.parent
    if (!parent) return false
    if (parent.type === 'AssignmentExpression') return parent.left === current
    if (parent.type === 'UpdateExpression') return true
    if (parent.type === 'UnaryExpression') return parent.operator === 'delete'
    if (parent.type === 'ChainExpression') {
      current = parent
      continue
    }
    if (parent.type === 'MemberExpression' && parent.object === current) {
      current = parent
      continue
    }
    return false
  }
}

/** Does the reference sit inside a function (a handler), not in module-level set-up code? */
function inFunction(ref: Scope.Reference): boolean {
  for (let scope: Scope.Scope | null = ref.from; scope; scope = scope.upper) {
    if (scope.type === 'function') return true
  }
  return false
}

/** Is the variable reassigned or mutated (`set`/`add`/`delete`/`clear`, member write) inside a function? */
function mutatedInFunction(variable: Scope.Variable): boolean {
  return variable.references.some((ref) => {
    if (!inFunction(ref)) return false
    if (ref.isWrite() && !ref.init) return true
    const id = ref.identifier as ESTree.Identifier & { parent?: NodeWithParent }
    const member = id.parent
    if (!member || member.type !== 'MemberExpression' || member.object !== id) return false
    const call = member.parent
    if (call && call.type === 'CallExpression' && call.callee === member) {
      const method = memberPropertyName(member)
      return !!method && MUTATING_METHODS.has(method)
    }
    return isWriteTarget(member)
  })
}

export const preferCtxUser: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Prefer ctx.user over globalState or module-level maps keyed by sender/chat id',
      recommended: true,
      url: 'https://botmesh.afaya.com.co/guide/eslint#botmesh/prefer-ctx-user-over-global-state',
    },
    schema: [
      {
        type: 'object',
        properties: { contextNames: { type: 'array', items: { type: 'string' }, uniqueItems: true } },
        additionalProperties: false,
      },
    ],
    messages: {
      globalState:
        '`globalState` is v1 API. Keep per-user data in `ctx.user` (`await ctx.user.set(key, value)`) and per-conversation data in `c.state`.',
      moduleMap:
        '`{{name}}` is module-level state keyed by `{{key}}`: it is lost on restart and not shared between replicas. ' +
        "Use `ctx.user` (e.g. `await ctx.user.ns('feature').set(key, value)`).",
    },
  },
  create(context) {
    const options = (context.options[0] ?? {}) as Options
    const ctxNames = new Set(options.contextNames ?? ['ctx'])
    const sourceCode = context.sourceCode

    /** `ctx.from` / `ctx.sender` / `ctx.senderId` → its text, else undefined. */
    const idKey = (key: ESTree.Node | undefined): string | undefined => {
      const node = key && unwrapChain(key) // `ctx?.from`
      if (!node || node.type !== 'MemberExpression' || node.object.type !== 'Identifier') return undefined
      const prop = memberPropertyName(node)
      if (!prop || !ID_PROPS.has(prop) || !ctxNames.has(node.object.name)) return undefined
      return node.object.name + '.' + prop
    }

    /** The top-level (module/global) variable the identifier resolves to, else undefined. */
    const moduleVariable = (id: ESTree.Identifier, at: ESTree.Node): Scope.Variable | undefined => {
      let scope: Scope.Scope | null = sourceCode.getScope(at)
      while (scope) {
        const variable = scope.set.get(id.name)
        if (variable) return scope.type === 'module' || scope.type === 'global' ? variable : undefined
        scope = scope.upper
      }
      return undefined
    }

    /** Keyed reads, reported at the end only if their binding is mutated in a function. */
    const reads: { node: ESTree.Node; variable: Scope.Variable; key: string }[] = []

    const report = (node: ESTree.Node, name: string, key: string) =>
      context.report({ node, messageId: 'moduleMap', data: { name, key } })

    return {
      Identifier(node: ESTree.Identifier & Rule.NodeParentExtension) {
        if (node.name !== 'globalState') return
        const parent = node.parent
        // Skip `obj.globalState` member names and non-shorthand `{ globalState: x }` keys.
        if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return
        if (parent.type === 'Property' && parent.key === node && !parent.shorthand) return
        // A shorthand `{ globalState }` visits the same identifier as key and value: report once.
        if (parent.type === 'Property' && parent.shorthand && parent.value !== node) return
        context.report({ node, messageId: 'globalState' })
      },
      // users.set(ctx.sender, …) / seen.add(ctx.from) / users.get(ctx.from)
      CallExpression(node: ESTree.CallExpression) {
        const callee = node.callee
        if (callee.type !== 'MemberExpression' || callee.object.type !== 'Identifier') return
        const method = memberPropertyName(callee)
        const write = !!method && WRITE_METHODS.has(method)
        if (!write && !(method && READ_METHODS.has(method))) return
        const key = idKey(node.arguments[0])
        const variable = key && moduleVariable(callee.object, node)
        if (!key || !variable) return
        if (write) report(node, callee.object.name, key)
        else reads.push({ node, variable, key })
      },
      // users[ctx.from] = … / users[ctx.from].count++ / users[ctx.from]
      MemberExpression(node: ESTree.MemberExpression & Rule.NodeParentExtension) {
        if (!node.computed || node.object.type !== 'Identifier') return
        const key = idKey(node.property)
        const variable = key && moduleVariable(node.object, node)
        if (!key || !variable) return
        if (isWriteTarget(node as NodeWithParent)) report(node, node.object.name, key)
        else reads.push({ node, variable, key })
      },
      'Program:exit'() {
        for (const read of reads) {
          if (mutatedInFunction(read.variable)) report(read.node, read.variable.name, read.key)
        }
      },
    }
  },
}
