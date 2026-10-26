import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { defineConfig, type DefaultTheme } from 'vitepress'

/**
 * pnpm's strict node_modules does not expose `vue` at the workspace root (it is
 * only a dependency of vitepress), yet the SSR bundle compiled from docs/*.md
 * imports `vue` and `vue/server-renderer`. Resolve bare `vue` imports through
 * vitepress so the build does not depend on hoisting. Harmless once the root
 * package.json lists `vue` itself.
 */
const vitepressEntry = createRequire(import.meta.url).resolve('vitepress')

/**
 * The language switcher of the default theme imports `../composables/langs`;
 * this file swaps in ./theme/langs.ts, which reads `themeConfig.localeAlternates`.
 */
const localeLinksModule = fileURLToPath(new URL('./theme/langs.ts', import.meta.url))

/**
 * Public base path of the site. `/` for `pnpm docs:dev` and local builds;
 * `pnpm docs:deploy` builds with `DOCS_BASE=/botmesh/` for GitHub Pages
 * (https://andresayac.github.io/botmesh/). Must start and end with `/`.
 */
const base = process.env.DOCS_BASE || '/'
if (!/^\/(?:[^/\s]+\/)*$/.test(base)) {
  throw new Error(`DOCS_BASE must start and end with "/" (e.g. "/botmesh/"), got ${JSON.stringify(base)}`)
}

/**
 * Public URL of the published site, for the sitemap and the canonical links.
 * Absolute http(s) URL ending with `/`; it already includes the base path.
 */
const siteUrl = process.env.DOCS_SITE_URL || 'https://andresayac.github.io/botmesh/'
if (!/^https?:\/\/[^/\s]+\/(?:[^\s]*\/)?$/.test(siteUrl)) {
  throw new Error(`DOCS_SITE_URL must be an absolute http(s) URL ending with "/", got ${JSON.stringify(siteUrl)}`)
}

