/**
 * Cron validation: an expression that can never run (a value out of its field's range, a
 * zero step, an inverted range, a day that no month has) is rejected when the task is
 * created, as the scheduler guide promises, instead of creating a task that never fires.
 * And without a time zone the search reaches a leap day (`0 0 29 2 *`), like the zoned one.
 */
import { describe, expect, it } from 'vitest'

import { Scheduler } from '../src/scheduler/Scheduler.js'
import { assertCron, cronNextRun } from '../src/scheduler/cron.js'

describe('assertCron rejects expressions that can never run', () => {
  it.each([
    ['60 * * * *', /minute field "60".*0-59/],
    ['0,61 * * * *', /minute field "0,61".*0-59/],
    ['* 24 * * *', /hour field "24".*0-23/],
    ['* * 0 * *', /day-of-month field "0".*1-31/],
    ['* * 32 * *', /day-of-month field "32".*1-31/],
    ['* * * 0 *', /month field "0".*1-12/],
    ['* * * 13 *', /month field "13".*1-12/],
    ['* * * * 8', /weekday field "8".*0-7/],
    ['*/0 * * * *', /minute field "\*\/0".*step/],
    ['1-5/0 * * * *', /minute field "1-5\/0".*step/],
    ['5-1 * * * *', /minute field "5-1".*range/],
    ['9999999999999999999 * * * *', /minute field/],
    ['0 0 30 2 *', /never matches/],
    ['0 0 31 4,6,9,11 *', /never matches/],
  ])('%s', (expr, message) => {
    expect(() => assertCron(expr)).toThrow(TypeError)
    expect(() => assertCron(expr)).toThrow(message)
    expect(() => new Scheduler().cron(expr, () => {})).toThrow(TypeError)
  })

  it.each([
    '0 9 * * 1-5', '*/15 * * * *', '0-59/30 * * * *', '*/60 * * * *', '* * * * 7', '* * * * 0-7',
    '0 0 29 2 *', '0 0 31 * *', '0 0 30 2 1', '59 23 31 12 *', '0 0 1-31/2 1-12 0-7', '01 * * * *',
  ])('%s is accepted', (expr) => {
    expect(() => assertCron(expr)).not.toThrow()
  })
})

describe('cronNextRun without a time zone', () => {
  it('finds a leap day more than a year ahead', () => {
    const next = cronNextRun('0 0 29 2 *', new Date(2026, 9, 25, 12, 0))
    expect(next).toEqual(new Date(2028, 1, 29, 0, 0))
  })

  it('still finds the next minute right away', () => {
    expect(cronNextRun('* * * * *', new Date(2026, 9, 25, 12, 0, 30))).toEqual(new Date(2026, 9, 25, 12, 1))
  })

  it('skips whole days cheaply (a far yearly slot)', () => {
    const started = performance.now()
    for (let i = 0; i < 50; i++) cronNextRun('0 0 29 2 *', new Date(2026, 9, 25 + i))
    expect(performance.now() - started).toBeLessThan(2_000)
  })

  it('matches a brute-force minute scan on random expressions', () => {
    let seed = 42
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
    const ri = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
    const field = (lo: number, hi: number) => {
      const k = rnd()
      if (k < 0.35) return '*'
      if (k < 0.55) return `*/${ri(2, Math.min(15, hi))}`
      if (k < 0.75) return String(ri(lo, hi))
      const a = ri(lo, hi)
      return `${a}-${ri(a, hi)}`
    }
    const brute = (expr: string, from: Date): Date | null => {
      const [m, h, dom, mon, dow] = expr.split(' ')
      const or = !dom.startsWith('*') && !dow.startsWith('*')
      const start = new Date(from); start.setSeconds(0, 0); start.setMinutes(start.getMinutes() + 1)
      const ok = (v: number, e: string, min: number) => assertMatches(v, e, min)
      for (let i = 0; i < 40 * 24 * 60; i++) {
        const c = new Date(start.getTime() + i * 60_000)
        if (!ok(c.getMinutes(), m, 0) || !ok(c.getHours(), h, 0) || !ok(c.getMonth() + 1, mon, 1)) continue
        const d1 = ok(c.getDate(), dom, 1)
        const d2 = ok(c.getDay(), dow, 0) || (c.getDay() === 0 && ok(7, dow, 0))
        if (or ? d1 || d2 : d1 && d2) return c
      }
      return null
    }
    for (let i = 0; i < 60; i++) {
      const expr = [field(0, 59), field(0, 23), rnd() < 0.8 ? '*' : field(1, 28), '*', rnd() < 0.8 ? '*' : field(0, 6)].join(' ')
      const from = new Date(2026, ri(0, 11), ri(1, 28), ri(0, 23), ri(0, 59), ri(0, 59))
      const expected = brute(expr, from)
      if (expected) expect(cronNextRun(expr, from), `${expr} from ${from.toISOString()}`).toEqual(expected)
    }
  })
})

function assertMatches(v: number, e: string, min: number): boolean {
  return e.split(',').some((part) => {
    const [range, stepText] = part.split('/')
    const step = stepText ? Number(stepText) : 1
    let lo: number
    let hi: number
    if (range === '*') { lo = min; hi = Infinity } else if (range.includes('-')) { [lo, hi] = range.split('-').map(Number) } else { lo = Number(range); hi = stepText ? Infinity : lo }
    return v >= lo && v <= hi && (v - lo) % step === 0
  })
}
