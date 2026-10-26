/**
 * Capability contract — a reusable check that a provider's `capabilities` agree with the
 * optional methods it exposes, so every channel follows one rule for unsupported
 * operations: an operation the transport cannot perform is **absent** (the optional
 * `IProvider` method is not defined and its capability flag is `false`), and `ctx.*` then
 * treats it as a no-op. A method that is present performs the operation, or rejects
 * (`UnsupportedContentError` / `ProviderError`) for a target it cannot handle; it is never
 * a silent no-op standing in for "not supported".
 *
 * Checked pairs: `typing()` ⇔ `capabilities.typing`, `markRead()` ⇔ `readReceipts`,
 * `editMessage()` ⇔ `edit`, `streaming: 'draft'` ⇒ `sendDraft()`; the feature flags
 * (`buttons`, `lists`, `polls`, `reactions`, `templates`) ⇒ the matching `contentKinds`;
 * `maxTextLength` / `maxTextBytes` are positive integers when set.
 *
 * @example
 * ```ts
 * import { assertCapabilityContract } from '@botmesh/core/testing'
 *
 * assertCapabilityContract(new MyProvider(config))
 * ```
 */

import type { IProvider, OutboundContent, ProviderCapabilities } from '../core/provider.js'

/** Machine-readable rule ids reported in {@link CapabilityViolation.rule}. */
export type CapabilityRule = 'typing' | 'read-receipts' | 'edit' | 'drafts' | 'content-kinds' | 'text-limit'

/** One disagreement between a provider's capabilities and its methods. */
export interface CapabilityViolation {
  rule: CapabilityRule
  /** Human-readable explanation. */
  message: string
}

/** Thrown by {@link assertCapabilityContract}; carries every violation found. */
export class CapabilityContractError extends Error {
  readonly violations: CapabilityViolation[]
  constructor(providerId: string, violations: CapabilityViolation[]) {
    super(
      `Capability contract violated by provider '${providerId}' (${violations.length} violation${violations.length === 1 ? '' : 's'}):\n` +
        violations.map((v) => `  - [${v.rule}] ${v.message}`).join('\n'),
    )
    this.name = 'CapabilityContractError'
    this.violations = violations
  }
}

type FlagKind = [keyof ProviderCapabilities, OutboundContent['kind']]
const FLAG_KINDS: FlagKind[] = [
  ['buttons', 'buttons'], ['lists', 'list'], ['polls', 'poll'], ['reactions', 'reaction'], ['templates', 'template'],
]

/** Check a provider instance against the capability contract; empty array = conforming. */
export function checkCapabilityContract(provider: Pick<IProvider, 'capabilities'> & Partial<IProvider>): CapabilityViolation[] {
  const caps = provider.capabilities
  const out: CapabilityViolation[] = []
  const pair = (rule: CapabilityRule, method: keyof IProvider, flag: keyof ProviderCapabilities): void => {
    const has = typeof provider[method] === 'function'
    const on = caps[flag] === true
    if (has && !on) out.push({ rule, message: `${String(method)}() is defined but capabilities.${String(flag)} is false: remove the method, or set the flag if the transport supports it` })
    if (!has && on) out.push({ rule, message: `capabilities.${String(flag)} is true but ${String(method)}() is not defined` })
  }
  pair('typing', 'typing', 'typing')
  pair('read-receipts', 'markRead', 'readReceipts')
  pair('edit', 'editMessage', 'edit')
  if (caps.streaming === 'draft' && typeof provider.sendDraft !== 'function') {
    out.push({ rule: 'drafts', message: "capabilities.streaming is 'draft' but sendDraft() is not defined" })
  }
  const kinds = new Set<string>(Array.isArray(caps.contentKinds) ? caps.contentKinds : [])
  if (kinds.size === 0) out.push({ rule: 'content-kinds', message: 'capabilities.contentKinds is empty' })
  for (const [flag, kind] of FLAG_KINDS) {
    if (caps[flag] === true && !kinds.has(kind)) out.push({ rule: 'content-kinds', message: `capabilities.${String(flag)} is true but contentKinds lacks '${kind}'` })
  }
  for (const field of ['maxTextLength', 'maxTextBytes'] as const) {
    const v = caps[field]
    if (v !== undefined && !(Number.isSafeInteger(v) && v > 0)) out.push({ rule: 'text-limit', message: `capabilities.${field} must be a positive integer, got ${String(v)}` })
  }
  return out
}

/**
 * Throw a {@link CapabilityContractError} unless the provider satisfies the capability
 * contract (see {@link checkCapabilityContract}).
 *
 * @throws {CapabilityContractError}
 */
export function assertCapabilityContract(provider: Pick<IProvider, 'capabilities'> & Partial<IProvider>): void {
  const violations = checkCapabilityContract(provider)
  if (violations.length > 0) throw new CapabilityContractError(String(provider.id ?? 'unknown'), violations)
}
