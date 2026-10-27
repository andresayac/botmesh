# Contributing

Thanks for wanting to contribute to `botmesh`. This repo is a transport-agnostic **pnpm monorepo**: the engine is `@botmesh/core` (`packages/core`), surrounded by channels (Baileys, WhatsApp Cloud API, Evolution API, WPPConnect, Twilio, Gupshup, Messenger, Instagram, Telegram, Discord, GoHighLevel, email and TikTok), stores (sqlite/redis/mongo/postgres/mysql), shared infrastructure (`@botmesh/http`, `@botmesh/graph-core`, `@botmesh/wa-gateway-kit`, `@botmesh/server`, `@botmesh/events`, `@botmesh/otel`), plugins (`@botmesh/ai`, `@botmesh/rag`, `@botmesh/voice`, `@botmesh/nlu`, `@botmesh/chatwoot`…), product packages and tooling (`@botmesh/manager`, `create-botmesh`, `@botmesh/mcp`, `@botmesh/sandbox`, `eslint-plugin-botmesh`). See the full table in the [README](README.md#packages). If you are a coding agent, read [`AGENTS.md`](AGENTS.md) too.

## Requirements

- **Node >= 22** (24 LTS recommended).
- **pnpm** (see the version in `packageManager` in `package.json`; install it with `corepack enable`).
- **Docker**, only if you are going to run the store integration tests.

## Getting started

```bash
pnpm install          # install the whole workspace
pnpm build            # compile every package (pnpm -r build, in topological order)
pnpm typecheck        # tsc -p tsconfig.test.json per package (src + tests)
pnpm test             # full suite (pnpm -r test, vitest run per package)
```

Working on a single package (`--filter` uses the `name` from `package.json`, which does not always match the directory):

```bash
pnpm --filter @botmesh/ai test
pnpm --filter @botmesh/core build
pnpm --filter "@botmesh/meta..." build     # the package plus its workspace dependencies
```

Packages resolve each other through `exports` → `lib/` (compiled output): if you change `core` and then test a package that uses it, build `core` first.

**Windows:** start the terminal with the drive letter in **uppercase**. A lowercase drive letter (the usual thing in the VS Code terminal) makes a hand-run `pnpm -r <script>` fail to match the workspace directory, which pulls in the root package and runs everything twice. The root scripts (`pnpm build`, `pnpm test`, `pnpm typecheck`) do not have that problem.

## Store integration tests (Docker)

The store unit tests are hermetic (in-memory fakes or a temporary SQLite file). On top of that, `mongo-store`, `mysql-store`, `postgres-store` and `redis-store` ship a `tests/integration.test.ts` that runs against a **real** server. Each suite reads its `BOTWA_TEST_*_URL` variable and **skips itself when it is not defined**, so `pnpm test` never needs the network.

```bash
# disposable servers (high ports so they do not clash with a local MySQL/Redis)
docker run -d --name botmesh-it-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=botwa -p 55432:5432 postgres:16
docker run -d --name botmesh-it-mysql -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=botwa -p 53306:3306 mysql:8.4
docker run -d --name botmesh-it-mongo -p 57017:27017 mongo:7
docker run -d --name botmesh-it-redis -p 56379:6379 redis:7

export BOTWA_TEST_POSTGRES_URL=postgres://postgres:postgres@127.0.0.1:55432/botwa
export BOTWA_TEST_MYSQL_URL=mysql://root:root@127.0.0.1:53306/botwa
export BOTWA_TEST_MONGO_URL=mongodb://127.0.0.1:57017
export BOTWA_TEST_REDIS_URL=redis://127.0.0.1:56379

pnpm --filter "./packages/*-store" test   # MySQL takes a few seconds to accept connections

docker rm -f botmesh-it-postgres botmesh-it-mysql botmesh-it-mongo botmesh-it-redis
```

`mongo-store` runs on a standalone `mongod` (as above, where `deleteChat` falls back to two deletes) and on a replica set (one transaction). To cover the second path, start the container with `--replSet rs0`, run `docker exec botmesh-it-mongo mongosh --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'` once and add `/?directConnection=true` to the URL. Its suites use the `mongodb` 7 driver; `BOTWA_TEST_MONGO_DRIVER=v6` runs all of them with 6.x (the package accepts both as a peer). `mysql-store` is also checked against MariaDB: `docker run -d --name botmesh-it-mariadb -e MARIADB_ROOT_PASSWORD=root -e MARIADB_DATABASE=botwa -p 53307:3306 mariadb:11` and point `BOTWA_TEST_MYSQL_URL` at port 53307.

On Windows, always use `127.0.0.1` instead of `localhost`: `localhost` resolves to `::1` first and Docker Desktop's IPv6 forwarding accepts the TCP connection only to cut it, so the hooks time out.

`redis-store` also ships suites against a real **Redis Cluster** (`tests/cluster.integration.test.ts` and `tests/cluster-migrate.integration.test.ts`; the second one also uses `BOTWA_TEST_REDIS_URL`). Ports 47100-47105 stay well away from the ones above; the cluster bus (57100-57105) never leaves the container:

```bash
docker run -d --name botmesh-it-redis-cluster -e IP=0.0.0.0 -e INITIAL_PORT=47100 -e MASTERS=3 -e SLAVES_PER_MASTER=1 -p 127.0.0.1:47100-47105:47100-47105 grokzen/redis-cluster:7.0.10
export BOTWA_TEST_REDIS_CLUSTER_URL=redis://127.0.0.1:47100
export BOTWA_TEST_REDIS_CLUSTER_CHAOS=1   # optional: failover and slot migration under load
pnpm --filter @botmesh/redis-store test
docker rm -f botmesh-it-redis-cluster
```

The `redis-store` suites run with node-redis 6 (the `redis` devDependency) by default. `BOTWA_TEST_REDIS_CLIENT=v4` or `v5` runs every one of them with that major instead (the package accepts `redis` `^4.7 || ^5 || ^6` as a peer; `vitest.config.ts` aliases `redis` to the `redis-v4` / `redis-v5` devDependencies). Run the three when you touch the Redis components.

In PowerShell, environment variables are set with `$env:BOTWA_TEST_POSTGRES_URL = 'postgres://postgres:postgres@127.0.0.1:55432/botwa'` (and likewise for the rest). You can define only the ones you care about: the other suites skip themselves.

The test-only variables keep the `BOTWA_TEST_*` prefix of the project's former name (also `BOTWA_FUZZ_SEEDS`). They are internal to this repository, never read by a published package, and stay as they are so existing local setups and scripts keep working.

### Email (`@botmesh/email`) against GreenMail

`packages/email-provider/tests/integration.test.ts` exercises the email provider with real `imapflow` and `nodemailer` against [GreenMail](https://greenmail-mail-test.github.io/greenmail/) (IMAP IDLE, SMTP, threading, attachments, loop protection, restarts and a full `Bot` flow). It turns on with `BOTWA_TEST_EMAIL`:

```bash
docker run -d --name botmesh-it-greenmail \
  -e GREENMAIL_OPTS="-Dgreenmail.setup.test.all -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.auth.disabled" \
  -p 127.0.0.1:3025:3025 -p 127.0.0.1:3143:3143 greenmail/standalone:2.1.3

BOTWA_TEST_EMAIL=1 pnpm --filter @botmesh/email test

docker rm -f botmesh-it-greenmail
```

Host and ports: `BOTWA_TEST_EMAIL_HOST`, `BOTWA_TEST_EMAIL_SMTP_PORT` and `BOTWA_TEST_EMAIL_IMAP_PORT` (default `127.0.0.1`, `3025` and `3143`). More detail in the [package README](packages/email-provider/README.md#integration-tests). If you touch `email-provider`, run it locally: CI does not.

### AI (`@botmesh/ai`) against a real Ollama

`pnpm test` drives the real `@anthropic-ai/sdk`, `openai`, `@google/genai` and `@google/generative-ai` SDKs against local fakes of their HTTP APIs, and the Ollama provider against a fake `/api/chat` server: no network. `packages/ai/tests/ollama-live.test.ts` is an opt-in smoke test against a **real** Ollama with a pulled model (it checks the wiring, not the model's answers):

```bash
BOTWA_TEST_OLLAMA_URL=http://127.0.0.1:11434 BOTWA_TEST_OLLAMA_MODEL=qwen2.5:0.5b \
  pnpm --filter @botmesh/ai exec vitest run tests/ollama-live.test.ts
```

`packages/ai/tests/sdk-wire.test.ts` runs a wire round trip (text, tool call and result, streaming) against the version of each SDK in the lockfile and against the **oldest** version each peer range accepts (installed under aliases: `anthropic-sdk-v0`, `openai-v6`, `google-genai-v2-0`). `packages/ai/tests/sdk-wire-upper.test.ts` runs the same round trip against the **newest** Anthropic, OpenAI and legacy Gemini SDKs, installed in a scratch folder. Run it when you widen a peer range:

```bash
mkdir sdk-upper && cd sdk-upper && npm init -y
npm install --ignore-scripts @anthropic-ai/sdk@^1 openai@^7 @google/generative-ai@0.24
BOTWA_TEST_SDK_UPPER_DIR=$PWD pnpm --filter @botmesh/ai exec vitest run tests/sdk-wire-upper.test.ts
```

## Load, soak and leaks (`pnpm bench:soak`)

`scripts/soak/soak.mjs` drives the `@botmesh/core` runtime (and `@botmesh/ai` with `MockAIProvider`) through `MockProvider`: thousands of chats and group participants running flows (`ask`/validation/retries/timeouts/`delay`), conversations with `c.idle`, `bot.onIdle`, inbound dedupe, handoff, sticky language, `ctx.user`, broadcast, metrics, the typing pacer, streaming and AI tool confirmations (buttons, typed answers, timeouts, `/reset`, stale presses). After every round it waits for the bots to go idle, forces GC and measures heap, active handles (`process.getActiveResourcesInfo()`), internal map sizes, event-loop lag and throughput. At the end it calls `stop({ drain: true })` **under load** and fails (exit code 2) if any timer is still alive. It is not part of `pnpm test`.

```bash
pnpm build                                        # uses the compiled lib/
pnpm bench:soak                                   # a few seconds
pnpm bench:soak -- --chats 2000 --rounds 20       # more load
pnpm bench:soak -- --duration 600                 # a 10-minute soak
pnpm bench:soak -- --fresh 0                      # repeated chats only: the heap must stay flat
pnpm bench:soak -- --json > soak.json             # JSON report
pnpm bench:soak -- --rounds 1 --trace-timers      # where the timers left after stop() come from
```

Options: `--chats`, `--groups`, `--participants`, `--ai-chats`, `--fresh` (new chats per round; they grow `MemoryStore` on purpose and the report measures the heap after deleting them), `--rounds`, `--duration` (seconds), `--json`, `--trace-timers`. Every leak that gets fixed also gets a fast regression test in the normal suite (`packages/core/tests/soak-regressions.test.ts`, `packages/ai/tests/soak-regressions.test.ts`).

## Code rules

- **ESM-only**: `"type": "module"`, relative imports with the `.js` extension (NodeNext). Node >= 22.
- **No `console.*`** in `src/` — use the injected `logger`. The only exceptions are the terminal QR output (it writes to `process.stdout`), the `create-botmesh` CLI (`src/cli.js`) and the unauthenticated-API warning of `@botmesh/manager`.
- **No `any`** in exported public types.
- **TDD**: write the failing test first, then the minimal implementation. Every behaviour change needs its test.
- The AI package loads provider SDKs lazily; never import them at the top level.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/): `feat(scope): ...`, `fix(...)`, `docs(...)`, `refactor(...)`, `test(...)`, `build(...)`, `chore(...)`. Imperative subject, ≤ 72 chars.

## Changesets

Every **user-visible** change to a publishable package (feature, fix, API or behaviour change) carries a *changeset* in the same PR:

```bash
pnpm changeset        # pick packages, bump type (patch/minor/major) and write the note
```

It creates a `.changeset/<name>.md` that is committed with the PR. Not needed for tests, CI, site docs, internal refactors with no observable effect, or private packages (`pnpm changeset --empty` if you want to be explicit). Details in [`.changeset/README.md`](.changeset/README.md).

## Before opening a PR

```bash
pnpm build && pnpm typecheck && pnpm test   # all green
pnpm changeset                              # if anything publishable changed
pnpm run docs                               # optional: checks the site builds with no dead links (use `pnpm run`: `pnpm docs` is a pnpm builtin)
```

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs `build`, `typecheck`, `test` and `test:scripts` on Node 22 and 24 on every push to `main` and on every PR against `main` (plus `pnpm run docs` on Node 24). The store integration tests, `api-check`, `pack:smoke` and `docs:check` do **not** run in CI: run them locally before opening the PR (the store ones only if you touch a store).

## Publishing a version

Versions are managed with [Changesets](https://changesets.dev) (CLI v3) and published **by hand** from the maintainer's machine. There is no release workflow.

**Public packages** (published to npm): `@botmesh/core`; the channels `@botmesh/baileys`, `@botmesh/meta`, `@botmesh/telegram`, `@botmesh/messenger`, `@botmesh/instagram`, `@botmesh/discord`, `@botmesh/evolution`, `@botmesh/wppconnect`, `@botmesh/twilio`, `@botmesh/gohighlevel`, `@botmesh/gupshup` and `@botmesh/email`; the stores `@botmesh/sqlite-store`, `@botmesh/redis-store`, `@botmesh/postgres-store`, `@botmesh/mysql-store` and `@botmesh/mongo-store`; the infrastructure `@botmesh/http`, `@botmesh/graph-core`, `@botmesh/wa-gateway-kit`, `@botmesh/server`, `@botmesh/events` and `@botmesh/otel`; the plugins `@botmesh/ai`, `@botmesh/rag`, `@botmesh/voice`, `@botmesh/nlu`, `@botmesh/dialogflow`, `@botmesh/chatwoot`, `@botmesh/tickets` and `@botmesh/moderation`; and the tooling `@botmesh/flow-schema`, `@botmesh/mcp`, `create-botmesh` and `eslint-plugin-botmesh` (36 in total, all on npm under the `beta` dist-tag since 2026-10-27, with `latest` moved by hand to the same versions).

**Private packages** (`"private": true`, never published): everything else — the experimental `tiktok` channel, `manager`, the product packages (`inbox`, `crm`, `hub`, `campaigns`, `deployments`, `tenant-kv`) and the `@botmesh/sandbox` tooling. The [README](README.md#packages) table is the canonical list.

### The `@bot-wa/*` packages are deprecated

The project was called `@bot-wa/*` until October 2026. Those packages were **deprecated**, not unpublished (unpublishing breaks whoever already installed them), so anyone arriving through the old name sees the pointer to the new one:

```
@bot-wa/core@2.0.0-alpha.2            → Renamed to @botmesh/core
@bot-wa/{baileys,meta,telegram,sqlite-store,redis-store,ai,http,graph-core}@0.2.0-alpha.0
                                     → Renamed to @botmesh/<same name>
create-bot-wa@0.2.0-alpha.0          → Renamed to create-botmesh
```

To reverse a deprecation (for example, to publish a fix under the old name after all), run `npm deprecate "<package>@<version>" ""`. Two things worth knowing if you ever repeat the operation:

- `npm deprecate` is an authenticated write, so an account with `auth-and-writes` 2FA needs a one-time password **per package**, and the range `@*` is not accepted: go version by version. A Granular Access Token marked to bypass 2FA does the whole list in one pass, and it must be kept out of the repo (environment variable only, never a file).
- If `npm` resolves to a pnpm shim in your shell, `npm deprecate` runs pnpm instead, which cannot prompt for the OTP and fails with `ERR_PNPM_UNAUTHORIZED`. Use your Node installation's official npm CLI for that operation, with no pipes, so it can prompt.

Package `CHANGELOG.md` files and `docs/superpowers/` keep the old names on purpose: they narrate what was published under them.

### Flow

1. Every PR carries its changeset (`pnpm changeset`).
2. To publish, on `main` with a clean tree and an npm session (`pnpm login`):

```bash
pnpm version-packages         # changeset version: bumps versions and writes each package CHANGELOG
git add -A                    # the per-package CHANGELOG.md files are new, so -am would miss them
git commit -m "chore(release): version packages"
pnpm changeset publish-plan   # review what is about to be published
pnpm pack:smoke               # packs and installs the tarballs in a clean project (publishes nothing)
pnpm test:scripts             # tests of the scripts/ helpers (smoke-test semver)
pnpm release                  # pnpm clean && pnpm build && changeset publish: publishes and tags <package>@<version>
npm dist-tag add <package>@<version> latest   # for every package just published (see Prerelease mode below)
git push --follow-tags
```

> **Order matters.** A bare `pnpm release` publishes the **current** versions in the `package.json` files and leaves the changesets unconsumed (`changeset publish` does not consume them): the first time it would have shipped `0.1.0` / `2.0.0-alpha.1` with all the pending work left out. Always `version-packages` → commit → `release`.

### Release checklist

Run the whole thing before `changeset publish` (it is the checklist the [`ROADMAP.md`](ROADMAP.md) safety gate asks for); the threat model and its residual risks live in [docs/guide/threat-model.md](docs/guide/threat-model.md).

- [ ] `main` clean, no `wave*` branches or worktrees, everything that gets published already committed.
- [ ] `pnpm build && pnpm typecheck && pnpm test` green (Node 22 and 24; CI covers build, typecheck and test).
- [ ] `pnpm api-check` (0 findings) and `pnpm pack:smoke` (tarballs installed for real and templates resolved).
- [ ] `pnpm version-packages` run and reviewed with `pnpm changeset status --verbose` and `pnpm changeset publish-plan`; commit `chore(release): version packages`.
- [ ] `pnpm run docs:site && pnpm docs:check` with no errors or warnings, and `docs/public/llms.txt` up to date.
- [ ] No secret, session credential or `.env` in the tree or in the tarballs (`git status`, `scripts/pack-smoke.mjs`).
- [ ] Threat model and this checklist reviewed when the release changes surfaces (new channel, new capability, new public package).
- [ ] After publishing: move `latest` to the new versions (`npm dist-tag add <package>@<version> latest`), `npm dist-tag ls` for every package, a clean install from the registry with the right tag, and a smoke `npm create botmesh@beta` in an empty directory.

### Packaging smoke test

`pnpm pack:smoke` (`scripts/pack-smoke.mjs`) simulates installing from npm **without publishing**: it builds, runs `pnpm pack` on every public package into a temporary directory outside the repo, checks each tarball (`main`/`types`/`exports`/`bin` files, README and LICENSE; no `src`, tests, source maps, configs or credentials; `lib/` output without source; `engines`; private or `workspace:` dependencies; sizes) and then, in a clean npm project, installs the tarballs and verifies that every `exports` subpath imports, that a TypeScript consumer compiles with `moduleResolution` `nodenext` and `bundler`, that the optional AI SDKs only fail when used, that the `botmesh` and `create-botmesh` bins work, that no published README has relative links (they break on npmjs.com) and that every `create-botmesh` template resolves its versions against the tarballs and installs **without touching its `@botmesh/*` ranges** (a local, temporary npm registry, `scripts/smoke/registry.mjs`, serves the tarballs to the `@botmesh` scope, so npm itself resolves the ranges, prereleases included) and boots in `botmesh dev`. It needs network access for third-party dependencies and takes a few minutes. Options: `--no-build`, `--no-scaffold-install` (faster), `--keep` (keeps the temporary directory). It is a local script: there is no CI workflow for it.

### Prerelease mode `beta`

The repo is in Changesets' **`beta` prerelease mode** (`.changeset/pre.json`; the alphas were published in `alpha` mode before it). While it stays that way:

- `pnpm version-packages` produces prerelease versions: `@botmesh/core` comes out as `2.0.0-beta.N` and the rest as `x.y.z-beta.N` (e.g. `1.0.0-beta.0`). `pnpm changeset status --verbose` shows the versions that would be generated.
- `pnpm release` publishes under the `beta` dist-tag only; `latest` does not move by itself. After each publish the maintainer moves it by hand for every package just published (`npm dist-tag add <package>@<version> latest`), so a plain `npm i @botmesh/core` installs the newest beta. `@beta` always resolves to the newest beta, even before `latest` is moved.
- `.changeset/pre.json` records the pre-mode state; do not delete or hand-edit it.

To leave prerelease mode once the API settles (a maintainer decision):

```bash
pnpm changeset pre exit    # the next version-packages produces stable versions (no -beta.N) and publishes under latest
```

The scope **`@botmesh`** already exists on npm, and `create-botmesh` is taken by this project; both are prerequisites of the first publish and are done.

### Promoting a private package

Remove `"private": true` from its `package.json`, check that it has `publishConfig.access: "public"`, `repository.directory` and `files`, and add a changeset. No public package may depend on a private one (Changesets rejects it). The versions `create-botmesh` stamps are regenerated from the `package.json` files (`create-botmesh/src/versions.ts`, on `pnpm build` and `pnpm version-packages`).

## Documentation

- VitePress site in `docs/` (`pnpm docs:dev` to preview on `http://localhost:5173/`), published at <https://andresayac.github.io/botmesh/>. Before accepting changes under `docs/`, run `pnpm run docs:site && pnpm docs:check` (broken links and anchors, links that escape the base path, Mermaid diagrams that do not render, repeated headings).
- The site is published **by hand** to GitHub Pages from the `gh-pages` branch; there is no GitHub Actions workflow for it (and none should be added). The maintainer deploys from a clean `main`:

  ```bash
  pnpm docs:deploy             # build with DOCS_BASE=/botmesh/, docs:check, force-push docs/dist to gh-pages
  pnpm docs:deploy --dry-run   # same, but stops before the push and keeps the temp repo for inspection
  ```

  `scripts/docs-deploy.mjs` refuses a dirty working tree or a branch other than `main` (`--force-branch` overrides the branch check), builds the site under the `/botmesh/` base (`pnpm run docs` with `DOCS_BASE=/botmesh/`), runs `docs:check` on that build, adds `.nojekyll` (TypeDoc emits `_`-prefixed files that Jekyll would drop) and pushes `docs/dist` as a single commit (`docs: deploy <sha>`) with `git push --force origin HEAD:gh-pages` from a fresh repo in the OS temp dir. The `gh-pages` history is not kept.
- One-time GitHub setting: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `gh-pages` / `(root)`**.
- `DOCS_BASE` (default `/`) sets the public base path and must start and end with `/`; `DOCS_SITE_URL` (default `https://andresayac.github.io/botmesh/`) is used for `sitemap.xml` and the canonical links. In Git Bash, prefix `MSYS_NO_PATHCONV=1` when setting `DOCS_BASE` by hand, or the shell rewrites `/botmesh/` into a Windows path. `pnpm docs:check` reads the base from `--base=`, `DOCS_BASE` or the build itself.
- API reference generated with TypeDoc (`pnpm docs:api`) — note that TypeDoc runs against TypeScript 5.9 at the root (TypeDoc 0.28 does not support TS 7 yet, which is what compiles the packages).
- Historical designs and decisions: `docs/superpowers/specs/` and `docs/superpowers/plans/`.
