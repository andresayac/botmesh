---
"@botmesh/core": patch
"@botmesh/baileys": patch
"@botmesh/meta": patch
"@botmesh/telegram": patch
"@botmesh/sqlite-store": patch
"@botmesh/redis-store": patch
"@botmesh/ai": patch
"@botmesh/http": patch
"@botmesh/graph-core": patch
---

Packaging: dependencies between `@bot-wa/*` packages are published as caret ranges (`^x.y.z`, from `workspace:^`) instead of exact versions, so npm dedupes a single `@bot-wa/core` instead of installing a second copy when one package lags a patch behind. Published READMEs use absolute GitHub links (relative links broke on npmjs.com), and `@bot-wa/core`/`@bot-wa/http` gain `repository.directory`, `homepage` and `bugs` metadata.