const enSidebar = {
  '/guide/': [
    {
      text: 'Getting started',
      items: [
        { text: 'Quick start', link: '/guide/getting-started' },
        { text: 'Your first bot', link: '/guide/first-bot' },
        { text: 'Core concepts', link: '/guide/concepts' },
        { text: 'Configuration reference', link: '/guide/configuration' },
        { text: 'Channels', link: '/guide/channels' },
      ],
    },
    {
      text: 'Features',
      items: [
        { text: 'Messages & media', link: '/guide/messages' },
        { text: 'Conversation flows', link: '/guide/flows' },
        { text: 'Special triggers', link: '/guide/triggers' },
        { text: 'Forms (WhatsApp Flows)', link: '/guide/forms' },
        { text: 'Persistent user data', link: '/guide/user-data' },
        { text: 'Internationalization (i18n)', link: '/guide/i18n' },
        { text: 'Handoff & access lists', link: '/guide/handoff' },
        { text: 'Hooks (middleware)', link: '/guide/hooks' },
        { text: 'Plugins', link: '/guide/plugins' },
        { text: 'AI plugin', link: '/guide/ai' },
        { text: 'AI tool calling', link: '/guide/ai-tools' },
        { text: 'AI memory & RAG', link: '/guide/ai-memory-rag' },
        { text: 'Streaming replies', link: '/guide/streaming' },
        { text: 'Voice (STT/TTS)', link: '/guide/voice' },
        { text: 'Integrations', link: '/guide/integrations' },
        { text: 'Dependency injection', link: '/guide/di' },
        { text: 'Scheduler', link: '/guide/scheduler' },
        { text: 'Rate limiting (anti-ban)', link: '/guide/rate-limiting' },
        { text: 'Persistent store', link: '/guide/store' },
        { text: 'Control plane', link: '/guide/control-plane' },
        { text: 'Webhook server', link: '/guide/server' },
        { text: 'WhatsApp 24h window', link: '/guide/session-window' },
        { text: 'Operations', link: '/guide/operations' },
        { text: 'Tracing (OpenTelemetry)', link: '/guide/tracing' },
        { text: 'Durable processing', link: '/guide/durability' },
      ],
    },
    {
      text: 'Develop & test',
      items: [
        { text: 'Terminal simulator', link: '/guide/dev-simulator' },
        { text: 'Platform sandbox', link: '/guide/sandbox' },
        { text: 'Testing', link: '/guide/testing' },
        { text: 'Inspect & lint flows', link: '/guide/flow-tools' },
        { text: 'JSON flow schema', link: '/guide/flow-schema' },
        { text: 'MCP server', link: '/guide/mcp' },
        { text: 'Golden transcripts', link: '/guide/golden-transcripts' },
        { text: 'ESLint plugin', link: '/guide/eslint' },
      ],
    },
    {
      text: 'Advanced',
      items: [
        { text: 'Sub-APIs', link: '/guide/sub-apis' },
        { text: 'Going to production', link: '/guide/production' },
        { text: 'Deployment', link: '/guide/deploy' },
        { text: 'Running N replicas', link: '/guide/replicas' },
        { text: 'Architecture', link: '/guide/architecture' },
        { text: 'Redis Cluster', link: '/guide/redis-cluster' },
        { text: 'Security', link: '/guide/security' },
        { text: 'Threat model', link: '/guide/threat-model' },
        { text: 'Upgrade to stable: checklist & API', link: '/guide/stable-migration' },
        { text: 'Upgrade to stable: dependencies', link: '/guide/migration' },
        { text: 'Upgrade to stable: behaviour', link: '/guide/migration-2' },
        { text: 'Upgrade notes: channels & plugins', link: '/guide/upgrade-channels-plugins' },
        { text: 'Troubleshooting', link: '/guide/troubleshooting' },
        { text: 'FAQ', link: '/guide/faq' },
      ],
    },
  ],
  '/examples/': [
    {
      text: 'Examples',
      items: [{ text: 'All examples', link: '/examples/' }],
    },
    {
      text: 'Intermediate',
      items: [
        { text: 'Appointment booking', link: '/examples/appointment-booking' },
        { text: 'Order tracking', link: '/examples/order-tracking' },
        { text: 'Human handoff', link: '/examples/human-handoff' },
        { text: 'Multi-language bot', link: '/examples/multi-language' },
        { text: 'Group bot', link: '/examples/group-bot' },
        { text: 'WhatsApp and Telegram at once', link: '/examples/whatsapp-and-telegram' },
      ],
    },
    {
      text: 'Recipes',
      items: [
        { text: 'Send messages', link: '/examples/messages' },
        { text: 'Send media', link: '/examples/media' },
        { text: 'Registration flow', link: '/examples/registration-flow' },
        { text: 'Shopping flow', link: '/examples/shopping-flow' },
        { text: 'Support with timeout', link: '/examples/support-flow' },
        { text: 'Plugin: rate limiter', link: '/examples/rate-limiter' },
      ],
    },
  ],
} satisfies DefaultTheme.SidebarMulti

