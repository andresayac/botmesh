/**
 * Automatic acknowledgement of interactions on transports with a hard ack deadline
 * (`capabilities.interactionsRequireAck`, e.g. Discord's ~3 s): exactly one ack per
 * interaction, sent by the first of `ctx.acknowledge()`, the context's first send, a
 * timer shortly before `respondBy`, or the end of the dispatch. Transports without the
 * capability never build one, so their path is unchanged.
 */

/** How long before `respondBy` the timer sends a deferred ack. */
export const INTERACTION_ACK_MARGIN_MS = 500

export interface InteractionAckDeps {
  ack(interactionId: string, opts: { text?: string; defer?: boolean }): Promise<void>
  /** A failed automatic ack (never thrown: the reply still goes out). */
  onError(error: unknown): void
}

export class InteractionAck {
  /** Settled (never rejects) once an ack went out or failed. */
  private sent: Promise<void> | undefined
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly id: string, private readonly deps: InteractionAckDeps, respondBy?: number) {
    if (respondBy !== undefined) {
      this.timer = setTimeout(() => { void this.ensure() }, Math.max(0, respondBy - INTERACTION_ACK_MARGIN_MS - Date.now()))
      this.timer.unref?.()
    }
  }

  /**
   * `ctx.acknowledge(text)`: sends the ack with `text` and resolves `true`, or resolves
   * `false` when an ack already went out (the caller then delivers `text` as a reply).
   * A failure rejects, as an explicit ack always did.
   */
  async acknowledge(text?: string): Promise<boolean> {
    if (this.sent) { await this.sent; return false }
    this.stopTimer()
    const p = this.deps.ack(this.id, text !== undefined ? { text } : {})
    this.sent = p.then(() => undefined, () => undefined)
    await p
    return true
  }

  /** Deferred ack unless one already went out; never rejects. */
  ensure(): Promise<void> {
    if (!this.sent) {
      this.stopTimer()
      this.sent = this.deps.ack(this.id, { defer: true }).then(() => undefined, (error: unknown) => { this.deps.onError(error) })
    }
    return this.sent
  }

  private stopTimer(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined }
  }
}
