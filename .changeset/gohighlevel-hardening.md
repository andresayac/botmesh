---
"@botmesh/gohighlevel": patch
---

Email `InboundMessage` bodies (HTML) now arrive as plain text in `ctx.body`, with the subject,
thread id and email message id in `ctx.chat.platformData`; `ctx.raw.body` keeps the HTML.
`accessToken` is validated at construction (string, no `Bearer ` prefix, no spaces, line breaks or
non-ASCII characters, which made every send fail with an error quoting the token), `baseUrl` must be
an absolute http(s) URL, and channel names in `defaultChannel` / `platformData.type` match in any
casing. Entity and channel-name lookups ignore `Object.prototype` names, so an email
containing `&constructor;` or a webhook `messageType` of `constructor` no longer injects function
source into `ctx.body` or the chat's channel.
