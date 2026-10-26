/**
 * `@botmesh/tickets/internal` — helpers of the tickets plugin: the `{{placeholder}}`
 * renderer of its chat messages and the time-zone clock behind the working-hours checks.
 * **No semver guarantee:** any of them may change or disappear in a minor release.
 * Applications use `ticketsPlugin`, `TicketDesk`, the storages and the working-hours helpers
 * from `@botmesh/tickets`.
 *
 * @example
 * ```ts
 * import { renderTemplate } from '@botmesh/tickets/internal'
 * ```
 *
 * @packageDocumentation
 */

export { renderTemplate } from './ticketsPlugin.js'
export { localClock } from './workingHours.js'
