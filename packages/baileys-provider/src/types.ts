/**
 * Public types of `@botmesh/baileys` that must not pull Baileys' own declarations into
 * the published `.d.ts` of the main entry: the poll persistence contract and the opaque
 * aliases of the transport-native values (messages, socket, auth state).
 *
 * The native values are typed `unknown` on purpose: their shape belongs to the pinned
 * Baileys release candidate and is not covered by semver. Cast them with your own
 * `@whiskeysockets/baileys` import, or use the typed accessors in
 * `@botmesh/baileys/internal` (`socketOf`, `authStateOf`, no semver).
 */

/**
 * A Baileys message (`WAMessage` of the installed Baileys release): the `raw` of an inbound
 * message, the `native` of a `MessageRef` and the `raw` of a `SendResult`. Opaque: its
 * fields are not part of the `@botmesh/baileys` API.
 */
export type BaileysNativeMessage = unknown

/**
 * The live Baileys socket (`ReturnType<typeof makeWASocket>`), or what
 * `provider.socket` returns. Opaque: use `socketOf(provider)` from
 * `@botmesh/baileys/internal` for a typed handle (no semver).
 */
export type BaileysSocket = unknown

/**
 * The multi-file auth state Baileys loaded for the session (`provider.auth`). Opaque:
 * use `authStateOf(provider)` from `@botmesh/baileys/internal` for a typed handle.
 */
export type BaileysAuthState = unknown

export interface PollOption {
  name: string
  /** Hex SHA-256 of the option name: what a decrypted vote selects. */
  hash: string
}

/**
 * The JSON-safe record a {@link PollStore} keeps for one poll: what a later
 * process needs to decrypt, bind and tally its votes. No message bodies beyond
 * the poll question and option names.
 */
export interface StoredPoll {
  /** The poll message id (the store key). */
  id: string
  /** The poll message key: its chat and creator, as Baileys delivered it. */
  key: {
    remoteJid: string
    remoteJidAlt?: string
    participant?: string
    participantAlt?: string
    fromMe: boolean
  }
  /** The poll question. */
  name: string
  /** Base64 of the poll's 32-byte messageSecret (the vote decryption key material). */
  secret: string
  /** Option names with their hex SHA-256, in the poll's order. */
  options: PollOption[]
  /** Latest selection per canonical voter id (empty `hashes` = retracted). */
  votes: Array<{ voter: string; hashes: string[]; at: number }>
  /** Poll creation time, unix seconds, when known. */
  timestamp?: number
}

/**
 * Pluggable persistence for polls, so votes cast after a restart can still be
 * decrypted and tallied. Keyed by poll message id. The provider calls `set`
 * when it first sees a poll and after every counted vote, `get` when a vote
 * names a poll missing from its in-memory cache (or a new poll reuses an id),
 * and `delete` when a stored entry is malformed. Retention (TTL, cleanup) is up
 * to the host. A rejecting call is logged and never breaks sends or ingress.
 * The entry holds the poll's secret: keep the store as private as the session.
 */
export interface PollStore {
  get(pollId: string): Promise<StoredPoll | null | undefined>
  set(pollId: string, poll: StoredPoll): Promise<void>
  delete(pollId: string): Promise<void>
}
