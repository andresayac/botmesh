---
'create-botmesh': patch
---

`npm start` in a project generated from the `meta`, `telegram`, `ai` or `ai-full` template checks the variables it cannot run without and, when `.env` is missing or incomplete, stops with one line naming them (`Missing TELEGRAM_TOKEN: copy .env.example to .env ...`) before building any provider. The AI templates also warn at boot under `npm run dev` when `ANTHROPIC_API_KEY` is unset. Package names derived from a directory keep accented letters as their base letter (`Mi Bót` → `mi-bot`, was `mi-b-t`).
