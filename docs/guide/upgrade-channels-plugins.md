# Upgrade notes: channels and plugins

These are the changes since the first alpha (`@botmesh/core@2.0.0-alpha.2`, the rest at
`0.2.0-alpha.0`) that can change how an existing bot behaves, for the channel, store and
plugin packages. Each one says what changed and what to do. Most bots need no change.

## Public packages

### `@botmesh/baileys`

**`toJid()` throws on input it cannot turn into a JID.** It returned
`'@s.whatsapp.net'` for an input without digits, and an invalid `…@g.us:<user>` string for
`{ groupId, userId }`. Both now throw a `TypeError`.

```ts
toJid({ groupId: '120363000000000000', userId: '573001112233' }) // before: invalid string; now: TypeError
toJid({ groupId: '120363000000000000' })                         // '120363000000000000@g.us'
toJid('573001112233')                                           // '573001112233@s.whatsapp.net'
```

A group participant has no JID of its own: use the group JID for the chat and
`toJid(userId)` for the person.

**Text edits reach the bot.** An edited message used to be dropped. It now arrives as a
message with the new text and the **original** `ref.id`, like on Telegram.
`isEditedMessage(ctx)` tells it apart. The core dedupe lets an edit through and still drops
an identical retry. Only an edit of a message this process has seen, sent in the same chat
by the user who sends the edit, is delivered: an edit naming someone else's message, one of
the bot's own or one from another chat is dropped, and so is an edit whose original is no
longer in the provider's message cache (for example after a restart). To keep the old
behaviour:

```ts
new BaileysProvider({ session: 'my-bot', editedMessages: 'ignore' })
```

### `@botmesh/ai`

**`provider: 'openai'` with a `baseUrl` sends `max_tokens`.** For any `baseUrl` other than
`api.openai.com` or Azure OpenAI (`*.openai.azure.com`, `*.cognitiveservices.azure.com`, or
an Azure AI Foundry `*.services.ai.azure.com` endpoint under `/openai`), the output-token cap
now goes in `max_tokens`,
which OpenAI-compatible servers (vLLM, LM Studio, gateways) expect. If your `baseUrl` is a
proxy in front of OpenAI and you use an o-series or gpt-5 model, set the field back:

```ts
aiPlugin({ provider: 'openai', baseUrl: 'https://my-proxy.example/v1', maxTokensField: 'max_completion_tokens' })
```

**Memory options fail fast.** An invalid `memory.maxFactLength`, `memory.maxFacts` or
`memory.ttl` now throws a `RangeError` from `aiPlugin()` instead of failing at `plug()` (or,
for `maxFactLength`, silently dropping every fact).

**`onStreamEnd` has a fixed contract.** `GenerateInput.onStreamEnd(info)` (an
`AIStreamEndInfo`: `stopReason`, plus `usage` on Anthropic and Gemini) is called exactly once
per `stream()` call, after the last chunk and before the iteration completes, and only when
the stream ends normally: never when it fails, is aborted or the consumer breaks out early. An
exception thrown by the callback fails the consumer's iteration. Every built-in provider and
`MockAIProvider` follow it, including the abort rule when the client ignores `signal` (an
aborted stream skips the callback and rejects with the abort reason); a custom `AIProvider`
that calls `onStreamEnd` should too (check `signal.aborted` before calling it).

