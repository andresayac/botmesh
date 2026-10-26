---
'@botmesh/baileys': minor
---

API freeze of the WhatsApp (Baileys) transport before stable:

- **Native values are opaque.** `BaileysProvider` implements `IProvider<BaileysNativeMessage>`; `provider.socket` is `BaileysSocket | null` and `provider.auth` is `BaileysAuthState`. The three new aliases are `unknown`, so no `@whiskeysockets/baileys` type reaches the main entry's declarations (`pnpm api-check` now fails if one does). Runtime values are unchanged. **Breaking (types):** code that used the socket's methods through `provider.socket` needs `socketOf(provider)` from `@botmesh/baileys/internal`, or a cast.
- **New `@botmesh/baileys/internal` entry (no semver):** the JID helpers, `IdentityStore`, `canonicalKey`, the mappers (`toInbound`, `toOutbound`, `toCallEvent`, `mapSendError`), media processing, ffmpeg resolution, reconnect classification, the session-path helpers, the Baileys logger adapter, and the typed handles `socketOf(provider)` / `authStateOf(provider)`. The main entry keeps `BaileysProvider` and its option types, `toJid`, `isEditedMessage`, `RateLimiter`/`RateLimiterTimeout` and the `PollStore` types; the other names stay as `@deprecated` aliases until v3. **Breaking:** `toInbound` and `toOutbound` are no longer exported by the main entry (their signatures use Baileys' types).
- **`pairingPhoneNumber`** replaces `pairingCode` (deprecated alias; the value was always the bot's phone number). Both set to different numbers throws a `TypeError`.
- **`debug` is deprecated** in favour of `logger` (any `LoggerLike`).
- The JID predicates (`isGroup`, `isPn`, `isLid`, `isBroadcast`, `isNewsletter`) return `boolean` instead of `boolean | undefined`.
- When `ffmpeg-static` is installed without its binary (its build script was skipped), the voice-note error now says to allow that download instead of suggesting to add `ffmpeg-static` again.
- README: the TypeScript note now says that only `@botmesh/baileys/internal` needs `skipLibCheck: true` (the main entry type-checks without it); the entries, opaque native types and the upstream upgrade policy (Baileys stays pinned to `7.0.0-rc14`: no stable 7.x exists on npm).