const esSidebar = {
  '/es/guide/': [
    {
      text: 'Primeros pasos',
      items: [
        { text: 'Inicio rápido', link: '/es/guide/inicio' },
        { text: 'Tu primer bot', link: '/es/guide/primer-bot' },
        { text: 'Conceptos básicos', link: '/es/guide/conceptos' },
        { text: 'Referencia de configuración', link: '/es/guide/configuracion' },
        { text: 'Canales', link: '/es/guide/canales' },
      ],
    },
    {
      text: 'Características',
      items: [
        { text: 'Mensajes y media', link: '/es/guide/mensajes' },
        { text: 'Flujos conversacionales', link: '/es/guide/flujos' },
        { text: 'Triggers especiales', link: '/es/guide/triggers' },
        { text: 'Formularios (WhatsApp Flows)', link: '/es/guide/formularios' },
        { text: 'Datos por usuario', link: '/es/guide/datos-usuario' },
        { text: 'Internacionalización (i18n)', link: '/es/guide/i18n' },
        { text: 'Handoff y listas de acceso', link: '/es/guide/handoff' },
        { text: 'Hooks (middleware)', link: '/es/guide/hooks' },
        { text: 'Plugins', link: '/es/guide/plugins' },
        { text: 'Plugin de IA', link: '/es/guide/ai' },
        { text: 'Herramientas de IA', link: '/es/guide/ai-herramientas' },
        { text: 'Memoria y RAG', link: '/es/guide/ai-memoria-rag' },
        { text: 'Respuestas en streaming', link: '/es/guide/streaming' },
        { text: 'Voz (STT/TTS)', link: '/es/guide/voz' },
        { text: 'Integraciones', link: '/es/guide/integraciones' },
        { text: 'Inyección de dependencias', link: '/es/guide/di' },
        { text: 'Scheduler', link: '/es/guide/scheduler' },
        { text: 'Rate limiting (anti-ban)', link: '/es/guide/rate-limiting' },
        { text: 'Store persistente', link: '/es/guide/store' },
        { text: 'Control plane', link: '/es/guide/control-plane' },
        { text: 'Servidor de webhooks', link: '/es/guide/servidor' },
        { text: 'Ventana de 24 h de WhatsApp', link: '/es/guide/ventana-24h' },
        { text: 'Operación', link: '/es/guide/operations' },
        { text: 'Trazas (OpenTelemetry)', link: '/es/guide/trazas' },
        { text: 'Procesamiento durable', link: '/es/guide/durabilidad' },
      ],
    },
    {
      text: 'Desarrollo y tests',
      items: [
        { text: 'Simulador en la terminal', link: '/es/guide/simulador' },
        { text: 'Sandbox de plataformas', link: '/es/guide/sandbox' },
        { text: 'Testing', link: '/es/guide/testing' },
        { text: 'Inspeccionar y validar flujos', link: '/es/guide/inspeccion-flujos' },
        { text: 'Esquema JSON de flujos', link: '/es/guide/flow-schema' },
        { text: 'Servidor MCP', link: '/es/guide/mcp' },
        { text: 'Transcripciones doradas', link: '/es/guide/transcripciones' },
        { text: 'Plugin de ESLint', link: '/es/guide/eslint' },
      ],
    },
    {
      text: 'Avanzado',
      items: [
        { text: 'Sub-APIs', link: '/es/guide/sub-apis' },
        { text: 'Pasar a producción', link: '/es/guide/produccion' },
        { text: 'Despliegue', link: '/es/guide/deploy' },
        { text: 'Varias réplicas', link: '/es/guide/replicas' },
        { text: 'Arquitectura', link: '/es/guide/arquitectura' },
        { text: 'Redis Cluster', link: '/es/guide/redis-cluster' },
        { text: 'Seguridad', link: '/es/guide/seguridad' },
        { text: 'Modelo de amenazas', link: '/es/guide/modelo-amenazas' },
        { text: 'Actualizar a estable: checklist y API', link: '/es/guide/migracion-estable' },
        { text: 'Actualizar a estable: dependencias', link: '/es/guide/migracion' },
        { text: 'Actualizar a estable: comportamiento', link: '/es/guide/migracion-2' },
        { text: 'Notas de actualización: canales y plugins', link: '/es/guide/actualizar-canales-plugins' },
        { text: 'Solución de problemas', link: '/es/guide/solucion-problemas' },
        { text: 'Preguntas frecuentes', link: '/es/guide/faq' },
      ],
    },
  ],
  '/es/ejemplos/': [
    {
      text: 'Ejemplos',
      items: [{ text: 'Todos los ejemplos', link: '/es/ejemplos/' }],
    },
    {
      text: 'Intermedios',
      items: [
        { text: 'Reserva de citas', link: '/es/ejemplos/reserva-citas' },
        { text: 'Seguimiento de pedidos', link: '/es/ejemplos/seguimiento-pedidos' },
        { text: 'Handoff humano', link: '/es/ejemplos/handoff-humano' },
        { text: 'Bot multi-idioma', link: '/es/ejemplos/multi-idioma' },
        { text: 'Bot de grupo', link: '/es/ejemplos/bot-de-grupo' },
        { text: 'WhatsApp y Telegram a la vez', link: '/es/ejemplos/whatsapp-y-telegram' },
      ],
    },
    {
      text: 'Recetas',
      items: [
        { text: 'Enviar mensajes', link: '/es/ejemplos/mensajes' },
        { text: 'Enviar media', link: '/es/ejemplos/media' },
        { text: 'Flujo de registro', link: '/es/ejemplos/flujo-registro' },
        { text: 'Flujo de compra', link: '/es/ejemplos/flujo-compra' },
        { text: 'Soporte con timeout', link: '/es/ejemplos/flujo-soporte' },
        { text: 'Plugin: rate limiter', link: '/es/ejemplos/rate-limiter' },
      ],
    },
  ],
} satisfies DefaultTheme.SidebarMulti

