/**
 * The outbound pipeline of one bot: sends and edits through the `before('send')` /
 * `after('send')` hooks, the outbound ledger, paced (delay + typing) replies, typing
 * indicators and the `ctx.stream()` primitives.
 */
import { Buffer } from 'node:buffer'
import { abortableSleep, randomId } from '../../utils/timers.js'
import { isEditableSend, messagingSupport, type ReplyOptions } from '../messaging.js'
import { RateLimitedError, type BuildContextDeps, type DraftOptions } from '../provider.js'
import { toStoredError } from '../ledger.js'
import { assertOutboundContent } from '../outboundCheck.js'
import { splitMessage } from '../../streaming/split.js'
import { isSendDeferred } from '../../durability/bind.js'
import type { ChatId, MessageRef, OutboundContent, SendOptions, SendResult, SentMessage } from '../types.js'
import type { TextFormat } from '../provider.js'
import { assertCoordinated, type BotKernel } from './kernel.js'
import { SPAN_NAMES, TRACE_ATTR } from '../../telemetry/attributes.js'
import type { BotSpan } from '../../telemetry/types.js'

export type ContextStreamDeps = Pick<BuildContextDeps, 'capabilities' | 'textFormatFor' | 'streamSend' | 'streamEdit' | 'sendDraft' | 'deleteStreamMessage' | 'stopSignal'>
export type ContextMessagingDeps = Pick<BuildContextDeps, 'pace' | 'editMessage' | 'sendClock' | 'supports'>

/**
 * A `ctx` reply that hits a `RateLimitedError` is retried in place (same payload, no hooks
 * re-run) when the transport asks for a short wait, so a conversation step does not end
 * on a transient 429. Longer waits, other errors and `bot.send()` (broadcasts have their
 * own back-off) surface as before; durable sends retry through their outbox instead.
 */
const CTX_RATE_LIMIT_RETRIES = 2
const CTX_RATE_LIMIT_MAX_WAIT_MS = 5_000

function shortRateLimit(error: unknown): number | undefined {
  if (!(error instanceof RateLimitedError)) return undefined
  const wait = Number(error.retryAfterMs)
  return Number.isFinite(wait) && wait >= 0 && wait <= CTX_RATE_LIMIT_MAX_WAIT_MS ? wait : undefined
}

/** A usable text limit (a positive finite number), else `undefined`. */
function validLimit(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : undefined
}

/** Options of part `i` of a split text: only the first quotes; explicit keys get `#n`. */
function partOptions(options: SendOptions | undefined, i: number): SendOptions | undefined {
  if (!options || i === 0) return options
  const { quoted: _quoted, ...rest } = options
  if (rest.idempotencyKey !== undefined) rest.idempotencyKey = `${rest.idempotencyKey}#${i + 1}`
  return rest
}

export class OutboundPipeline {
  constructor(private readonly k: BotKernel) {}

  /**
   * Central outbound path: `before('send')` (mutable/abortable) → provider.send → `after('send')`.
   * Both `bot.send` and every `ctx.reply`/`ctx.photo`/… reply helper route through here
   * (`ctx.edit` uses the twin {@link edit}). Any send that is not a `ctx` reply to its
   * own chat (`bot.send`, `sendTo` from a human agent, campaigns) ticks `externalSends`,
   * so an implicit `ctx.edit(content)` never edits a reply that was followed by it.
   */
  send(chatId: ChatId, content: OutboundContent, options?: SendOptions, origin: 'ctx' | 'api' = 'api', stream?: 'message'): Promise<SendResult> {
    // A text over the transport's limit goes out as several sends (BotConfig.splitLongText).
    const parts = stream ? undefined : this.textParts(chatId, content)
    if (parts && parts.length > 1) return this.sendParts(chatId, parts, options, origin)
    // Only trimmed whitespace made it fit: send that one part.
    if (parts?.length === 1) return this.sendOne(chatId, { kind: 'text', text: parts[0] as string }, options, origin, stream)
    return this.sendOne(chatId, content, options, origin, stream)
  }

