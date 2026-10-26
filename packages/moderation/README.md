# @botmesh/moderation

**Group moderation** plugin for [`@botmesh/core`](https://www.npmjs.com/package/@botmesh/core): time-window anti-spam, word/regex filters, a link filter (invites to other groups) and `warn` / `mute` / `kick` / `delete` actions, with per-group configuration and an admin bypass.

It is transport-agnostic: chat and user ids are opaque strings, links are detected in the message **text**, and every provider capability (delete messages, kick, list admins) is **optional**. When the provider lacks one, the action degrades and the report says so.

## Install

```bash
pnpm add @botmesh/core @botmesh/moderation
```

> **Prerelease.** Until the stable release, npm's `latest` tag can still point to an older build. Add the prerelease dist-tag to get the build these docs describe: `pnpm add @botmesh/core@beta @botmesh/moderation@beta` during the beta (`npm view @botmesh/moderation dist-tags` lists the tags). Once stable, the plain command above works.

## Quick start

```ts
import { Bot } from '@botmesh/core'
import { moderationPlugin } from '@botmesh/moderation'

const bot = new Bot({ provider })

bot.plug(moderationPlugin({
  provider,                                          // enables delete/kick/admins when the provider supports them
  antiSpam: { maxMessages: 5, windowMs: 10_000, action: 'warn' },
  wordFilter: { banned: ['spam', 'scam', /bit\.ly\/\w+/i], action: 'delete' },
  linkFilter: { action: ['delete', 'kick'], allowInvites: ['MY_GROUP_CODE'] },
  warnings: { max: 3, then: 'kick' },
  groups: {
    [staffGroup]: false,                             // no moderation here
    [salesGroup]: { wordFilter: { banned: ['free'] } },
  },
}))

bot.on('moderation', (report) => {
  // { chatId, senderId, rule, detail, ref, results: [{ action, status }], warnings }
})
```

The plugin hooks into `before('message')` with priority `100` (before other hooks and any handler). A message that breaks a rule runs its actions and does **not** reach the handlers. Messages from a muted user are ignored until the mute expires.

**Mind `groupMode`:** the `Bot`'s `groupMode` filter runs **before** `before('message')` hooks. With `groupMode: 'mentions'` or `'commands'`, group messages that do not mention the bot or are not commands never reach moderation (not even anti-spam or the word/link filters). If the bot must moderate the whole group, use `groupMode: 'all'` (the default); the plugin logs a warning at install when it detects a restrictive `groupMode`.

By default it only moderates **groups** (`applyTo: 'all'` includes private chats). Interactions (buttons, slash commands) and the bot's own messages are never moderated.

## Options

`moderationPlugin(config)` takes the rules below (global, and per group in `groups`) plus:

| Option | Default | Description |
| --- | --- | --- |
| `provider` | — | Your provider instance; enables `delete`, `kick` and admin lookups when it supports them. |
| `groups` | — | Per-group overrides, shallow-merged over the global rules; `false` disables moderation in that group. |
| `applyTo` | `'groups'` | `'all'` also moderates private chats. |
| `enabled` | `true` | Master switch (also per group). |
| `admins` | — | User ids exempt from every rule (global or per group). |
| `adminBypass` | `true` | Admins skip every rule. |
| `isAdmin` | — | `(chatId, userId) => boolean \| Promise<boolean>`, e.g. your staff list. |
| `adminCacheMs` | 5 minutes | How long provider admin lists are cached. |
| `muteMs` | 10 minutes | How long `'mute'` ignores a user. |
| `deleteWhileMuted` | `false` | Also delete what a muted user keeps sending. |
| `warnings` | `{ max: 3, then: 'kick' }` | Escalation after N warnings (`'mute'` or `'kick'`); `false` disables it. |
| `kickFallback` | `'mute'` | What `'kick'` does when the provider cannot kick (`'none'` = nothing). |
| `maxTrackedUsers` | `10000` | Most warning counters kept in memory (the least recently warned is dropped). |
| `messages` | built-in | Warning texts (see [Texts](#texts)). |
| `priority` | `100` | `before('message')` priority. |
| `onViolation` | — | Called with every `ModerationReport`, after the actions ran. |

The config is validated when you call `moderationPlugin()` (and again by `setGroupRules`): an unknown action, a non-positive `maxMessages`/`windowMs`/`warnings.max`/`muteMs` or a field of the wrong type throws a `TypeError` or `RangeError` that names the field, e.g. `moderation: groups["sales@g.us"].wordFilter.action must be 'warn', 'mute', 'kick' or 'delete' (or an array of them), got 'ban'`. To turn a rule off, set it to `false`.

## Rules

| Rule | Fields | Default action |
| --- | --- | --- |
| `antiSpam` | `maxMessages`, `windowMs` (sliding window per chat + sender) | `'warn'` |
| `wordFilter` | `banned: (string \| RegExp)[]`, `wholeWord` (default `true`) | `'delete'` |
| `linkFilter` | `groupInvites` (default `true`), `allLinks`, `allowInvites`, `allowDomains`, `invitePatterns` | `['delete', 'warn']` |

- Words are compared without case or accents (`'scam'` detects `'SCÁM'`), except `ñ`, which is a different letter from `n` (`'ano'` does not detect `'año'`), and as a whole word (`'spam'` does not detect `'spammer'` unless `wholeWord: false`). RegExps are tested against the raw text.
- Evasion tricks are folded away before words and links are matched: invisible characters (zero-width spaces and joiners, soft hyphens, bidi controls) are dropped and compatibility forms are read as plain letters, so `sp\u200Bam`, `ｓｐａｍ` and `𝐬𝐩𝐚𝐦` match `'spam'`, and `chat.whats\u200Bapp.com/…` or a fullwidth invite is still an invite.
- An invite host must start its hostname: `chat.me/+abcd`, `mydiscord.gg/x` or `ñchat.whatsapp.com/x` are not invites (`www.t.me/+abcd` is). WhatsApp formatting marks around a link do not hide it: `_chat.whatsapp.com/…_` (italic), `*…*` and `~…~` are still caught, by the invite filter and by `allLinks`.
- `allowInvites` accepts codes or full invite links (with or without `https://`) and compares the **exact code**: a URL that merely contains the code (e.g. in the query) is not allowed.
- Recognized invites: WhatsApp (`chat.whatsapp.com/…`), Telegram (`t.me/+…`, `t.me/joinchat/…`) and Discord (`discord.gg/…`, `discord.com/invite/…`). Add others with `invitePatterns` (the first capture group is the code).
- `action` accepts one or several actions in order: `['delete', 'warn']`.
- `autoKickOnLink: true` is a shortcut for `linkFilter: { action: ['delete', 'kick'] }` and only applies when you do not define `linkFilter` (globally or in the group override).

## Actions and degradation

| Action | How it runs | Without support |
| --- | --- | --- |
| `delete` | `provider.deleteMessage(ref)` | `status: 'unsupported'`. Without `provider` in the config, `ctx.delete()` is used and `'attempted'` is reported (it cannot be verified). |
| `kick` | `provider.groups.removeParticipants(chatId, [userId])` | `'unsupported'` and, by default, degrades to `mute` (`kickFallback: 'none'` avoids it). |
| `mute` | Internal state: the user's messages are ignored for `muteMs` | Always available. |
| `warn` | `bot.send` to the group, quoting the message and mentioning the user | `'failed'` if the send fails. |

Warnings are counted per chat + user; on reaching `warnings.max`, `warnings.then` (`'mute'` or `'kick'`) runs and the counter resets.

The provider `groups` namespace is optional and structural:

```ts
interface GroupAdminApi {
  removeParticipants?(chatId: string, userIds: string[]): Promise<unknown>
  getAdmins?(chatId: string): Promise<readonly string[]>
}
```

No bundled provider exposes it yet, so today `kick` degrades to `mute` and admins come from `admins` / `isAdmin`. You can wrap your provider to add it (for example with your own WhatsApp or Telegram admin calls).

`GroupAdminApi` and `ModerationProvider.groups` are **`@experimental`**: they are outside semver until `@botmesh/core` defines a groups capability for providers, and their shape may change in a minor release. The rest of the API is covered by semver.

## Administrators

With `adminBypass` administrators are not moderated. Considered admins:

1. The ids in `admins` (global or per group).
2. Whoever returns `true` from `isAdmin(chatId, userId)`.
3. Those reported by `provider.groups.getAdmins(chatId)`, cached for `adminCacheMs` and invalidated by the `promote`/`demote` group events.

Admins are looked up only for a message that breaks a rule or comes from a muted user, so `isAdmin` and `getAdmins` are not called for ordinary traffic. If `isAdmin` throws, the sender is treated as a non-admin and a warning is logged (the message is still moderated, never dropped by the error). If `getAdmins` fails, the last known list is kept (or none) and the provider is asked again after `adminCacheMs` or 30 seconds, whichever is shorter.

When someone leaves the group (`remove` event), their warnings, mute and spam window are forgotten. Memory stays bounded: expired mutes and stale admin lists are swept, and at most `maxTrackedUsers` warning counters are kept.

## `ctx.tools.moderation`

```ts
const mod = bot.injectTools.moderation!
mod.mute(chatId, userId, 30 * 60_000)
mod.unmute(chatId, userId)
mod.isMuted(chatId, userId)
mod.warnings(chatId, userId)
mod.resetWarnings(chatId, userId?)
await mod.kick(chatId, userId)                  // → { action: 'kick', status }
mod.setGroupRules(chatId, { antiSpam: false })  // false disables a rule; undefined removes the override
mod.invalidateAdmins(chatId?)
```

`Moderator` (the engine behind the plugin) also works without a bot.

## Texts

```ts
moderationPlugin({
  messages: {
    warn: '⚠️ {name}: {reason}. Warning {count}/{max}.',
    reasons: { antiSpam: 'easy on the messages', wordFilter: 'no insults', linkFilter: 'no links' },
  },
})
```

Without `messages`, the built-in texts follow the chat language: English by default, Spanish with `lang: 'es'`.

`{name}` is the sender's display name as a plain line: control and bidi characters are removed, whitespace is collapsed and it is cut at 64 characters (an empty result falls back to `user` / `usuario`).

## Limitations

- State (spam windows, warnings, mutes) lives in memory: it is lost on restart and is not shared between replicas.
- `kick` and provider admin lists need a provider with the optional `groups` namespace (none of the bundled providers has it yet).

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Nothing is moderated in groups | The bot's `groupMode` is `'mentions'` or `'commands'` (the plugin warns at install): use `'all'`. Also check `groups[chatId] !== false` and `enabled`. |
| Private chats are not moderated | By design: set `applyTo: 'all'`. |
| `delete` reports `'unsupported'` | The provider has no `deleteMessage`, or it cannot delete other people's messages (the bot usually needs to be a group admin). |
| `kick` turns into a mute | No bundled provider exposes `groups.removeParticipants`; see [Actions and degradation](#actions-and-degradation). |
| An admin gets warned | Add the id to `admins` or answer it from `isAdmin`; provider admin lists exist only when the provider exposes `groups.getAdmins`. |
| `moderationPlugin()` throws a `TypeError`/`RangeError` | An option is invalid; the message names the field and what it must be. Use `false` to disable a rule instead of `0`. |
| A word is not caught | Strings match whole words: use `wholeWord: false` or a RegExp for partial matches. |

## Links

- [Integrations guide (moderation)](https://andresayac.github.io/botmesh/guide/integrations#moderation) · [Hooks](https://andresayac.github.io/botmesh/guide/hooks) · [Configuration (`groupMode`)](https://andresayac.github.io/botmesh/guide/configuration) · [Security](https://andresayac.github.io/botmesh/guide/security)
- [Changelog](https://github.com/andresayac/botmesh/blob/main/packages/moderation/CHANGELOG.md) · [Source](https://github.com/andresayac/botmesh/tree/main/packages/moderation) · [Issues](https://github.com/andresayac/botmesh/issues)
