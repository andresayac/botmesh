/**
 * Builds the {@link MessageContext} of an inbound message — real, a projected call or the
 * synthetic one of `bot.trigger()` — wired to every seam the bot offers (sends through
 * the hook pipeline, typing, handoff, `ctx.user`, i18n, pacing, edits, streaming,
 * native forms).
 */
import { buildMessageContext } from '../context.js'
import type { BuildContextDeps } from '../provider.js'
import type { ChatId, InboundMessage, MessageContext } from '../types.js'
import type { HandoffOptions } from '../../gates/handoff.js'
import type { BotKernel } from './kernel.js'
import type { OutboundPipeline } from './outbound.js'

/**
 * `extra` adds the seams that only make sense for a real inbound message. `beforeSend`
 * runs before each new message the context sends (the interaction auto-ack).
 */
export type ContextFactory = (inbound: InboundMessage, extra?: Partial<BuildContextDeps>, beforeSend?: () => Promise<void>) => MessageContext

type Sender = BuildContextDeps['send']

/** `send` preceded by `beforeSend`; unchanged (no extra tick) without one. */
function gated<T extends Sender | undefined>(send: T, beforeSend?: () => Promise<void>): T {
  if (!send || !beforeSend) return send
  return (async (chatId, content, opts) => { await beforeSend(); return send(chatId, content, opts) }) as T
}

export function createContextFactory(
  k: BotKernel,
  out: OutboundPipeline,
  /** Late-bound `bot.handoff` (`ctx.handoff()`). */
  handoff: (chatId: ChatId, opts?: HandoffOptions) => Promise<boolean>,
): ContextFactory {
  return (inbound, extra = {}, beforeSend) => {
    const stream = out.streamDeps()
    return buildMessageContext({
      inbound,
      tools: k.tools,
      send: gated<Sender>((chatId, content, opts) => out.send(chatId, content, opts, chatId === inbound.from ? 'ctx' : 'api'), beforeSend),
      canRenderForm: k.provider.canRenderForm ? (d, o) => k.provider.canRenderForm!(d, o) : undefined,
      typing: (chatId, state) => out.typing(chatId, state),
      handoff: (chatId, opts) => handoff(chatId, opts),
      user: k.users.for(inbound.senderId),
      i18n: k.i18n,
      ...out.messagingDeps(),
      ...stream,
      ...(beforeSend && stream.streamSend ? { streamSend: gated(stream.streamSend, beforeSend) } : {}),
      ...extra,
    })
  }
}