  /** One send through the pipeline (see {@link send}). */
  private sendOne(chatId: ChatId, content: OutboundContent, options: SendOptions | undefined, origin: 'ctx' | 'api', stream?: 'message'): Promise<SendResult> {
    // Tracing: one `bot.send` span (kind client); the provider call runs inside it, so the
    // backend's http instrumentation nests under it. No content, only its kind.
    return this.traceSend(chatId, content, { [TRACE_ATTR.sendOrigin]: origin, [TRACE_ATTR.sendStream]: stream },
      (span) => this.sendNow(chatId, content, options, origin, stream, span), isSendDeferred)
  }

  /**
   * The parts of a `text` send that exceeds `capabilities.maxTextLength`/`maxTextBytes`,
   * cut in the chat's text format; `undefined` when it fits, is not text, or splitting is
   * off (`BotConfig.splitLongText: false`).
   */
  private textParts(chatId: ChatId, content: OutboundContent): string[] | undefined {
    // A non-string text is left to assertOutboundContent (a TypeError naming the field).
    if (content.kind !== 'text' || typeof content.text !== 'string' || this.k.config.splitLongText === false) return undefined
    const { provider } = this.k
    const caps = provider.capabilities
    const maxLength = validLimit(caps?.maxTextLength)
    const maxBytes = validLimit(caps?.maxTextBytes)
    if (maxLength === undefined && maxBytes === undefined) return undefined
    const text = content.text
    if ((maxLength === undefined || text.length <= maxLength) && (maxBytes === undefined || Buffer.byteLength(text, 'utf8') <= maxBytes)) return undefined
    let format: TextFormat | undefined
    try { format = provider.textFormatFor?.(chatId) ?? caps.textFormat } catch { format = caps.textFormat }
    const parts = splitMessage(text, {
      ...(maxLength !== undefined ? { maxLength } : {}),
      ...(maxBytes !== undefined ? { maxBytes } : {}),
      ...(format !== undefined ? { format } : {}),
    })
    return parts.length > 0 ? parts : undefined
  }

  /**
   * Send the parts of a split text in order, each a full send (hooks, ledger, outbox).
   * Only the first part quotes; an explicit idempotency key gets a per-part suffix.
   */
  private async sendParts(chatId: ChatId, parts: string[], options: SendOptions | undefined, origin: 'ctx' | 'api'): Promise<SendResult> {
    const results: SendResult[] = []
    for (const [i, text] of parts.entries()) {
      results.push(await this.sendOne(chatId, { kind: 'text', text }, partOptions(options, i), origin))
    }
    const last = results[results.length - 1] as SendResult
    return { ...last, parts: results.map((r) => r.ref) }
  }

  /** The body of {@link send}; `span` is its `bot.send` span when traced (outcome attributes). */
  private async sendNow(
    chatId: ChatId, content: OutboundContent, options: SendOptions | undefined, origin: 'ctx' | 'api', stream: 'message' | undefined, span?: BotSpan,
  ): Promise<SendResult> {
    const { hooks, provider, counters, inflightSends, messageLog, config } = this.k
    // Durability: an idempotency key already sent is answered from the outbox (no hooks, no provider call).
    const durable = this.k.durable?.prepareSend(options)
    if (durable) {
      const prior = await durable.prior(chatId, content)
      if (prior) { span?.setAttribute(TRACE_ATTR.sendOutcome, 'deduplicated'); return prior }
      options = durable.options
    }
    const payload: { chatId: ChatId; content: OutboundContent; options?: SendOptions; stream?: 'message' } = { chatId, content, options }
    if (stream) payload.stream = stream
    if (!(await this.runBeforeSend(payload))) return this.skipped({ id: 'skipped', chatId: payload.chatId }, span)
    assertOutboundContent(payload.content)
    assertCoordinated(this.k)
    const localRef = { id: randomId('out'), chatId: payload.chatId }
    const op = durable
      ? durable.run(payload, () => provider.send(payload.chatId, payload.content, payload.options))
      : origin === 'ctx' && !stream
        ? this.sendRetryingRateLimit(payload)
        : provider.send(payload.chatId, payload.content, payload.options)
    inflightSends.add(op)
    // Pending from the provider call on, so a stop() that starts while it is in flight
    // still lets its bookkeeping (after-send hooks + ledger row) land before the store closes.
    const recorded = this.ledgerWrite()
    try {
      let res: SendResult
      try { res = await op } catch (error) { counters.outbound(false); throw error }
      counters.outbound(true)
      span?.setAttribute(TRACE_ATTR.sendOutcome, 'ok')
      if (isEditableSend(payload.content)) {
        if (origin !== 'ctx') this.k.externalSends.mark(payload.chatId)
      }
      await hooks.runAfter('send', payload)
      await messageLog.outbound({
        ref: res.ref,
        chatId: payload.chatId,
        content: payload.content,
        options: payload.options,
        status: 'sent',
        raw: config.persistRaw ? res.raw : undefined,
      })
      return res
    } catch (error) {
      // Deferred to the outbox sweeper: not failed (the ledger row is written when it goes out).
      if (isSendDeferred(error)) { span?.setAttribute(TRACE_ATTR.sendOutcome, 'deferred'); throw error }
      span?.setAttribute(TRACE_ATTR.sendOutcome, 'failed')
      await messageLog.outbound({
        ref: localRef,
        chatId: payload.chatId,
        content: payload.content,
        options: payload.options,
        status: 'failed',
        error: toStoredError(error),
      })
      throw error
    } finally {
      inflightSends.delete(op)
      recorded()
    }
  }

