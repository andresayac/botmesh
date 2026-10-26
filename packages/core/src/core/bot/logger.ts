/**
 * Logger seam of the `Bot` constructor: `BotConfig.logger` accepts any core `LoggerLike`
 * (pino, `console`, a custom `{ debug, info, warn, error }`), but the kernel and the
 * modules it builds call `child(bindings)` to tag their lines. {@link toBotLogger} passes
 * a pino-shaped logger through untouched and wraps anything else with a no-op `child()`
 * (bindings dropped) plus no-op `trace`/`fatal`, so a custom logger can never break the
 * engine by lacking a pino-only method.
 *
 * Everything the core logs goes through `debug`/`info`/`warn`/`error`; no site calls
 * `trace`, `fatal` or pino's level machinery.
 */

import pino, { type Logger } from 'pino'
import type { BotConfig, LoggerLike } from '../provider.js'
import { createIdPolicy } from '../../telemetry/ids.js'
import type { TracingImpl } from '../../telemetry/tracing.js'

/** `true` when `logger` already has pino's shape (`child()`, `trace()`, a string `level`). */
export function isPinoLike(logger: LoggerLike): logger is LoggerLike & Logger {
  const value = logger as LoggerLike & { level?: unknown; child?: unknown; trace?: unknown }
  return typeof value.level === 'string' && typeof value.child === 'function' && typeof value.trace === 'function'
}

/**
 * The logger the kernel uses. Without a configured logger it is pino at `warn`
 * (`debug` with `BotConfig.debug`), exactly as before; a pino-shaped logger is returned
 * as is; any other `LoggerLike` is wrapped.
 */
export function toBotLogger(logger: LoggerLike | undefined, options: { debug?: boolean } = {}): Logger {
  if (logger === undefined) return pino({ level: options.debug ? 'debug' : 'warn' })
  if (isPinoLike(logger)) return logger
  return wrap(logger) as unknown as Logger
}

function wrap(logger: LoggerLike, level = 'warn'): LoggerLike & { level: string; trace(): void; fatal(): void } {
  const extras = logger as LoggerLike & { level?: unknown; trace?: unknown; fatal?: unknown; child?: unknown }
  return {
    level: typeof extras.level === 'string' ? extras.level : level,
    child(bindings: Record<string, unknown>) {
      const child = typeof logger.child === 'function' ? logger.child(bindings) : logger
      return wrap(child, typeof extras.level === 'string' ? extras.level : level)
    },
    trace: () => {},
    fatal: () => {},
    debug: (...args: unknown[]) => logger.debug(...args),
    info: (...args: unknown[]) => logger.info(...args),
    warn: (...args: unknown[]) => logger.warn(...args),
    error: (...args: unknown[]) => logger.error(...args),
  } as LoggerLike & { level: string; trace(): void; fatal(): void }
}

/**
 * How a chat/sender id appears in the bot's log lines (`BotConfig.logIds`): hashed by
 * default. Without an explicit policy and with tracing on, the span policy is reused, so a
 * log line and a span of the same chat carry the same hash — unless the spans keep raw ids
 * (`telemetry.ids: 'raw'`): the logs still hash them then (raw ids in logs need `logIds: 'raw'`).
 */
export function logIdPolicy(
  config: Pick<BotConfig, 'logIds' | 'telemetry'>,
  tracing: Pick<TracingImpl, 'idAttribute'> | null,
): (id: string | undefined) => string | undefined {
  if (config.logIds === undefined && tracing && config.telemetry?.ids !== 'raw') return (id) => (id === undefined ? undefined : tracing.idAttribute(id))
  const policy = createIdPolicy({ ids: config.logIds ?? 'hash', idKey: config.telemetry?.idKey })
  return (id) => (id === undefined ? undefined : policy(id))
}
