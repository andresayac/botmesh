/**
 * toOutbound — map a transport-neutral {@link OutboundContent} to a WhatsApp
 * Cloud API message payload (the object under `type` in the Graph request).
 *
 * Media is resolved by the provider BEFORE this is called (uploaded → `id`, or
 * a URL → `link`). Cloud API supports native reply buttons, lists, templates
 * and reactions; it does NOT support poll messages (Graph error 131051), so
 * `poll` throws {@link UnsupportedContentError}.
 */

import { UnsupportedContentError, type Button, type OutboundContent } from '@botmesh/core'
import { toFlowMessage } from './flows.js'

/** How the provider resolved a MediaSource for Cloud API. */
export interface ResolvedMedia {
  /** Uploaded media id (from POST /media). */
  id?: string
  /** Publicly reachable URL (used as a `link`). */
  link?: string
}

function mediaObject(kind: OutboundContent['kind'], media: ResolvedMedia | undefined, extra: Record<string, unknown> = {}): Record<string, unknown> {
  if (media?.id) return { id: media.id, ...extra }
  if (media?.link) return { link: media.link, ...extra }
  throw new UnsupportedContentError(kind, 'Cloud API media requires an uploaded id or a public link.')
}

/** Graph limits of the interactive labels this mapper truncates (in characters). */
const LIMITS = { buttons: 3, buttonTitle: 20, ctaLabel: 20, listButton: 20, sectionTitle: 24, rowTitle: 24, rowDescription: 72 } as const

/** First `max` characters (code points: an emoji is never split into a lone surrogate). */
function cut(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length <= max ? text : chars.slice(0, max).join('')
}

/**
 * Interactive message for `buttons` and `card`. Reply buttons (up to 3) map to
 * `type: 'button'`; a single URL button maps to `type: 'cta_url'`. Graph cannot
 * carry anything else (more than 3, several links, links mixed with replies),
 * so that rejects instead of dropping what the user would never see.
 */
function interactiveButtons(
  kind: 'buttons' | 'card',
  text: string,
  buttons: Button[],
  extra: { footer?: string; imageUrl?: string } = {},
): Record<string, unknown> {
  const links = buttons.filter((b) => b.url)
  if (links.length > 0 && buttons.length > 1) {
    throw new UnsupportedContentError(
      kind,
      `Cloud API sends one URL button per message (cta_url) and cannot mix it with other buttons; got ${buttons.length} buttons, ${links.length} with a URL. ` +
        'Send the link in its own message or drop the URL to use reply buttons.',
    )
  }
  if (buttons.length > LIMITS.buttons) {
    throw new UnsupportedContentError(
      kind,
      `Cloud API reply buttons allow at most ${LIMITS.buttons} options; got ${buttons.length}. ` +
        'Send a list (kind list, up to 10 rows) or a numbered choose() menu instead.',
    )
  }
  const header = extra.imageUrl ? { header: { type: 'image', image: { link: extra.imageUrl } } } : {}
  const footer = extra.footer ? { footer: { text: extra.footer } } : {}
  const link = links[0]
  if (link) {
    return {
      type: 'interactive',
      interactive: {
        type: 'cta_url',
        ...header,
        body: { text },
        action: { name: 'cta_url', parameters: { display_text: cut(link.title, LIMITS.ctaLabel), url: link.url } },
        ...footer,
      },
    }
  }
  return {
    type: 'interactive',
    interactive: {
      type: 'button',
      ...header,
      body: { text },
      action: { buttons: buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: cut(b.title, LIMITS.buttonTitle) } })) },
      ...footer,
    },
  }
}

/**
 * @returns the message payload: `{ type, [type]: {...} }` or
 *   `{ type: 'interactive'|'template'|'reaction', ... }` — ready to spread into
 *   the Graph `/messages` request.
 */
export function toOutbound(content: OutboundContent, media?: ResolvedMedia): Record<string, unknown> {
  switch (content.kind) {
    case 'text':
      return { type: 'text', text: { body: content.text } }

    case 'image':
      return { type: 'image', image: mediaObject('image', media, content.caption ? { caption: content.caption } : {}) }
    case 'video':
      return { type: 'video', video: mediaObject('video', media, content.caption ? { caption: content.caption } : {}) }
    case 'audio':
    case 'voice':
      return { type: 'audio', audio: mediaObject(content.kind, media) }
    case 'document': {
      const extra: Record<string, unknown> = {}
      if (content.filename) extra.filename = content.filename
      if (content.caption) extra.caption = content.caption
      return { type: 'document', document: mediaObject('document', media, extra) }
    }
    case 'sticker':
      return { type: 'sticker', sticker: mediaObject('sticker', media) }

    case 'location': {
      const location: Record<string, unknown> = { latitude: content.lat, longitude: content.lng }
      if (content.name) location.name = content.name
      if (content.address) location.address = content.address
      return { type: 'location', location }
    }

    case 'contact':
      return {
        type: 'contacts',
        contacts: [{
          name: { formatted_name: content.displayName ?? content.phone },
          phones: [{ phone: content.phone, type: 'CELL' }],
        }],
      }

    case 'reaction':
      return { type: 'reaction', reaction: { message_id: content.target.id, emoji: content.emoji } }

    case 'buttons':
      return interactiveButtons('buttons', content.text, content.buttons, content.footer ? { footer: content.footer } : {})

    case 'list': {
      const sections = content.sections.map((s) => ({
        ...(s.title ? { title: cut(s.title, LIMITS.sectionTitle) } : {}),
        rows: s.rows.map((r) => ({
          id: r.id,
          title: cut(r.title, LIMITS.rowTitle),
          ...(r.description ? { description: cut(r.description, LIMITS.rowDescription) } : {}),
        })),
      }))
      return {
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: content.text },
          action: { button: cut(content.buttonText, LIMITS.listButton), sections },
          ...(content.footer ? { footer: { text: content.footer } } : {}),
        },
      }
    }

    case 'card': {
      // Nothing of the card is dropped: the image becomes the media (or the
      // interactive header) and buttons go out natively or reject.
      const text = [content.title, content.body].filter(Boolean).join('\n')
      if (content.buttons?.length) {
        return interactiveButtons('card', text, content.buttons, content.imageUrl ? { imageUrl: content.imageUrl } : {})
      }
      if (content.imageUrl) return { type: 'image', image: { link: content.imageUrl, caption: text } }
      return { type: 'text', text: { body: text } }
    }

    case 'template':
      return {
        type: 'template',
        template: { name: content.name, language: { code: content.language }, components: content.components ?? [] },
      }

    case 'native':
      return content.payload as Record<string, unknown>

    case 'form':
      return toFlowMessage(content)

    case 'poll':
      throw new UnsupportedContentError('poll', 'WhatsApp Cloud API does not support polls (Graph 131051). Use reply buttons (kind buttons), a list or a WhatsApp Flow form.')
  }
}
