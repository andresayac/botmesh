# Mintlify docs

Tooling that publishes the botmesh docs on [Mintlify](https://www.mintlify.com), hosted by Mintlify at
**<https://botmesh.afaya.com.co/>**, the official docs site since 2026-10-27. The old GitHub Pages site
(<https://andresayac.github.io/botmesh/>) only redirects there (see [GitHub Pages redirects](#github-pages-redirects)).
The VitePress pages in [`docs/`](../docs) stay the source of truth: everything Mintlify serves is **generated** from them by
[`scripts/convert.mjs`](scripts/convert.mjs) and pushed to the `main` branch of a separate repository,
[`andresayac/botmesh-docs`](https://github.com/andresayac/botmesh-docs), by `pnpm docs:mintlify`.
A separate repo, because Mintlify's onboarding only accepts a repository whose **default branch**
has `docs.json` at its root, and the generated site must never land on this repo's `main`. Never edit generated pages by hand; change `docs/` and redeploy.

```
mintlify/
  package.json         tooling only (mint CLI, TypeDoc, typedoc-plugin-markdown, yaml, slugify)
  pnpm-lock.yaml       its own lockfile
  pnpm-workspace.yaml  makes this folder its own pnpm root; the monorepo never sees it
  typedoc.json         extends packages/core/typedoc.json, Markdown output
  scripts/convert.mjs  docs/ (+ TypeDoc) -> site/
  scripts/site-map.mjs where each page and each old GitHub Pages URL lands (no dependencies; shared
                       with the redirects of pnpm docs:deploy --redirects)
  assets/              logo and favicon copied into site/
  site/                GENERATED Mintlify project (docs.json + .mdx); git-ignored, never on main
  .cache/              TypeDoc scratch output and anchors.json, the old -> new anchor table (git-ignored)
```

The folder is not a workspace member (`pnpm-workspace.yaml` at the root only lists `packages/*` and
`examples/*`), so `pnpm install`, `pnpm build`, `pnpm test` and `pnpm typecheck` at the root are
unaffected, and the root `package.json` gains no dependency. Install the tooling from this folder
with a plain `pnpm install` (its own `pnpm-workspace.yaml` makes it a separate root and carries the
`allowBuilds` list for `sharp`/`esbuild`; `--ignore-workspace` would skip that list).

## Deploy

From a clean `main` at the repo root (the maintainer runs it; it force-pushes):

```bash
pnpm docs:mintlify                  # generate, check, force-push the site to botmesh-docs (main)
pnpm docs:mintlify --dry-run        # same, but stops before the push and keeps the temp repo
pnpm docs:mintlify --dry-run --force-branch   # from a branch other than main
MINTLIFY_SITE_URL=https://docs.example.com/ pnpm docs:mintlify   # final URL (default https://botmesh.afaya.com.co/)
MINTLIFY_REPO=git@github.com:me/docs.git MINTLIFY_BRANCH=main pnpm docs:mintlify   # other target (default https://github.com/andresayac/botmesh-docs.git, main)
```

[`scripts/mintlify-deploy.mjs`](../scripts/mintlify-deploy.mjs) mirrors `pnpm docs:deploy`:

1. Refuses a dirty working tree or a branch other than `main` (unless `--force-branch`), and checks
   `MINTLIFY_REPO` (https or `git@` URL, no credentials in it) and `MINTLIFY_BRANCH`.
2. Installs the tooling (`pnpm install --frozen-lockfile` in `mintlify/`) if `mint` is missing.
3. Runs the converter with `--llms-base $MINTLIFY_SITE_URL`, so the curated `llms.txt` points at the
   Mintlify site.
4. Runs `mint validate` and `mint broken-links --check-anchors --check-redirects` and stops on any
   error. On Windows the link check runs in Docker (`node:22-bookworm-slim` with the same `mint`
   version), because `mint broken-links` 4.2 reports every nested link as broken there; Docker must
   be running.
5. Copies `mintlify/site` into a fresh git repo in the OS temp dir, with `docs.json` at its **root**,
   makes one commit (`docs: deploy <sha> to Mintlify`) and runs
   `git push --force <MINTLIFY_REPO> HEAD:<MINTLIFY_BRANCH>`.

The docs repo therefore only ever holds one generated commit; Mintlify's GitHub App redeploys on
every push to it. Generated output never lands on `main`.

## Regenerate and preview locally

```bash
cd mintlify
pnpm install                 # first time only (own lockfile, own node_modules)
node scripts/convert.mjs     # docs/ + TypeDoc -> site/   (about 10 s)
node scripts/convert.mjs --skip-api                         # pages only, keep site/api
node scripts/convert.mjs --llms-base https://botmesh.afaya.com.co/   # also publish the curated llms.txt

cd site
../node_modules/.bin/mint dev --port 3333 --no-open     # http://localhost:3333
../node_modules/.bin/mint validate
../node_modules/.bin/mint broken-links --check-anchors --check-redirects   # Linux/macOS (see above for Windows)
```

The converter is deterministic (two runs produce byte-identical output). It wipes `site/` first,
so stop `mint dev` before a full run (the preview exits when `docs.json` disappears).

What it converts:

| VitePress | Mintlify |
| --- | --- |
| `# H1` | `title` front matter (sidebar label from `config.ts` as `sidebarTitle`) |
| short, link-free lead paragraph | `description` (shown under the title, used by llms.txt and SEO) |
| `::: tip / warning / danger / info [Title]` | `<Tip>` / `<Warning>` / `<Danger>` / `<Info>`, title as a bold first line |
| `::: details Title` | `<Accordion title="Title">` |
| ` ```mermaid ` | kept as is (Mintlify renders Mermaid natively, with zoom/pan) |
| `<code v-pre>{{ path }}</code>` | a Markdown code span (`` `{{ path }}` ``), which MDX never evaluates |
| `## Heading {#id}` | kept as is (Mintlify supports custom heading ids) |
| `layout: home` hero + features | cards in `<Columns>` |
| `[x](./flows.md#ask)`, `/es/guide/flujos#…` | absolute Mintlify paths; anchors translated from VitePress slugs to Mintlify slugs |
| `/api/interfaces/_botmesh_core.IStore.html` | `/api/core/interfaces/IStore` |
| `{`, `}`, `<`, `<!-- -->`, `<https://…>` in prose | escaped / `{/* */}` / `[url](url)` so every page compiles as MDX |
| sidebars in `docs/.vitepress/config.ts` | `docs.json` `navigation.languages[en, es]` → tabs Guide / Examples / API reference, same groups and order (a nested sidebar group such as "Experimental" becomes a nested Mintlify group; `/api/` items are left to the API tab) |
| `docs/public/llms.txt` (with `--llms-base`) | `llms.txt` with every link on the published site moved to `--llms-base`, and any old GitHub Pages link mapped to its Mintlify page (unpublished files → GitHub) |

Spanish pages are published at their **English counterpart's path** under `/es/`
(`docs/es/guide/flujos.md` → `/es/guide/flows`), paired by position in the two sidebars, the same
rule as `docs/.vitepress/theme/langs.ts`. Mintlify's language switcher only offers a translation
at the mirrored path and greys the option out otherwise, so this is what makes the EN/ES switch
work on every page. `docs.json` redirects every old Spanish URL (`/es/guide/flujos`) to the new one,
and every page removed in a reorganization (`MOVED_PAGES` in `site-map.mjs`, e.g. `guide/di` → `guide/plugins`)
to the page that now holds its content.

The API reference is TypeDoc + [typedoc-plugin-markdown](https://typedoc-plugin-markdown.org) over the
same entry points as `pnpm docs:api` (`@botmesh/core`, `/spi`, `/testing`, with the same categories),
moved to `site/api/core/…` and grouped in the sidebar by module → category.
Member headings get explicit ids (`### start()? {#start}`) so TypeDoc's `#start` links resolve.

AI features enabled in `docs.json` that need no paid plan or API key: the page context menu
(`contextual`: copy page, view as Markdown, open in ChatGPT / Claude / Perplexity, copy the MCP
server URL, install it in Cursor / VS Code). Mintlify also generates `llms-full.txt`, a `.md`
version of every page and the hosted MCP server on its own; our curated `llms.txt` replaces the
generated `llms.txt`. The AI assistant (`assistant`) is Pro-only and left out.

State on 2026-10-27: 705 pages (162 guide/example pages in two languages, 2 home pages,
541 API pages), `mint validate` passes and `mint broken-links --check-anchors --check-redirects`
finds 0 broken links.

## Going live (done on 2026-10-27)

1. The public repository `andresayac/botmesh-docs` holds the generated site (`pnpm docs:mintlify`).
2. The Mintlify project (Starter plan) deploys it through the **Mintlify GitHub App**, installed on
   that repository only (it never needs access to `andresayac/botmesh`).
3. Custom domain `botmesh.afaya.com.co` (dashboard → Custom domain); `MINTLIFY_SITE_URL` defaults to it,
   so `llms.txt` points at it.
4. Optional: apply to the [Mintlify OSS program](https://mintlify.typeform.com/oss-program) for a free
   Pro plan (AI assistant, preview deployments, analytics). It requires a recognised open-source
   license and a non-commercial project.

Each `pnpm docs:mintlify` redeploys. No GitHub Actions are involved.

## GitHub Pages redirects

GitHub Pages (`gh-pages` branch of this repo) no longer serves the VitePress site: it serves one tiny
redirect page per URL the VitePress build used to publish, so old deep links keep working:

```bash
pnpm docs:deploy --redirects --dry-run   # build everything, keep the temp repo, push nothing
pnpm docs:deploy --redirects             # force-push the stubs to gh-pages (maintainer, clean main)
```

[`scripts/docs-deploy.mjs`](../scripts/docs-deploy.mjs) builds the VitePress site with
`DOCS_BASE=/botmesh/` (only to list its HTML pages), runs the converter with
`--llms-base $MINTLIFY_SITE_URL`, and writes at the path of every HTML page a stub
([`scripts/docs-redirects.mjs`](../scripts/docs-redirects.mjs)) with:

- a JS `location.replace` that keeps the hash, translated through the converter's anchor table
  (`.cache/anchors.json`: VitePress slug → Mintlify slug, `''` for the page title) or lowercased on
  API pages (member ids are pinned in lowercase);
- `<meta http-equiv="refresh">` (no JS), `<link rel="canonical">`, `noindex` and a visible link.

Mapping rules (`legacyTarget()` in [`scripts/site-map.mjs`](scripts/site-map.mjs), the same rules the
converter places pages with):

| Old GitHub Pages path | Mintlify URL |
| --- | --- |
| `/`, `/guide/<x>`, `/examples/<x>`, `/examples/` | same path (`/examples` for the index) |
| `/es/`, `/es/guide/<slug-es>`, `/es/ejemplos/<slug-es>` | `/es`, `/es/guide/<slug-en>`, `/es/examples/<slug-en>` (paired by sidebar position) |
| `/api/<kind>/_botmesh_core[_spi|_testing].<Name>.html` | `/api/core[/spi|/testing]/<kind-dir>/<Name>` (`types` → `type-aliases`, `enums` → `enumerations`), or the module page if not generated |
| `/api/`, `/api/modules.html`, `/api/hierarchy.html`, `/api/modules/<module>.html` | `/api/core` or the module page |
| `/MIGRATION-v1-to-v2` (published by VitePress, not converted) | its source on GitHub |
| `404.html` and anything else | `/` (`/es` under `/es/`) |

The tree also carries the Mintlify `llms.txt` (the old `/botmesh/llms.txt` keeps answering) and
`.nojekyll`. The publish fails if a target does not exist in `site/`.

## VitePress vs Mintlify for botmesh

Pricing checked on 2026-10-26 at [mintlify.com/pricing](https://www.mintlify.com/pricing):
**Starter $0/month** (hosting, custom domain, web editor, search, MCP server, API playground, 5 editor
seats), **Pro $450/month billed annually or $540/month monthly** (adds the AI assistant, writing agent,
automations, preview deployments, analytics, 10,000 AI credits/month; an assistant answer costs 25
credits), Enterprise on request (offline export, self-hosting, white labelling, PDF export).

| | VitePress (until 2026-10-27) | Mintlify |
| --- | --- | --- |
| Hosting | GitHub Pages, `pnpm docs:deploy` by hand (now redirects only) | Mintlify cloud, GitHub App redeploys on each `pnpm docs:mintlify` push |
| Cost | $0 | $0 on Starter; AI features need Pro ($450–540/month) unless accepted in the OSS program |
| Search | Local MiniSearch index in the browser, offline, localised UI | Hosted full-text search (Starter); search UI not localised in our config |
| AI chat | None | Assistant on Pro only (credit-billed); "Copy page / open in ChatGPT / Claude" menu on Starter |
| llms.txt | Hand-curated `docs/public/llms.txt` (rich, but must be maintained) | Generated `llms.txt` + `llms-full.txt` + per-page `.md` exports, always in sync; curated file still possible |
| MCP server | None | Hosted MCP server for the docs on Starter |
| i18n | Two locales, Spanish slugs, switcher paired by sidebar position (custom plugin) | `navigation.languages`; switcher needs mirrored paths, so Spanish pages use English slugs (+ redirects) |
| API reference | TypeDoc HTML (source links, hierarchy, member search, filters) | TypeDoc → Markdown pages inside the site (same categories, searchable with the guides, consistent look); fewer TypeDoc features; English only |
| Diagrams | Mermaid via a custom lazy component | Mermaid built in, with zoom/pan controls |
| Callouts / components | VitePress containers with custom titles | Tip/Warning/Danger/Info/Accordion (no titled callouts), plus Cards, Tabs, Steps, CodeGroup available |
| Versioning | None configured (possible by hand) | `navigation.versions` built in, not used yet |
| Link checking | `pnpm docs:check` (own script) | `mint broken-links --check-anchors` (Windows bug, use Linux/Docker) + `mint validate` |
| Lock-in | None: static files, any host | Proprietary renderer and hosting; content is MDX (portable), but `docs.json`, components and hosting are Mintlify-only; static export is Enterprise-only |
| Authoring | Native Markdown in `docs/`, one toolchain | Through the converter (two copies, one generated), or migrate to native MDX authoring later |
| Build/deploy | `pnpm docs` + `pnpm docs:deploy`; Node 22/24 in CI | `pnpm docs:mintlify` (converter + checks + push); Mintlify builds the site |
| Maintenance | Custom config (locale plugin, Mermaid component, vue resolution) | Converter (~800 lines) to keep in sync with VitePress features used in `docs/` |

### What is lost or degraded in the conversion

Concretely, compared with today's site:

1. **Spanish URLs** change from Spanish slugs (`/es/guide/flujos`) to English ones (`/es/guide/flows`);
   redirects cover the old URLs.
2. **API reference in Spanish**: a page path can belong to one language only, so the Spanish
   "Referencia de la API" tab links to the English reference (and switches the sidebar to English).
3. **Callout titles**: Mintlify callouts have no title; `::: warning Title` becomes a bold first line.
4. **TypeDoc HTML features**: no clickable source links (only `Defined in: core/Bot.ts:243`),
   no hierarchy view, no visibility filters, no TypeDoc member search; 541 reference pages make a
   long sidebar. The `/api/` landing listing the three modules is replaced by the `@botmesh/core` overview.
5. **Page descriptions**: only 109 of 162 guide/example pages get a `description` (the lead paragraph
   must be short and link-free to move; otherwise it stays in the body and the page has none),
   so the generated `llms.txt` lacks a summary for the rest.
6. **Curated `llms.txt`** replaces the one Mintlify would generate (`pnpm docs:mintlify` always passes `--llms-base`); keep `docs/public/llms.txt` up to date.
7. **Footer text** ("Released under the MIT License", copyright) becomes footer link columns.
8. **Edit-this-page links**, the localised search box label and VitePress's localised UI strings
   (prev/next, "on this page") are Mintlify's own; edit links are not configured.
9. **Home page**: the VitePress hero becomes a title, a tagline and cards; no hero layout.
10. `docs/MIGRATION-v1-to-v2.md` (published by VitePress but in no sidebar) is not converted; links
    to unpublished repo files point at GitHub instead.

Gained: hosted search, Mermaid zoom/pan, generated `llms-full.txt` and per-page Markdown,
an MCP server, "Copy page / open in ChatGPT or Claude", automatic deploys, and the option of the
Pro AI assistant.


### Decision

On 2026-10-27 the maintainer chose Mintlify, hosted by Mintlify, on the free Starter plan (with an
optional OSS-program application for Pro). Authoring stays in `docs/` through the converter for now;
moving authoring to native MDX and retiring VitePress is a later decision.
