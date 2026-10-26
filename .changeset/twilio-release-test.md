---
"@botmesh/twilio": patch
---

Webhook params named like `Object.prototype` members (`constructor`, `toString`, `__proto__`…) are kept as plain own params: before, they read inherited members or swapped the params object's prototype, and the signature check rejected a correctly signed request. With `webhookPath`, `ingest(body, headers, requestUrl)` now takes the request's query string (which Twilio signs) when `webhookPath` has none; `@botmesh/server` passes it. The constructor rejects whitespace in `accountSid`, `authToken`, `apiKeySid`, `apiKeySecret` and `webhookUrl` and a `whatsapp:` `smsFrom`, and a REST 401 names the credentials to check.
