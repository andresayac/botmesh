---
"@botmesh/core": minor
"@botmesh/baileys": patch
"@botmesh/meta": patch
"@botmesh/telegram": patch
---

`@bot-wa/core`: new optional `ProviderCapabilities.textFormat` (`TextFormat`: `'whatsapp' | 'markdown' | 'html' | 'plain'`), the rich-text dialect a channel renders, so Markdown producers (e.g. `@bot-wa/ai`) can convert their text. `MockProvider` accepts `textFormat`.

`@bot-wa/baileys` and `@bot-wa/meta` declare `textFormat: 'whatsapp'`; `@bot-wa/telegram` declares `'plain'` (text is sent without `parse_mode`).