/** Every page of the site as a VitePress `relativePath` (`guide/flows.md`). */
function listPages(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      if (prefix === '' && ['api', 'dist', 'public', 'node_modules'].includes(entry.name)) return []
      if (entry.name.startsWith('.')) return []
      return listPages(`${dir}/${entry.name}`, `${prefix}${entry.name}/`)
    }
    return entry.name.endsWith('.md') ? [`${prefix}${entry.name}`] : []
  })
}

function sidebarPages(sidebar: DefaultTheme.SidebarMulti): string[] {
  const walk = (items: DefaultTheme.SidebarItem[]): string[] =>
    items.flatMap((item) => [...(item.link ? [`${item.link.slice(1)}.md`] : []), ...walk(item.items ?? [])])
  return Object.values(sidebar).flatMap((group) => walk(Array.isArray(group) ? group : group.items))
}

/**
 * The Spanish pages use Spanish slugs, so the default language switcher
 * (which keeps the path and swaps the locale prefix) would link
 * `/guide/flows` to a missing `/es/guide/flows`. Both sidebars list the
 * same pages in the same order, which pairs each page with its translation.
 * Pages without one switch to the other locale's home page. Only pages whose
 * naive counterpart is wrong get an entry.
 */
function localeAlternates(): Record<string, Record<string, string>> {
  const en = sidebarPages(enSidebar)
  const es = sidebarPages(esSidebar)
  if (en.length !== es.length) {
    throw new Error(`docs sidebars are out of sync: ${en.length} English vs ${es.length} Spanish pages`)
  }
  const pairs = new Map<string, string>()
  en.forEach((page, i) => {
    pairs.set(page, es[i]!)
    pairs.set(es[i]!, page)
  })
  const pages = new Set(listPages(fileURLToPath(new URL('..', import.meta.url))))
  const toLink = (page: string) => `/${page.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '')}`
  const out: Record<string, Record<string, string>> = {}
  for (const page of pages) {
    const isEs = page.startsWith('es/')
    const target = isEs ? 'root' : 'es'
    const naive = isEs ? page.slice('es/'.length) : `es/${page}`
    const counterpart = pairs.get(page) ?? (pages.has(naive) ? naive : undefined)
    if (counterpart === naive) continue
    out[page] = { [target]: counterpart ? toLink(counterpart) : isEs ? '/' : '/es/' }
  }
  return out
}

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: 'botmesh',
  description: 'A modern, transport-agnostic bot framework — WhatsApp (Baileys 7 / Cloud API), Telegram and Discord behind one IProvider',

  // Output to docs/dist/. `pnpm docs:deploy` publishes it by hand to the
  // gh-pages branch (GitHub Pages, "Deploy from a branch"; no GitHub Actions).
  srcDir: '.',
  outDir: 'dist',
  cleanUrls: true,

  // Exclude TypeDoc API reference from VitePress build (it's standalone HTML)
  // TypeDoc generates docs/api/ — VitePress should not process it
  // Internal design notes and maintainer reports stay in the repo but are not published.
  srcExclude: ['api/**', 'dist/**', 'superpowers/**', 'api-review.md', 'release-readiness.md'],

  // /api/ is generated by TypeDoc (standalone HTML), not by VitePress.
  // Ignore dead links pointing to it.
  ignoreDeadLinks: [/\/api\//],

  base,

  // `head` links are not rewritten by VitePress: prefix the base so the icon also
  // resolves when the site is built under a sub-path (DOCS_BASE=/botmesh/).
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}favicon.svg` }]],

  sitemap: { hostname: siteUrl },

  // Canonical URL of every page on the published site.
  transformPageData(pageData) {
    const path = pageData.relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '')
    const url = new URL(path, siteUrl).href
    pageData.frontmatter.head ??= []
    pageData.frontmatter.head.push(
      ['link', { rel: 'canonical', href: url }],
      ['meta', { property: 'og:url', content: url }],
    )
  },

  vite: {
    // mermaid is only imported on the client, on demand; pre-bundle it for `docs:dev`.
    optimizeDeps: { include: ['mermaid'] },
    build: {
      // The largest chunks are mermaid's (~700 kB), loaded lazily on pages with
      // a diagram; they never block the first paint. Kilobytes.
      chunkSizeWarningLimit: 1024,
    },
    plugins: [
      {
        name: 'botmesh:locale-links',
        enforce: 'pre',
        resolveId(source, importer) {
          if (!importer || !/[\\/]vitepress[\\/]dist[\\/]client[\\/]theme-default[\\/]/.test(importer)) return null
          return /(^|\/)composables\/langs(\.js)?$/.test(source) ? localeLinksModule : null
        },
      },
      {
        name: 'botmesh:resolve-vue-through-vitepress',
        enforce: 'pre',
        resolveId(source, importer, options) {
          if (!/^vue(\/|$)/.test(source) || importer === vitepressEntry) return null
          return this.resolve(source, vitepressEntry, { ...options, skipSelf: true })
        },
      },
    ],
  },

  markdown: {
    config(md) {
      // ```mermaid fences become <Mermaid>, rendered on the client by
      // ./theme/Mermaid.vue. The source is URI-encoded so that Vue does not
      // treat it as template syntax.
      const fence = md.renderer.rules.fence!
      md.renderer.rules.fence = (tokens, idx, options, env, self) => {
        const token = tokens[idx]
        if (token.info.trim().split(/\s+/)[0] === 'mermaid') {
          return `<Mermaid code="${encodeURIComponent(token.content)}" />\n`
        }
        return fence(tokens, idx, options, env, self)
      }

      // Links into the TypeDoc reference (/api/...) leave the VitePress app. Give
      // them target="_self" so the SPA router does a full load instead of
      // rendering its 404 page. VitePress skips links that already carry a
      // target, so the base prefix is added here.
      const next = md.renderer.rules.link_open
      md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
        const token = tokens[idx]
        const href = token.attrGet('href')
        if (href?.startsWith('/api/') && token.attrIndex('target') < 0) {
          token.attrSet('href', `${base}${href.slice(1)}`)
          token.attrSet('target', '_self')
        }
        return next ? next(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options)
      }
    },
  },

  locales: {
    // English is the root locale (no /en/ prefix)
    root: {
      label: 'English',
      lang: 'en',
      themeConfig: {
        nav: [
          { text: 'Guide', link: '/guide/getting-started' },
          { text: 'Examples', link: '/examples/' },
          // TypeDoc output is plain HTML, not a VitePress page: bypass the SPA router.
          { text: 'API', link: '/api/', target: '_self' },
        ],
        sidebar: enSidebar,
        editLink: {
          pattern: 'https://github.com/andresayac/botmesh/edit/main/docs/:path',
          text: 'Edit this page on GitHub',
        },
        search: {
          provider: 'local',
        },
      },
    },
    // Spanish is the secondary locale (under /es/)
    es: {
      label: 'Español',
      lang: 'es',
      themeConfig: {
        nav: [
          { text: 'Guía', link: '/es/guide/inicio' },
          { text: 'Ejemplos', link: '/es/ejemplos/' },
          { text: 'API', link: '/api/', target: '_self' },
        ],
        sidebar: esSidebar,
        docFooter: {
          prev: 'Anterior',
          next: 'Siguiente',
        },
        outline: {
          label: 'En esta página',
        },
        lastUpdated: {
          text: 'Última actualización',
        },
        editLink: {
          // :path is relative to srcDir and already starts with es/
          pattern: 'https://github.com/andresayac/botmesh/edit/main/docs/:path',
          text: 'Editar esta página en GitHub',
        },
        search: {
          provider: 'local',
          options: {
            translations: {
              button: {
                buttonText: 'Buscar',
                buttonAriaLabel: 'Buscar',
              },
              modal: {
                noResultsText: 'Sin resultados',
                resetButtonTitle: 'Limpiar',
                footer: {
                  selectText: 'Seleccionar',
                  navigateText: 'Navegar',
                },
              },
            },
          },
        },
      },
    },
  },

  themeConfig: {
    // Read by ./theme/langs.ts (the language switcher).
    localeAlternates: localeAlternates(),
    socialLinks: [
      { icon: 'github', link: 'https://github.com/andresayac/botmesh' },
    ],
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024-present Andres Aya',
    },
  },
})
