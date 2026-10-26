import { describe, it, expect } from 'vitest'
import { toOutbound } from '../src/toOutbound.js'
import { parseUpdate } from '../src/parseInbound.js'

describe('inline keyboard button text', () => {
  it('cuts long titles on a code point boundary (never half an emoji)', () => {
    const title = 'a'.repeat(63) + '😀tail'
    const out = toOutbound({ kind: 'buttons', text: 't', buttons: [{ id: 'x', title }] })
    const text = (out.params.reply_markup as { inline_keyboard: Array<Array<{ text: string }>> }).inline_keyboard[0][0].text
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(text)).toBe(false) // no lone high surrogate
    expect([...text].length).toBeLessThanOrEqual(64)
  })
})

describe('commands addressed to the bot in groups (/cmd@BotName)', () => {
  const group = { id: -100, type: 'supergroup', title: 'G' }
  const msg = (text: string, length: number) => ({
    update_id: 1,
    message: { message_id: 3, date: 1, chat: group, from: { id: 5 }, text, entities: [{ type: 'bot_command', offset: 0, length }] },
  })

  it('strips the bot\'s own @username so bot.command() matches', () => {
    const ev = parseUpdate(msg('/menu@Fake_Bot pizza', 14) as never, '9', 'fake_bot')
    expect(ev?.kind === 'message' && ev.message.body).toBe('/menu pizza')
  })

  it('leaves a command addressed to another bot untouched', () => {
    const ev = parseUpdate(msg('/menu@other_bot', 15) as never, '9', 'fake_bot')
    expect(ev?.kind === 'message' && ev.message.body).toBe('/menu@other_bot')
  })

  it('leaves the text alone when the bot username is unknown or there is no command entity', () => {
    expect((parseUpdate(msg('/menu@fake_bot', 14) as never, '9') as { message: { body: string } }).message.body).toBe('/menu@fake_bot')
    const plain = { update_id: 2, message: { message_id: 4, date: 1, chat: group, from: { id: 5 }, text: '/menu@fake_bot' } }
    expect((parseUpdate(plain as never, '9', 'fake_bot') as { message: { body: string } }).message.body).toBe('/menu@fake_bot')
  })
})
