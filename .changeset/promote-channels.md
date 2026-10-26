---
"@botmesh/discord": major
"@botmesh/twilio": major
"@botmesh/gupshup": major
"@botmesh/email": major
"@botmesh/gohighlevel": major
---

First npm release of the Discord, Twilio, Gupshup, email and HighLevel channels (they were
private workspace packages). The API was frozen for the release: each main entry keeps what an
application needs (provider class, config types, typed error mapper, signature helpers) and is
covered by semver; the wire mappers, gateway/REST clients, MIME helpers and payload types moved
to a new `/internal` entry with no semver promise. `debug` is deprecated in favour of `logger`
and Discord's `GatewayIntents` is frozen.
