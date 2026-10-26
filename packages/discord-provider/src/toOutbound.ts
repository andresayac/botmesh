/**
 * toOutbound — map a transport-neutral {@link OutboundContent} to a Discord
 * REST "Create Message" JSON payload (+ optional resolved file for multipart).
 *
 * Media is resolved by the provider BEFORE this is called (MediaSource →
 * bytes). Discord uploads are multipart: the provider appends `files[0]` plus
 * `payload_json` (the object returned here, with `attachments[0]` referencing
 * the file id `0`).
 *
 * Routes this can't express (reactions go to PUT .../reactions/{emoji}/@me) are
 * handled directly by DiscordProvider; `template` is unsupported on Discord.
 */

import { UnsupportedContentError, type OutboundContent } from '@botmesh/core'

/** A resolved file ready to append as `files[n]` on the multipart request. */
export interface DiscordFile {
  name: string
  buffer: Buffer
  contentType?: string
}

export interface DiscordOutboundPayload {
  /** JSON body — or the `payload_json` part when `files` is present. */
  payload: Record<string, unknown>
  /** Files to upload alongside the payload (multipart). */
  files?: DiscordFile[]
}

function mediaPayload(content: OutboundContent & { caption?: string }, file: DiscordFile | undefined): DiscordOutboundPayload {
  if (!file) {
    throw new UnsupportedContentError(content.kind, 'Discord media requires resolved bytes (MediaSource → DiscordFile) — pass them via DiscordProvider.send.')
  }
  // A snowflake-typed string, as discord-api-spec's MessageAttachmentRequest declares ("0" = files[0]).
  const attachment: Record<string, unknown> = { id: '0', filename: file.name }
  // `description` is the alt text: Discord caps it at 1024 characters (the caption itself goes in `content`).
  if (content.caption) attachment.description = cut(content.caption, MAX_ALT_TEXT)
  return {
    payload: {
      ...(content.caption ? { content: content.caption } : {}),
      attachments: [attachment],
    },
    files: [file],
  }
}

/** Discord: an attachment `description` (alt text) holds at most 1024 characters. */
const MAX_ALT_TEXT = 1024
/** Discord: at most 5 buttons per action row and 5 action rows per message. */
const BUTTONS_PER_ROW = 5
const MAX_ROWS = 5
/** Discord: at most 25 options in a select menu and 10 answers in a poll. */
const MAX_SELECT_OPTIONS = 25
const MAX_POLL_ANSWERS = 10

/** First `max` characters (code points: an emoji is never split into a lone surrogate). */
function cut(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length <= max ? text : chars.slice(0, max).join('')
}

/**
 * Reject more options than Discord can show (like the Cloud API does), rather than
 * dropping the ones the user would never see.
 */
function assertAtMost(kind: OutboundContent['kind'], what: string, count: number, max: number): void {
  if (count > max) throw new UnsupportedContentError(kind, `Discord allows at most ${max} ${what}; got ${count}. Split the options or use a numbered text menu.`)
}

/**
 * Buttons -> action rows (type 1) of up to 5 buttons each, at most 25 buttons (more
 * rejects with `UnsupportedContentError`). `custom_id` must be 1-100 chars, so an empty
 * id falls back to the title.
 */
function buttonRows(kind: 'buttons' | 'card', buttons: Array<{ id: string; title: string; url?: string }>): Array<Record<string, unknown>> {
  assertAtMost(kind, 'buttons per message', buttons.length, BUTTONS_PER_ROW * MAX_ROWS)
  const components = buttons.map((b) =>
    b.url
      ? { type: 2, style: 5, label: cut(b.title, 80), url: b.url }
      : { type: 2, style: 1, label: cut(b.title, 80), custom_id: cut(b.id || b.title, 100) },
  )
  const rows: Array<Record<string, unknown>> = []
  for (let i = 0; i < components.length; i += BUTTONS_PER_ROW) {
    rows.push({ type: 1, components: components.slice(i, i + BUTTONS_PER_ROW) })
  }
  return rows
}

/** Map neutral content → Discord Create-Message payload (+ files when media). */
export function toOutbound(content: OutboundContent, file?: DiscordFile): DiscordOutboundPayload {
  switch (content.kind) {
    case 'text':
      return { payload: { content: content.text } }

    case 'image':
    case 'video':
    case 'audio':
    case 'voice':
    case 'document':
    case 'sticker':
      return mediaPayload(content, file)

    case 'buttons':
      return {
        payload: {
          content: content.text,
          components: buttonRows('buttons', content.buttons),
        },
      }

    case 'list': {
      const rows = content.sections.flatMap((s) => s.rows)
      assertAtMost('list', 'select menu options', rows.length, MAX_SELECT_OPTIONS)
      const options = rows.map((r) => ({
        label: cut(r.title, 100),
        value: cut(r.id || r.title, 100),
        ...(r.description ? { description: cut(r.description, 100) } : {}),
      }))
      const customId = cut(content.buttonText || 'select', 100)
      return {
        payload: {
          content: content.text,
          components: [{
            type: 1,
            components: [{ type: 3, custom_id: customId, placeholder: cut(content.buttonText, 150), options }],
          }],
        },
      }
    }

    case 'card': {
      const embed: Record<string, unknown> = { title: cut(content.title, 256) }
      if (content.body) embed.description = cut(content.body, 4096)
      if (content.imageUrl) embed.image = { url: content.imageUrl }
      const payload: Record<string, unknown> = { embeds: [embed] }
      if (content.buttons?.length) {
        payload.components = buttonRows('card', content.buttons)
      }
      return { payload }
    }

    case 'form':
      throw new UnsupportedContentError('form', 'This transport has no native forms — flow().form() asks field by field instead (capabilities.forms is not "native").')
    case 'poll':
      assertAtMost('poll', 'poll answers', content.options.length, MAX_POLL_ANSWERS)
      return {
        payload: {
          poll: {
            question: { text: cut(content.question, 300) },
            answers: content.options.map((o) => ({ poll_media: { text: cut(o, 55) } })),
            duration: 24,
            allow_multiselect: content.multiSelect ?? false,
          },
        },
      }

    case 'reaction':
      throw new UnsupportedContentError('reaction', 'Reactions use the PUT .../reactions route — DiscordProvider.send handles this kind directly.')

    case 'location':
      // Explicit degradation: Discord has no location primitive.
      return {
        payload: {
          content: [
            content.name,
            `https://maps.google.com/?q=${content.lat},${content.lng}`,
            content.address,
          ].filter(Boolean).join('\n'),
        },
      }

    case 'contact':
      // Explicit degradation: Discord has no contact primitive.
      return { payload: { content: `📇 ${content.displayName ?? content.phone}\n${content.phone}` } }

    case 'template':
      throw new UnsupportedContentError('template', 'Discord has no template messages.')

    case 'native':
      if (content.provider !== 'discord') {
        throw new UnsupportedContentError('native', `native content for '${content.provider}' cannot be sent through Discord (use ctx.sendNative('discord', payload))`)
      }
      if (content.payload === null || typeof content.payload !== 'object' || Array.isArray(content.payload)) {
        throw new UnsupportedContentError('native', 'Discord native payload must be a Create Message JSON object')
      }
      return { payload: content.payload as Record<string, unknown> }
  }
}