  /** `provider.send` with the short rate-limit retry of `ctx` replies (see {@link CTX_RATE_LIMIT_RETRIES}). */
  private async sendRetryingRateLimit(payload: { chatId: ChatId; content: OutboundContent; options?: SendOptions }): Promise<SendResult> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.k.provider.send(payload.chatId, payload.content, payload.options)
      } catch (error) {
        const wait = attempt < CTX_RATE_LIMIT_RETRIES ? shortRateLimit(error) : undefined
        const stop = this.k.state.sendsAbort.signal
        if (wait === undefined || stop.aborted) throw error
        await abortableSleep(wait, stop)
        if (stop.aborted) throw error
        assertCoordinated(this.k)
      }
    }
  }

  /**
   * Edit path behind `ctx.edit`: the same `before('send')` → provider → `after('send')`
   * pipeline as {@link send}, with the payload carrying `edit: ref` so hooks can
   * tell edits apart. A hook may rewrite `payload.content` or `abort()` (→ `skipped`).
   * The ledger entry of `ref` is updated in place with the edited content.
   */
  edit(ref: MessageRef, content: OutboundContent): Promise<SendResult> {
    return this.traceSend(ref.chatId, content, { [TRACE_ATTR.sendEdit]: true }, (span) => this.editNow(ref, content, span))
  }

  /**
   * The `bot.send` span shared by {@link send} and {@link edit} (`attributes` add to the
   * provider id and content kind). Untraced bots call `run` directly, with no span.
   */
  private traceSend(
    chatId: ChatId, content: OutboundContent, attributes: Record<string, string | boolean | undefined>,
    run: (span?: BotSpan) => Promise<SendResult>, expected?: (error: unknown) => boolean,
  ): Promise<SendResult> {
    const tracing = this.k.tracing
    if (!tracing) return run()
    const all = { [TRACE_ATTR.providerId]: this.k.provider.id, [TRACE_ATTR.contentKind]: content.kind, ...attributes }
    return tracing.trace(SPAN_NAMES.send, { kind: 'client', attributes: all }, (span) => {
      tracing.setIds(span, { chatId })
      return run(span)
    }, expected)
  }

  /** `before('send')` with the abortable payload; resolves `false` when a hook aborted. */
  private runBeforeSend<P extends { chatId: ChatId; content: OutboundContent; options?: SendOptions }>(payload: P): Promise<boolean> {
    return this.k.hooks.runBefore('send', payload as P & { abort(): void })
  }

  /**
   * Mark a send as pending in `ledgerWrites` from its provider call until its bookkeeping
   * (after-send hooks + ledger row) is done, so `stop()` does not close the store under it;
   * call the returned function when it is done. A plain deferred: no extra await on the send path.
   */
  private ledgerWrite(): () => void {
    const writes = this.k.ledgerWrites
    let done!: () => void
    const pending = new Promise<void>((resolve) => { done = resolve })
    writes.add(pending)
    return () => { writes.delete(pending); done() }
  }

  /** The `skipped` result of a send a `before('send')` hook aborted (outcome on the span). */
  private skipped(ref: MessageRef, span: BotSpan | undefined): SendResult {
    span?.setAttribute(TRACE_ATTR.sendOutcome, 'skipped')
    return { ref, skipped: true }
  }

  private async editNow(ref: MessageRef, content: OutboundContent, span?: BotSpan): Promise<SendResult> {
    const { hooks, provider, inflightSends, messageLog, config } = this.k
    const payload: { chatId: ChatId; content: OutboundContent; options?: SendOptions; edit: MessageRef } = {
      chatId: ref.chatId, content, options: undefined, edit: ref,
    }
    if (!(await this.runBeforeSend(payload))) return this.skipped(ref, span)
    assertOutboundContent(payload.content)
    assertCoordinated(this.k)
    const op = provider.editMessage!(ref, payload.content)
    inflightSends.add(op)
    const recorded = this.ledgerWrite()
    try {
      const res = await op
      span?.setAttribute(TRACE_ATTR.sendOutcome, 'ok')
      await hooks.runAfter('send', payload)
      await messageLog.edit(ref, payload.content, config.persistRaw ? res.raw : undefined)
      return res
    } finally {
      inflightSends.delete(op)
      recorded()
    }
  }

  /**
   * Run a ctx text reply through the pacer. The wait (delay + typing) is tracked as an
   * in-flight send so `stop({ drain: true })` waits for it; the reply is dropped
   * (`skipped`) if, by the end of the wait, the bot is stopping or the chat was handed
   * off meanwhile (a reply that started in an already handed-off chat still goes out).
   */
  paced(chatId: ChatId, text: string, opts: ReplyOptions | undefined, send: () => Promise<SentMessage>): Promise<SentMessage> {
    const tracing = this.k.tracing
    if (tracing?.paceSpans) {
      // Tracing: `bot.pace` covers the wait (delay + typing) and the send it releases.
      const started = Date.now()
      let sendAt: number | undefined
      return tracing.trace(SPAN_NAMES.pace, {}, (span) => {
        const op = this.pacedNow(chatId, text, opts, () => { sendAt = Date.now(); return send() })
        op.then((r) => {
          span.setAttribute(TRACE_ATTR.paceMs, (sendAt ?? Date.now()) - started)
          if (r.skipped) span.setAttribute(TRACE_ATTR.sendOutcome, 'skipped')
        }, () => {})
        return op
      })
    }
    return this.pacedNow(chatId, text, opts, send)
  }

  private pacedNow(chatId: ChatId, text: string, opts: ReplyOptions | undefined, send: () => Promise<SentMessage>): Promise<SentMessage> {
    const { isHandedOff, state, inflightSends } = this.k
    const handedOffAtStart = isHandedOff(chatId)
    const op = this.k.pacer.run(chatId, text, opts, send, {
      cancelled: () => !state.pacedSendsOpen || (!handedOffAtStart && isHandedOff(chatId)),
      skip: () => ({ ref: { id: 'skipped', chatId }, id: 'skipped', chatId, skipped: true }),
    })
    inflightSends.add(op)
    const settle = () => { inflightSends.delete(op) }
    op.then(settle, settle)
    return op
  }

  /**
   * Best-effort typing indicator for `ctx.typing()` / `ctx.recording()` / streams: a
   * failing provider indicator (rejected or thrown) is logged at debug and swallowed,
   * so it never aborts the reply it decorates — same policy as the BotConfig.typing pacer.
   */
  async typing(chatId: ChatId, state: 'typing' | 'recording' | 'paused'): Promise<void> {
    try {
      assertCoordinated(this.k)
      await this.k.provider.typing?.(chatId, state)
    } catch (error) {
      this.k.logger.debug({ chatId, state, err: error instanceof Error ? error.message : String(error) }, 'typing indicator failed (ignored)')
    }
  }

  /** Typing/delay pacing, edit and capability seams shared by every context this bot builds. */
  messagingDeps(): ContextMessagingDeps {
    const provider = this.k.provider
    return {
      pace: (chatId, text, opts, send) => this.paced(chatId, text, opts, send),
      editMessage: provider.editMessage ? (ref, content) => this.edit(ref, content) : undefined,
      sendClock: this.k.externalSends,
      supports: (feature) => messagingSupport(provider, feature),
    }
  }

  /**
   * `ctx.stream()` backing: capabilities + the provider's edit/draft primitives (when present),
   * plus the per-chat text format behind `ctx.textFormat` (`IProvider.textFormatFor`).
   * Live previews run the same `before('send')` hooks as a real send (the payload carries
   * `stream: 'draft' | 'edit'`), so a hook that redacts, translates or aborts a reply also
   * covers the in-place updates. `after('send')` stays reserved for real messages. The
   * stream's new messages take the normal send path with `stream: 'message'`.
   */
  streamDeps(): ContextStreamDeps {
    const p = this.k.provider
    return {
      capabilities: p.capabilities,
      textFormatFor: p.textFormatFor ? (chatId) => p.textFormatFor!(chatId) : undefined,
      streamSend: (chatId, content, o) => this.send(chatId, content, o, 'ctx', 'message'),
      streamEdit: p.editMessage ? (ref, content) => this.streamEdit(ref, content) : undefined,
      sendDraft: p.sendDraft ? (chatId, draftId, text, opts) => this.streamDraft(chatId, draftId, text, opts) : undefined,
      deleteStreamMessage: p.deleteMessage ? (ref) => this.deleteStreamMessage(ref) : undefined,
      stopSignal: () => this.k.state.sendsAbort.signal,
    }
  }

  /** A discarded `ctx.stream()` message: gone from the chat and from the message log. */
  private async deleteStreamMessage(ref: MessageRef): Promise<void> {
    assertCoordinated(this.k)
    await this.k.provider.deleteMessage!(ref)
    try {
      await this.k.store.deleteMessage(ref)
    } catch (error) {
      this.k.events.error({ error })
    }
  }

  /** `before('send')` for a live preview. Resolves the (possibly rewritten) content, or `undefined` when a hook aborted. */
  private async runStreamSendHooks(chatId: ChatId, content: OutboundContent, stream: 'draft' | 'edit'): Promise<OutboundContent | undefined> {
    const payload: { chatId: ChatId; content: OutboundContent; options?: SendOptions; stream: 'draft' | 'edit' } = { chatId, content, stream }
    return (await this.runBeforeSend(payload)) ? payload.content : undefined
  }

  /** A `ctx.stream()` edit: send hooks, provider edit, then the message log is updated to the shown text. */
  private streamEdit(ref: MessageRef, content: OutboundContent): Promise<unknown> {
    return this.traceStreamUpdate('edit', () => this.streamEditNow(ref, content))
  }

  /**
   * Tracing of a `ctx.stream()` preview update: a `bot.stream.update` span with
   * `spans.streamUpdates`, else just an event on the active span (they are many).
   * Untraced bots just `run`.
   */
  private traceStreamUpdate<T>(kind: 'edit' | 'draft', run: () => Promise<T>): Promise<T> {
    const tracing = this.k.tracing
    if (!tracing) return run()
    if (tracing.streamSpans) {
      return tracing.trace(SPAN_NAMES.streamUpdate, { kind: 'client', attributes: { [TRACE_ATTR.sendStream]: kind } }, run)
    }
    tracing.activeSpan()?.addEvent(SPAN_NAMES.streamUpdate, { [TRACE_ATTR.sendStream]: kind })
    return run()
  }

  private async streamEditNow(ref: MessageRef, content: OutboundContent): Promise<unknown> {
    const final = await this.runStreamSendHooks(ref.chatId, content, 'edit')
    if (!final) return undefined
    assertCoordinated(this.k)
    const res = await this.k.provider.editMessage!(ref, final)
    await this.k.messageLog.streamEdit(ref, final)
    return res
  }

  /** A `ctx.stream()` draft: send hooks, then the provider draft (skipped when aborted or no longer text). */
  private streamDraft(chatId: ChatId, draftId: number, text: string, opts?: DraftOptions): Promise<void> {
    return this.traceStreamUpdate('draft', () => this.streamDraftNow(chatId, draftId, text, opts))
  }

  private async streamDraftNow(chatId: ChatId, draftId: number, text: string, opts?: DraftOptions): Promise<void> {
    const final = await this.runStreamSendHooks(chatId, { kind: 'text', text }, 'draft')
    if (!final || final.kind !== 'text') return
    assertCoordinated(this.k)
    await this.k.provider.sendDraft!(chatId, draftId, final.text, opts)
  }
}
