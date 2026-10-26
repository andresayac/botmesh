---
"@botmesh/gupshup": patch
---

`ingest(body, headers, url)` reads the webhook token from the query string of `url`, so the `?token=` callback URL works behind the `@botmesh/server` ingress (it answered 401). Interactive labels are cut to WhatsApp limits on grapheme boundaries (quick-reply titles must stay unique), URL buttons degraded to numbered text keep their link, and 401/403 and network failures carry actionable messages.
