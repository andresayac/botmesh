/** The chat key with the core's formula (per-participant scope in groups, the default). */
export function chatKeyOf(ctx: { from: string; sender: string; isGroup: boolean }): string {
  return ctx.isGroup ? `${ctx.from}:${ctx.sender}` : ctx.from
}
