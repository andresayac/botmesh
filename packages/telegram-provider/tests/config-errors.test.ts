import { describe, expect, it } from 'vitest'
import { TelegramProvider, toProviderError } from '../src/TelegramProvider.js'

// A new user who starts the scaffolded bot before filling in .env passes
// `token: process.env.TELEGRAM_TOKEN` (undefined). That must fail at once with an
// actionable message, not after a request to `/botundefined/getMe` ("Not Found").
describe('TelegramProvider config errors', () => {
  it.each([undefined, '', '   '])('rejects a missing token (%j) with an actionable TypeError', (token) => {
    expect(() => new TelegramProvider({ token: token as string })).toThrow(TypeError)
    expect(() => new TelegramProvider({ token: token as string })).toThrow(/token.*@BotFather/)
  })

  it('rejects a non-string token', () => {
    expect(() => new TelegramProvider({ token: 12345 as unknown as string })).toThrow(/token/)
  })

  it('accepts a real-looking token', () => {
    expect(() => new TelegramProvider({ token: '123456:ABC-def_ghi' })).not.toThrow()
  })

  it('maps a 404 (malformed token or wrong baseUrl) to an actionable error', () => {
    const err = toProviderError('', 404, 'Not Found')
    expect(err.message).toMatch(/check the bot token/)
    expect(err.message).toMatch(/Not Found/)
  })
})
