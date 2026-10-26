/** =============================================================================
 * MINIMAL CRON PARSER — five fields: minute hour day-of-month month weekday.
 * Each field takes '*', a number, a range (1-5), a step (`*` + `/15`, 1-30/5, 5/15) or a
 * comma list of those; weekday 0 and 7 are Sunday. A `*` step counts from the field's
 * minimum (`*` + `/2` in day-of-month = 1, 3, 5…; `*` + `/3` in month = Jan, Apr, Jul, Oct).
 * Day rule of standard (Vixie) cron: when BOTH day-of-month and weekday are restricted,
 * a day matches if EITHER does (`0 9 13 * 5` = every 13th and every Friday); when one
 * of them starts with `*` (including a `*` step), both must match. Names (mon, jan)
 * and macros (@daily) are rejected when the task is created.
 * (For full cron support, swap to a real parser like `cron-parser`.)
 * ========================================================================== */

import { nextRunInZone } from './cronZone.js'

const CRON_FIELDS = ['minute', 'hour', 'day-of-month', 'month', 'weekday'] as const
const CRON_FIELD = /^(\*|\d+(-\d+)?)(\/\d+)?(,(\*|\d+(-\d+)?)(\/\d+)?)*$/
/** Allowed values of each field (weekday 7 is Sunday too). */
const CRON_BOUNDS: ReadonlyArray<readonly [number, number]> = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]]
/** Longest month of each month number (February counts its leap day). */
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
/** Search horizon: four years (a leap day) plus a couple of days of slack. */
const HORIZON_MS = (4 * 366 + 2) * 24 * 60 * 60_000

/** Throw an actionable `TypeError` for an expression the minimal parser cannot run. */
export function assertCron(expr: string): void {
  const parts = typeof expr === 'string' ? expr.trim().split(/\s+/) : []
  if (parts.length !== 5) {
    throw new TypeError(
      `Invalid cron expression "${String(expr)}": expected 5 fields (minute hour day-of-month month weekday), e.g. '0 9 * * 1-5'`,
    )
  }
  parts.forEach((part, i) => {
    const fail = (why: string): never => {
      throw new TypeError(`Invalid cron expression "${expr}": the ${CRON_FIELDS[i]} field "${part}" ${why}`)
    }
    if (!CRON_FIELD.test(part)) fail(`must use numbers, '*', ranges (1-5), steps (*/15) or lists (1,15)`)
    const [lo, hi] = CRON_BOUNDS[i]
    for (const item of part.split(',')) {
      const [range, stepText] = item.split('/')
      if (stepText !== undefined && Number(stepText) < 1) fail(`has a step of 0; a step must be 1 or more`)
      if (range === '*') continue
      const [a, b = a] = range.split('-').map(Number)
      if (a < lo || a > hi || b < lo || b > hi) fail(`is out of range: ${CRON_FIELDS[i]} values go from ${lo}-${hi}`)
      if (a > b) fail(`has an inverted range: write the lower value first (${b}-${a})`)
    }
  })
  // Every field now matches at least one value; only a month/day pair can be impossible
  // (the 30th of February). With both day fields restricted, any matching weekday runs it.
  const [, , dom, month, dow] = parts
  if (!dom.startsWith('*') && dow.startsWith('*')) {
    let possible = false
    for (let m = 1; m <= 12 && !possible; m++) {
      if (!matchesField(m, month, 1)) continue
      for (let d = 1; d <= MONTH_DAYS[m - 1] && !possible; d++) possible = matchesField(d, dom, 1)
    }
    if (!possible) {
      throw new TypeError(`Invalid cron expression "${expr}": it never matches (no month selected by "${month}" has the day "${dom}")`)
    }
  }
}

/**
 * The first minute strictly after `from` (default: now) that matches `expr`, or `null`
 * when nothing matches within four years. Pure for a given `from` (cron fields are local time).
 *
 * With `timeZone` (an IANA name such as `'America/Bogota'`) the fields are read as wall
 * time in that zone, with the daylight-saving rules of the scheduler guide (a fixed-hour
 * slot in a skipped hour is shifted forward; in a repeated hour it runs once, at the first
 * occurrence; wildcard-hour slots follow the real clock). The horizon is four years either
 * way (so a leap day is always found). No zone, or `'local'`, keeps the host-local evaluation. An unknown zone throws a `RangeError`.
 */
export function cronNextRun(expr: string, from: Date = new Date(), timeZone?: string): Date | null {
  if (timeZone !== undefined && timeZone !== 'local') return nextRunInZone(expr, from, timeZone)
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [m, h, dom, mon, dow] = parts

  // Start from next minute
  const next = new Date(from.getTime())
  next.setSeconds(0, 0)
  next.setMinutes(next.getMinutes() + 1)

  // Standard cron: a day field starting with '*' (even a step such as '*/2') is "unrestricted".
  const orDays = !dom.startsWith('*') && !dow.startsWith('*')

  // Minute by minute inside a matching day; a day that does not match is skipped whole
  // (to the first instant of the next local day), so a yearly slot costs a few thousand
  // checks instead of a scan of every minute up to it.
  const end = next.getTime() + HORIZON_MS
  for (let t = next.getTime(); t < end;) {
    const candidate = new Date(t)
    const domOk = matchesField(candidate.getDate(), dom, 1)
    const dowOk = matchesWeekday(candidate.getDay(), dow)
    if (!matchesField(candidate.getMonth() + 1, mon, 1) || !(orDays ? domOk || dowOk : domOk && dowOk)) {
      const nextDay = new Date(candidate.getFullYear(), candidate.getMonth(), candidate.getDate() + 1).getTime()
      t = Math.max(nextDay, t + 60_000)
      continue
    }
    if (matchesField(candidate.getMinutes(), m, 0) && matchesField(candidate.getHours(), h, 0)) return candidate
    t += 60_000
  }
  return null
}

/** Weekday field: `0` and `7` both mean Sunday (standard cron). */
export function matchesWeekday(day: number, expr: string): boolean {
  return matchesField(day, expr, 0) || (day === 0 && matchesField(7, expr, 0))
}

/** Does `actual` match one cron field? `min` is the field's lowest value (where a `*` step starts). */
export function matchesField(actual: number, expr: string, min: number): boolean {
  if (expr === '*') return true
  // ranges & lists
  for (const part of expr.split(',')) {
    const [range, stepText] = part.split('/')
    const step = stepText === undefined ? 1 : parseInt(stepText, 10)
    if (!Number.isInteger(step) || step <= 0) continue
    let lo: number
    let hi: number
    if (range === '*') {
      lo = min
      hi = Number.POSITIVE_INFINITY
    } else if (range.includes('-')) {
      ;[lo, hi] = range.split('-').map((n) => parseInt(n, 10))
    } else {
      lo = parseInt(range, 10)
      // `5/15` (start/step without a range) runs from 5 to the end of the field.
      hi = stepText === undefined ? lo : Number.POSITIVE_INFINITY
    }
    if (Number.isNaN(lo) || Number.isNaN(hi)) continue
    if (actual >= lo && actual <= hi && (actual - lo) % step === 0) return true
  }
  return false
}
