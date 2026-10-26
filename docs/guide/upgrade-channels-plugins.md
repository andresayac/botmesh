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
an identical retry. To keep the old behaviour:

```ts
new BaileysProvider({ session: 'my-bot', editedMessages: 'ignore' })
```

### `@botmesh/ai`

**`provider: 'openai'` with a `baseUrl` sends `max_tokens`.** For any `baseUrl` other than
`api.openai.com` or `*.openai.azure.com`, the output-token cap now goes in `max_tokens`,
which OpenAI-compatible servers (vLLM, LM Studio, gateways) expect. If your `baseUrl` is a
proxy in front of OpenAI and you use an o-series or gpt-5 model, set the field back:

```ts
aiPlugin({ provider: 'openai', baseUrl: 'https://my-proxy.example/v1', maxTokensField: 'max_completion_tokens' })
```

**Memory options fail fast.** An invalid `memory.maxFactLength`, `memory.maxFacts` or
`memory.ttl` now throws a `RangeError` from `aiPlugin()` instead of failing at `plug()` (or,
for `maxFactLength`, silently dropping every fact).

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

### `@botmesh/telegram`

- In webhook mode, `ingest()` after `stop()` answers `503` and emits nothing (Telegram
  redelivers the Update after the restart). Hosts that started the provider again do not
  need to change anything.
- File uploads have their own timeout, `uploadTimeoutMs` (5 minutes by default).

### `@botmesh/sqlite-store`

`saveMessage` and `setCursor` throw a `TypeError` for a message id, chat id, cursor key or
cursor value with a lone UTF-16 surrogate (before, SQLite stored it as U+FFFD and two ids
could share a row). Escape or drop such characters before storing them.

## Private packages

These are not on npm; the notes matter only inside the monorepo or a fork.

- **`@botmesh/chatwoot`:** a webhook signature without `x-chatwoot-timestamp` is rejected
  (it never expired, so a captured request could be replayed). Set
  `webhookAllowUntimedSignature: true` only for a sender that cannot add the timestamp.
- **`@botmesh/discord`:** `ctx.interaction.id` (`interactionId`) is the bare interaction id;
  the token stays in the provider. `acknowledgeInteraction()` still accepts the old
  `"<id>:<token>"` form. Interactions the bot does not acknowledge within `autoAckMs` (2 s)
  are deferred for it; set `autoAckMs: false` to keep doing it yourself.
- **`@botmesh/messenger` / `@botmesh/instagram`:** more than 3 buttons (or 10 list rows) on
  Messenger, or more than 13 quick replies on Instagram, reject with
  `UnsupportedContentError` instead of being cut.
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
