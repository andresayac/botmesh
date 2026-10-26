import { describe, expect, it } from 'vitest'
import { OutsideSessionWindowError, RecipientUnreachableError } from '@botmesh/core'
import { toGhlError } from '../src/errors.js'

describe('toGhlError: WhatsApp window', () => {
  it.each([
    'Message failed to send because more than 24 hours have passed since the customer last replied',
    'Cannot send a free-form message outside the 24-hour window, use a template',
    'Re-engagement message',
  ])('maps "%s" to OutsideSessionWindowError', (message) => {
    expect(toGhlError(400, { statusCode: 400, message }, 'c1')).toBeInstanceOf(OutsideSessionWindowError)
  })

  it('keeps unreachable wording on RecipientUnreachableError', () => {
    expect(toGhlError(400, { statusCode: 400, message: 'Contact not found' }, 'c1')).toBeInstanceOf(RecipientUnreachableError)
  })
})
