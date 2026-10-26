---
'create-botmesh': patch
---

- The generated `src/bot.js` of the `ai-full`, `clinic`, `restaurant`, `store` and `support` templates type-check cleanly with `checkJs` (JSDoc types for the profile data read with `ctx.user.get()`, and an optional `store` parameter on the `ai-full` factory), so an editor no longer shows false errors in a fresh project. A test runs `checkJs` over every template.
- "Next steps" prints `copy .env.example .env` on Windows (`cmd.exe` has no `cp`), and the generated README shows both forms.
- The CLI warns up front when Node.js is older than 22.12, which the generated project needs (its scripts use `--env-file-if-exists`), instead of letting `npm start` fail later with Node's own `bad option` error.
