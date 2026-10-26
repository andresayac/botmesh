/**
 * Cards and URL buttons on the Cloud API: nothing the caller asked for (image,
 * buttons, link) may be dropped silently. What Graph cannot carry rejects with
 * UnsupportedContentError.
 */
import { describe, it, expect } from 'vitest'
import { UnsupportedContentError } from '@botmesh/core'
import { toOutbound } from '../src/toOutbound.js'

describe('toOutbound — URL buttons', () => {
  it('a single URL button becomes an interactive cta_url message', () => {
    expect(toOutbound({ kind: 'buttons', text: 'x', footer: 'f', buttons: [{ id: 'a', title: 'Visit', url: 'https://example.com' }] }))
      .toEqual({
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          body: { text: 'x' },
          action: { name: 'cta_url', parameters: { display_text: 'Visit', url: 'https://example.com' } },
          footer: { text: 'f' },
        },
      })
  })

  it('cuts the cta_url label to 20 characters', () => {
    const out = toOutbound({ kind: 'buttons', text: 'x', buttons: [{ id: 'a', title: 'A very long link label here', url: 'https://e.com' }] }) as {
      interactive: { action: { parameters: { display_text: string } } }
    }
    expect(out.interactive.action.parameters.display_text).toBe('A very long link lab')
  })

  it('rejects a URL button mixed with reply buttons', () => {
    expect(() => toOutbound({ kind: 'buttons', text: 'x', buttons: [{ id: 'a', title: 'Go', url: 'https://e.com' }, { id: 'b', title: 'B' }] }))
      .toThrow(UnsupportedContentError)
  })

  it('rejects more than one URL button', () => {
    expect(() => toOutbound({ kind: 'buttons', text: 'x', buttons: [{ id: 'a', title: 'A', url: 'https://a.com' }, { id: 'b', title: 'B', url: 'https://b.com' }] }))
      .toThrow(UnsupportedContentError)
  })
})

describe('toOutbound — card', () => {
  it('title and body only → text', () => {
    expect(toOutbound({ kind: 'card', title: 'T', body: 'B' })).toEqual({ type: 'text', text: { body: 'T\nB' } })
  })

  it('with an image and no buttons → image with the text as caption', () => {
    expect(toOutbound({ kind: 'card', title: 'T', body: 'B', imageUrl: 'https://e.com/a.png' }))
      .toEqual({ type: 'image', image: { link: 'https://e.com/a.png', caption: 'T\nB' } })
  })

  it('with reply buttons and an image → interactive button with an image header', () => {
    expect(toOutbound({ kind: 'card', title: 'T', body: 'B', imageUrl: 'https://e.com/a.png', buttons: [{ id: 'buy', title: 'Buy' }] }))
      .toEqual({
        type: 'interactive',
        interactive: {
          type: 'button',
          header: { type: 'image', image: { link: 'https://e.com/a.png' } },
          body: { text: 'T\nB' },
          action: { buttons: [{ type: 'reply', reply: { id: 'buy', title: 'Buy' } }] },
        },
      })
  })

  it('with reply buttons and no image → interactive button without header', () => {
    const out = toOutbound({ kind: 'card', title: 'T', buttons: [{ id: 'buy', title: 'Buy' }] }) as { interactive: Record<string, unknown> }
    expect(out.interactive.type).toBe('button')
    expect(out.interactive.header).toBeUndefined()
    expect(out.interactive.body).toEqual({ text: 'T' })
  })

  it('with one URL button → cta_url with the image header', () => {
    expect(toOutbound({ kind: 'card', title: 'T', imageUrl: 'https://e.com/a.png', buttons: [{ id: 'go', title: 'Open', url: 'https://e.com' }] }))
      .toEqual({
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          header: { type: 'image', image: { link: 'https://e.com/a.png' } },
          body: { text: 'T' },
          action: { name: 'cta_url', parameters: { display_text: 'Open', url: 'https://e.com' } },
        },
      })
  })

  it('rejects more than 3 buttons instead of dropping them', () => {
    const buttons = ['a', 'b', 'c', 'd'].map((id) => ({ id, title: id }))
    let err: unknown
    try { toOutbound({ kind: 'card', title: 'T', buttons }) } catch (e) { err = e }
    expect(err).toBeInstanceOf(UnsupportedContentError)
    expect((err as UnsupportedContentError).kind).toBe('card')
  })

  it('an empty buttons array is a plain card', () => {
    expect(toOutbound({ kind: 'card', title: 'T', buttons: [] })).toEqual({ type: 'text', text: { body: 'T' } })
  })
})
