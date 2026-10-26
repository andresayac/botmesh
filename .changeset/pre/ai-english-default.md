---
'@botmesh/ai': minor
---

**Breaking:** the built-in texts (confirmation prompt, Yes/No buttons, fallback replies, sources line, notes) are English when no language is known, matching the core's new default locale (`'en'`). They used to be Spanish without a context. Inside a bot nothing changes beyond the core default: set `lang: 'es'` (or `i18n: { defaultLocale: 'es' }`) on the `Bot` to keep the Spanish texts, or pass a context with `lang: 'es'` to `aiText()` / `defaultConfirmPrompt()`.
