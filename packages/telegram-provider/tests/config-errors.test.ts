import { describe, expect, it } from 'vitest'
import { toTelegramError } from '../src/TelegramProvider.js'

// A malformed token (or a wrong `baseUrl` path) makes the Bot API answer 404 "Not Found".
// The error must say what to check instead of a bare "Not Found". (The constructor check
// for a missing token ships with the Telegram hardening, `.changeset/telegram-hardening.md`.)
describe('TelegramProvider config errors', () => {
  it('maps a 404 (malformed token or wrong baseUrl) to an actionable error', () => {
    const err = toTelegramError('', 404, 'Not Found')
    expect(err.message).toMatch(/check the bot token/)
    expect(err.message).toMatch(/Not Found/)
  })
})
