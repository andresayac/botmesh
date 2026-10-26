/**
 * Format upgrades shared by the migrations (`migrate.ts`) and the validator (`schema.ts`),
 * kept free of imports so neither module depends on the other at load time.
 *
 * Version 1 → 2: `retries` on `ask` / `form` steps meant the TOTAL answers a wait accepts
 * (a `retries: 0` behaved like 1). Version 2 follows the core `WaitOptions`: `retries` is
 * the retries after the first answer and `maxAttempts` the total. The upgrade rewrites
 * `retries: N` to `maxAttempts: max(N, 1)` (an explicit `maxAttempts` wins), so a stored
 * v1 flow keeps its behaviour.
 */

/** Version 1 → 2 upgrade of a document; values that are not steps pass through untouched. */
export function upgradeV1ToV2(document: Record<string, unknown>): Record<string, unknown> {
  return { ...document, steps: upgradeSteps(document.steps), version: 2 }
}

function upgradeSteps(steps: unknown): unknown {
  return Array.isArray(steps) ? steps.map(upgradeStep) : steps
}

function upgradeStep(step: unknown): unknown {
  if (!isRecord(step)) return step
  const next: Record<string, unknown> = { ...step }
  if ((next.kind === 'ask' || next.kind === 'form') && next.retries !== undefined) {
    const retries = next.retries
    delete next.retries
    if (next.maxAttempts === undefined) {
      next.maxAttempts = typeof retries === 'number' && Number.isInteger(retries) && retries >= 0 ? Math.max(retries, 1) : retries
    }
  }
  if (next.kind === 'condition') {
    if ('then' in next) next.then = upgradeSteps(next.then)
    if ('else' in next) next.else = upgradeSteps(next.else)
  }
  if (next.kind === 'choose' && Array.isArray(next.options)) {
    next.options = next.options.map((option: unknown) =>
      isRecord(option) && 'steps' in option ? { ...option, steps: upgradeSteps(option.steps) } : option)
  }
  return next
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
