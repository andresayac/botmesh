import { describe, it, expect } from 'vitest'
import { parseUpdate } from '../src/parseInbound.js'

describe('parseUpdate: photo MIME type', () => {
  it('a photo carries image/jpeg (Telegram re-encodes photos as JPEG and sends no mime_type)', () => {
    const e = parseUpdate({
      update_id: 1,
      message: {
        message_id: 7, date: 1, chat: { id: 5, type: 'private' }, from: { id: 5, is_bot: false, first_name: 'A' },
        photo: [{ file_id: 'small', file_unique_id: 's', width: 90, height: 90 }, { file_id: 'big', file_unique_id: 'b', width: 800, height: 800, file_size: 1000 }],
      },
    } as never)
    if (e?.kind !== 'message') throw new Error('expected a message')
    expect(e.message.media).toMatchObject({ kind: 'image', mimetype: 'image/jpeg', token: 'big', size: 1000 })
  })
})