**Entries and frozen data.** `MockAIProvider` moved to `@botmesh/ai/testing`, the plugin's
helpers and the SDK wire type names to `@botmesh/ai/internal`, and the exported vocabularies,
presets and texts are frozen. See [Migrating to the stable API](./stable-migration#botmesh-ai-entries).

### `@botmesh/meta`

- **Interactive limits are checked before sending.** A `buttons` or `card` with no button,
  repeated button ids or titles (compared after the 20-character cut), a list with no rows,
  more than 10 rows, or repeated row ids now reject with `UnsupportedContentError`. Graph
  rejected them before too, but with an opaque error after the request.
- **An interactive reply that is not a press** (for example `call_permission_reply`)
  arrives as an `unknown` message with the payload in `ctx.ref.native`, not as a `button`
  interaction with empty data. A handler that matched those interactions must read the
  message instead.
- Media uploads have their own timeout, `uploadTimeoutMs` (5 minutes by default).
- **New `lang` option** for the labels `publishForm()` bakes into a Flow (default `'en'`):
  set it to your bot's `BotConfig.lang`. `publishForm(def, { lang })` overrides it.
- **Deprecated (removal in v3):** `toProviderError` (use `toGraphError` from
  `@botmesh/graph-core`), `GraphClient` (transport internals), the re-exported
  `verifyChallenge`/`verifySignature` (use `provider.verifyChallenge(query)` and
  `provider.ingest()`, or import them from `@botmesh/graph-core`) and `debug` (pass a
  `logger`). `phoneNumberId` is typed `string | number`.

### `@botmesh/telegram`

- In webhook mode, `ingest()` after `stop()` answers `503` and emits nothing (Telegram
  redelivers the Update after the restart). Hosts that started the provider again do not
  need to change anything.
- File uploads have their own timeout, `uploadTimeoutMs` (5 minutes by default).
- **Polls are sent non-anonymous and their votes reach the bot.** Each `poll_answer`
  becomes a `'poll'` event with the same shape as on WhatsApp (`vote.ref`, `vote.senderId`,
  `vote.options` with `voters`). Members of the chat can see who voted. Channels refuse public-voter
  polls, so a poll to a channel is retried once as anonymous (no votes) and the channel is
  remembered. To keep anonymous
  polls (and receive no votes):

```ts
new TelegramProvider({ token, anonymousPolls: true })
```

- **`pollTimeoutMs`** replaces `pollTimeout` (seconds, deprecated): `pollTimeout: 30` is
  `pollTimeoutMs: 30_000`. `toProviderError` is now `toTelegramError` (the old name is a
  deprecated alias), `debug` is deprecated (pass a `logger`), and the wire helpers
  `parseUpdate`, `parsePollAnswer`, `toOutbound` and `MEDIA_UPLOAD` are `@experimental`.

### `@botmesh/sqlite-store`

`saveMessage` and `setCursor` throw a `TypeError` for a message id, chat id, cursor key or
cursor value with a lone UTF-16 surrogate (before, SQLite stored it as U+FFFD and two ids
could share a row). Escape or drop such characters before storing them.

**Schema versioning.** The database records its layout in `PRAGMA user_version`
(`SQLITE_SCHEMA_VERSION`, now `2`). Opening a file written by an earlier release (version
`0` or `1`) migrates it in place, keeping every row; nothing to do. Version `2` folds the
durable scheduler's tables (`schedules`, `schedule_fences`) and the durability table
(`durable`) into the versioned migrations: they used to be created ad hoc the first time
`schedules()` or `durability()` was called, and are now created when the file is opened. A file written by a **newer**
release is refused with `SQLiteSchemaVersionError` (`code: 'SQLITE_SCHEMA_TOO_NEW'`) and
left untouched: downgrades are not supported, so back up the file before upgrading if you
may need to roll back.

**Rolling back to the previous alpha.** The previous alpha writes and reads schema version
`1`. Once this release opens a file, the file is at version `2` and the previous alpha
refuses it with `SQLITE_SCHEMA_TOO_NEW` on its next start, even if the app never calls
`schedules()` or `durability()`. This also applies during a rolling deploy: a process still
on the previous alpha that shares the file fails when it restarts, so stop every process
on the old version before the first one on the new version opens the file. To roll back,
restore the copy taken before the upgrade. No rows were changed by the migration (it only
adds tables with `CREATE TABLE IF NOT EXISTS`), so if you have no copy you can set
`PRAGMA user_version = 1` by hand with the `sqlite3` CLI while no process has the file
open, and the previous alpha opens it again. The version bump exists so that later
migrations can assume these tables exist; without it they would stay outside the version.

New options: `busyTimeoutMs` (default 5000, `PRAGMA busy_timeout`)
and a `logger` that takes any `LoggerLike`. The exported `SCHEDULES_SCHEMA` and
`DURABLE_SCHEMA` DDL strings are deprecated.

### `@botmesh/messenger` and `@botmesh/instagram`

Both channels are public from the beta (`1.0.0-beta`), so their first npm release
already has the frozen entry. Inside the monorepo or a fork, an import of a removed name
fails to compile:

| Removed from the main entry | Use instead |
| --- | --- |
| `toProviderError` | `toMessengerError` / `toInstagramError` |
| `verifyChallenge`, `verifySignature` re-exports | `provider.verifyChallenge(query)` / `provider.ingest()`, or `@botmesh/graph-core` |
| `parseInbound`, `toOutbound`, `toOutboundMessages` (Messenger) | `@botmesh/messenger/internal` (no semver) |
| `GraphClient`, `parseInbound`, `toOutbound` (Instagram) | `@botmesh/instagram/internal` (no semver) |
| `GraphSendResponse` (Instagram) | `InstagramSendResponse` (same shape) |

The `debug` option is deprecated in both: pass a `logger` instead. More than 3 buttons
(or 10 list rows) on Messenger, or more than 13 quick replies on Instagram, reject with
`UnsupportedContentError` instead of being cut.

### `@botmesh/evolution`, `@botmesh/wppconnect` and `@botmesh/wa-gateway-kit`

New on npm in the beta (they were private before). If you used them from the monorepo:

- The webhook parsers, outbound mappers and media tokens (`parseWebhook`, `parseMessage`,
  `toOutbound`, `numberedMenu`, `keyFromRef`, `target`, `jidOf`…) and Evolution's JWT helpers
  (`verifyHs256Jwt`, `signHs256Jwt`) moved to `@botmesh/evolution/internal` and
  `@botmesh/wppconnect/internal`, which have no semver guarantee.
- `WaIdentityStore` and `normalizeJid` are no longer re-exported by the providers: import
  them from `@botmesh/wa-gateway-kit`. `IdentityPersistence` and `RestHttpOptions` stay on
  the providers' main entry.
- The `debug` option was removed: pass a `logger` (`pino({ level: 'debug' })`).
- Invalid options throw a `TypeError` (it was a plain `Error`; the messages are the same).

## Private packages

These are not on npm; the notes matter only inside the monorepo or a fork.

- **`@botmesh/chatwoot`:** a webhook signature without `x-chatwoot-timestamp` is rejected
  (it never expired, so a captured request could be replayed). Set
  `webhookAllowUntimedSignature: true` only for a sender that cannot add the timestamp.
- **`@botmesh/discord`:** `ctx.interaction.id` (`interactionId`) is the bare interaction id;
  the token stays in the provider. `acknowledgeInteraction()` still accepts the old
  `"<id>:<token>"` form. Interactions the bot does not acknowledge within `autoAcknowledgeMs` (2 s; `autoAckMs` is its deprecated alias)
  are deferred for it; set `autoAcknowledgeMs: false` to keep doing it yourself.
  Message edits (`MESSAGE_UPDATE`) now arrive as messages with the original `ref.id`
  (`isEditedMessage(ctx)`; `editedMessages: 'ignore'` drops them).
- **Error mappers renamed** (old names are deprecated aliases): `toDiscordError`,
  `toTikTokError`, `toEmailError`.
- **`@botmesh/tickets`:** `TicketKeyValue` has an optional `setIf`. A custom storage that
  implements it switches the desk to shared mode (safe for replicas).
- **Product stores:** `InboxStore.erase`, `ContactStore.erase` and `DeploymentStore.prune`
  are new required methods, and `DeploymentStore.list` / `InboxStore.listNotes` accept an
  `after` cursor. A custom store must add them (the shared conformance suites in
  `test-utils/` check them). `attachInbox()` without `tenantId` now files conversations
  under the bot's own tenant instead of `'local'`.
- **`@botmesh/flow-schema`:** `publishFlow()` takes any registry with a compatible
  `publish()` (a `DeploymentRegistry` fits) and no longer depends on `@botmesh/deployments`
  at run time.
