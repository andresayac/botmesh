/**
 * Hardening found by the release test pass: input validation with actionable messages,
 * corrupt storage reported by key, template lookups limited to the ticket's own fields,
 * working-hours edge cases and a seeded fuzz of the parsers.
 */
import { describe, expect, it } from 'vitest'
import { TicketDesk, isWithinWorkingHours, memoryTicketStorage, parseWorkingHours } from '../src/index.js'
import { renderTemplate } from '../src/internal.js'

const desk = () => new TicketDesk({ storage: memoryTicketStorage() })

describe('TicketDesk — input validation', () => {
  it('rejects a non-string subject on update and a non-string close reason', async () => {
    const d = desk()
    await d.create({ chatId: 'c', subject: 's' })
    await expect(d.update('1', { subject: 5 as never })).rejects.toThrow(/tickets\.update: subject must be a string/)
    await expect(d.close('1', { reason: 5 as never })).rejects.toThrow(/tickets\.close: reason must be a string/)
    expect((await d.get('1'))?.subject).toBe('s')
    expect((await d.get('1'))?.status).toBe('open')
  })

  it('rejects meta that is not a plain JSON object before consuming an id', async () => {
    const d = desk()
    await expect(d.create({ chatId: 'a', subject: 's', meta: [1] as never })).rejects.toThrow(/meta must be a plain object/)
    await expect(d.create({ chatId: 'a', subject: 's', meta: { f: () => 1 } })).rejects.toThrow(/meta must be JSON-serializable/)
    await expect(d.create({ chatId: 'a', subject: 's', meta: { b: 1n } })).rejects.toThrow(/meta must be JSON-serializable/)
    await expect(d.update('1', { meta: 'x' as never })).rejects.toThrow(/tickets\.update: meta must be a plain object/)
    const t = await d.create({ chatId: 'a', subject: 's', meta: { nested: { ok: [1, 'two', null] } } })
    expect(t.id).toBe('1')
  })

  it('a desk without a usable storage fails at construction with a clear message', () => {
    expect(() => new TicketDesk(undefined as never)).toThrow(/TicketDesk: options\.storage/)
    expect(() => new TicketDesk({} as never)).toThrow(/TicketDesk: options\.storage/)
    expect(() => new TicketDesk({ storage: { get: async () => undefined } } as never)).toThrow(/get\(\) and set\(\)/)
  })

  it('isOpen() with an invalid date throws a clear TypeError', () => {
    const d = new TicketDesk({ storage: memoryTicketStorage(), workingHours: '9-18', timezone: 'UTC' })
    expect(() => d.isOpen(new Date(Number.NaN))).toThrow(/valid Date/)
  })
})

describe('TicketDesk — corrupt storage', () => {
  it('names the key holding invalid JSON', async () => {
    const s = memoryTicketStorage()
    await s.set('tickets:index', '{not json')
    await expect(new TicketDesk({ storage: s }).list()).rejects.toThrow(/"tickets:index"/)
    const s2 = memoryTicketStorage()
    await s2.set('tickets:index', '["1"]')
    await s2.set('tickets:t:1', 'garbage')
    await expect(new TicketDesk({ storage: s2 }).queue()).rejects.toThrow(/"tickets:t:1" is not valid JSON/)
  })
})

describe('renderTemplate', () => {
  it('only resolves own properties (no prototype members)', () => {
    expect(renderTemplate('[{{constructor}}][{{toString}}][{{__proto__}}][{{id}}]', { id: 7 })).toBe('[][][][7]')
  })

  it('never re-expands placeholders inside values (user subjects are inert)', () => {
    expect(renderTemplate('{{subject}} #{{id}}', { subject: '{{id}} 🎫 ñ', id: 3 })).toBe('{{id}} 🎫 ñ #3')
  })
})

describe('working hours — edges', () => {
  it('rejects a window that starts at 24:00', () => {
    expect(() => parseWorkingHours('24-6')).toThrow(/start/)
    expect(() => parseWorkingHours({ start: 24, end: 6 })).toThrow(/start/)
    expect(parseWorkingHours('0-24')).toEqual([{ days: [0, 1, 2, 3, 4, 5, 6], start: 0, end: 1440 }])
  })

  it('follows DST in the configured zone', () => {
    const hours = parseWorkingHours('9-18')
    // America/New_York: 2026-03-08 switches to EDT (UTC-4). 13:30 UTC is 09:30 local after the switch.
    expect(isWithinWorkingHours(hours, new Date(Date.UTC(2026, 2, 9, 13, 30)), 'America/New_York')).toBe(true)
    // Before the switch (EST, UTC-5) 13:30 UTC is 08:30 local.
    expect(isWithinWorkingHours(hours, new Date(Date.UTC(2026, 2, 6, 13, 30)), 'America/New_York')).toBe(false)
  })

  it('seeded fuzz: parseWorkingHours either parses or throws its own error, never anything else', () => {
    let seed = 0x2a5634
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    const alphabet = '0123456789:- \t9abé\u{1F600}'
    for (let i = 0; i < 3000; i++) {
      const len = Math.floor(rnd() * 12)
      let s = ''
      for (let j = 0; j < len; j++) s += [...alphabet][Math.floor(rnd() * [...alphabet].length)]
      try {
        const parsed = parseWorkingHours(s)
        expect(Array.isArray(parsed)).toBe(true)
        for (const w of parsed as Array<{ start: number; end: number }>) {
          expect(w.start).toBeGreaterThanOrEqual(0)
          expect(w.start).toBeLessThan(1440)
          expect(w.end).toBeLessThanOrEqual(1440)
          expect(isWithinWorkingHours(parsed, new Date(Date.UTC(2026, 0, 1, Math.floor(rnd() * 24))), 'UTC')).toBeTypeOf('boolean')
        }
      } catch (error) {
        expect((error as Error).message, JSON.stringify(s)).toMatch(/^Invalid tickets config\.workingHours/)
      }
    }
  })
})
