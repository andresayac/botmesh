/**
 * HookSystem — middleware pipeline inspired by Koa (chains of `next()`).
 *
 * Phases per event:
 *   before(msg, next)  → run in order; can mutate; pass via next() — returning
 *                        without next() or calling abort() stops the event
 *   handler(msg)       → core handler (the flow matcher / user callback)
 *   after(msg)         → cleanup / metrics
 *   error(msg, err)    → if anything else throws
 *
 * Plugins register handlers with `bot.before('message', ...)` etc.
 */

import type { AnyHookHandler, HookEvent, HookPhase } from '../core/types.js'
import { randomId } from '../utils/timers.js'

export interface RegisteredHook {
  id: string
  event: HookEvent
  phase: HookPhase
  handler: AnyHookHandler
  priority: number
}

/** Minimal logger surface — satisfied by pino and by a bare `console`. */
export interface HookLogger {
  error?: (...args: unknown[]) => void
}

/** Options of the {@link HookSystem} constructor. */
export interface HookSystemOptions {
  /**
   * Where a misuse is reported (a before-hook calling `next()` more than once). Default:
   * logged at error level. The bot reports it on its `'error'` event.
   */
  report?: (error: Error) => void
}

export class HookSystem {
  private hooks = new Map<`${HookEvent}:${HookPhase}`, RegisteredHook[]>()

  constructor(private logger?: HookLogger, private readonly options: HookSystemOptions = {}) {}

  /** Register a hook. Returns an unsubscribe function. */
  register(
    event: HookEvent,
    phase: HookPhase,
    handler: AnyHookHandler,
    priority = 0
  ): () => void {
    const key = `${event}:${phase}` as const
    const entry: RegisteredHook = { id: randomId('hook'), event, phase, handler, priority }
    const arr = this.hooks.get(key) ?? []
    arr.push(entry)
    arr.sort((a, b) => b.priority - a.priority) // higher priority first
    this.hooks.set(key, arr)
    return () => this.unregister(entry.id)
  }

  /** Remove a hook by id. */
  unregister(id: string): void {
    for (const [key, arr] of this.hooks.entries()) {
      const filtered = arr.filter((h) => h.id !== id)
      if (filtered.length === 0) this.hooks.delete(key)
      else this.hooks.set(key, filtered)
    }
  }

  /** Get all registered hooks for an event+phase. */
  list(event: HookEvent, phase: HookPhase): RegisteredHook[] {
    return [...(this.hooks.get(`${event}:${phase}` as const) ?? [])]
  }

  /** True if any hook exists for the event/phase. */
  has(event: HookEvent, phase?: HookPhase): boolean {
    if (phase) return this.hooks.has(`${event}:${phase}` as const)
    return ['before', 'after', 'error'].some((p) =>
      this.hooks.has(`${event}:${p as HookPhase}` as const)
    )
  }

  /**
   * Run the `before` pipeline (Koa-style). Each handler receives `(ctx, next)`
   * and must call `next()` to hand control to the next hook; the event proceeds
   * only when the whole chain ran (the last hook called `next()` too).
   *
   * A handler that returns without calling `next()` stops the chain AND the
   * event, exactly like `ctx.abort()`: the message is not routed, the send is
   * skipped, the provider event is not emitted. Resolves `false` in both cases.
   *
   * A handler that calls `next()` more than once keeps the FIRST dispatch: every later
   * call returns the first call's promise (the rest of the chain runs once) and the misuse
   * is reported (`HookSystemOptions.report`).
   */
  async runBefore<T>(event: HookEvent, ctx: T & { abort(): void }): Promise<boolean> {
    const hooks = this.list(event, 'before')
    let aborted = false
    let completed = false

    // Wrap abort so we can detect it without mutating the original method
    const ctxAny = ctx as any
    const userAbort = ctxAny.abort?.bind(ctxAny)
    ctxAny.abort = () => { aborted = true; userAbort?.() }

    const dispatch = async (i: number): Promise<void> => {
      if (aborted) return
      if (i >= hooks.length) { completed = true; return }
      const hook = hooks[i]
      let first: Promise<void> | undefined
      const next = (): Promise<void> => {
        if (first) { this.reportMisuse(event, hook); return first }
        first = dispatch(i + 1)
        return first
      }
      await (hook.handler as any)(ctxAny, next)
    }

    try {
      await dispatch(0)
    } finally {
      // Restore original abort if there was one
      if (userAbort) ctxAny.abort = userAbort
      else delete ctxAny.abort
    }
    return completed && !aborted
  }

  private reportMisuse(event: HookEvent, hook: RegisteredHook): void {
    const error = new Error(`before('${event}') hook called next() more than once; the extra call was ignored (the event was dispatched once)`)
    if (this.options.report) {
      try { this.options.report(error) } catch { /* a reporter must not break the chain */ }
    } else {
      this.logger?.error?.({ err: error, event, hook: hook.id }, error.message)
    }
  }

  /** Run the `after` pipeline. Errors are reported but don't propagate. */
  async runAfter<T>(event: HookEvent, ctx: T): Promise<void> {
    const hooks = this.list(event, 'after')
    for (const h of hooks) {
      try {
        await (h.handler as any)(ctx)
      } catch (err) {
        // After hooks shouldn't break the flow; surface but continue
        this.logger?.error?.({ err, event, hook: h.id }, `after-${event} hook threw`)
      }
    }
  }

  /** Run the `error` pipeline. If no error handler registered, rethrow. */
  async runError<T>(event: HookEvent, ctx: T, error: unknown): Promise<void> {
    const hooks = this.list(event, 'error')
    if (hooks.length === 0) throw error
    for (const h of hooks) {
      try {
        await (h.handler as any)(ctx, error)
      } catch (err) {
        this.logger?.error?.({ err, event, hook: h.id }, `error-${event} hook threw`)
      }
    }
  }

  /** Remove every hook. Useful for tests and teardown. */
  clear(): void {
    this.hooks.clear()
  }
}
