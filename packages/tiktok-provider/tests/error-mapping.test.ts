import { describe, expect, it } from 'vitest'
import { PayloadTooLargeError, RateLimitedError } from '@botmesh/core'
import { toTikTokError, TikTokApiError } from '../src/errors.js'

describe('TikTok error mapping: oversized media', () => {
  it.each([
    [200, 40002, 'File size exceeds the limit'],
    [200, 40002, 'The image is too large'],
    [413, undefined, 'Request Entity Too Large'],
  ])('HTTP %s code %s "%s" → PayloadTooLargeError', (httpStatus, code, message) => {
    expect(toTikTokError({ chatId: 'dm:1', httpStatus, ...(code !== undefined ? { code } : {}), message })).toBeInstanceOf(PayloadTooLargeError)
  })

  it('other 40002 parameter errors stay TikTokApiError; throttling stays RateLimitedError', () => {
    expect(toTikTokError({ chatId: 'dm:1', httpStatus: 200, code: 40002, message: 'Invalid parameter: recipient' })).toBeInstanceOf(TikTokApiError)
    expect(toTikTokError({ chatId: 'dm:1', httpStatus: 200, code: 40100, message: 'Too many requests' })).toBeInstanceOf(RateLimitedError)
  })
})
