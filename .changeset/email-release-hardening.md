---
"@botmesh/email": patch
---

Harden inbound header parsing and outbound validation: addresses with whitespace or control
characters are rejected (they never reach the SMTP envelope), Message-IDs over 998 characters are
ignored and `References` chains are capped at 100 ids, replies only thread on real Message-IDs, a
`Date` header in the future no longer becomes `ctx.timestamp`, invalid attachment media types or
control characters in native attachment fields reject with `UnsupportedContentError`, and TLS
mismatches, missing mailboxes and SMTP connection failures reject with actionable messages.
