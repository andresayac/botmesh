# Paquetes y versiones

botmesh es un conjunto de paquetes en un monorepo: el motor, `@botmesh/core`,
más un paquete por canal, store, plugin y herramienta. Esta página es la
referencia de cuáles se publican, con qué tag de npm y qué necesita cada
paquete. Las demás páginas enlazan aquí en vez de repetirlo.

## Estado de publicación

botmesh está en **beta**. Los paquetes públicos se publican desde el modo
prerelease `beta` de [Changesets](https://github.com/changesets/changesets):

| Paquete | Versiones beta | Línea estable |
| --- | --- | --- |
| `@botmesh/core` | `2.0.0-beta.N` | `2.0.0` |
| El resto de paquetes públicos | `1.0.0-beta.N` | `1.0.0` |

Las guías documentan la beta y la API que congela para la línea estable. Si
vienes de una alpha de 2.0, lee la [guía de actualización](./migracion-estable).

## Dist-tags de npm

- **`beta`** apunta siempre a la beta más reciente de cada paquete. Cada
  publicación lo mueve sola.
- **`latest`** es lo que resuelve una instalación sin tag
  (`pnpm add @botmesh/core`). Las herramientas de publicación no lo mueven
  durante la beta: el mantenedor lo mueve **a mano** a las mismas versiones
  tras cada publicación, así que una instalación sin tag también instala la
  beta.

Justo después de una publicación, `latest` puede seguir apuntando un rato a la
beta anterior. Revisa los tags con:

```bash
pnpm view @botmesh/core dist-tags
```

## Instalación

Instala el core y los paquetes que necesites, sin tag:

```bash
pnpm add @botmesh/core @botmesh/baileys
```

o con el tag `beta`, que instala siempre la beta más reciente (úsalo cuando
`latest` va por detrás):

```bash
pnpm add @botmesh/core@beta @botmesh/baileys@beta
```

Instala todos los paquetes `@botmesh/*` desde el **mismo tag**. Los paquetes
publicados dependen entre sí con rangos caret (`^x.y.z`), así que el gestor de
paquetes conserva una sola copia de `@botmesh/core`; mezclar builds de tags
distintos puede fallar por exports que faltan o rangos de peers (ver
[Solución de problemas](./solucion-problemas#pnpm-add-botmesh-core-instala-una-build-anterior)).
Para empezar un proyecto, `npm create botmesh` estampa versiones que
encajan entre sí (ver [Inicio rápido](./inicio)).

## Requisitos

- **Node.js 22 o posterior.** Todos los paquetes declaran
  `"engines": { "node": ">=22" }`. El [inicio rápido](./inicio#requisitos)
  recomienda 22.12 o posterior.
- **Solo ESM.** Ningún paquete trae CommonJS: usa `import` (nunca `require()`),
  pon `"type": "module"` en tu `package.json` (o usa archivos `.mjs`) y, con
  TypeScript, `"module": "nodenext"`.
- Los SDKs opcionales son **peer dependencies que se cargan en diferido**: los
  SDKs de LLM de `@botmesh/ai`, `better-sqlite3`, `pg`, `mysql2`, `mongodb` y
  `redis` para los stores, `imapflow` y `nodemailer` para el email, `pdf-parse`
  para RAG y `@opentelemetry/api` para `@botmesh/otel`. Instala el que uses.

## Entradas y semver

La entrada principal de un paquete (`@botmesh/core`, `@botmesh/telegram`…) es
su API pública, cubierta por semver. Algunos paquetes añaden subrutas:

| Entrada | Qué contiene |
| --- | --- |
| `@botmesh/core/spi` | Piezas para autores de stores, durabilidad, scheduler y transportes. Cubierta por semver. |
| `@botmesh/core/testing` | `createTestBot`, `MockProvider` y los helpers de contrato ([Testing](./testing)). Cubierta por semver. |
| `@botmesh/core/dev` | El simulador de terminal como librería ([Simulador en la terminal](./simulador)). |
| `@botmesh/server/express`, `/fastify`, `/hono` | Adaptadores de framework del [servidor de webhooks](./servidor). |
| `@botmesh/events/durability` | El backend de durabilidad sobre el journal de eventos ([Procesamiento durable](./durabilidad)). |
| `@botmesh/ai/testing` | `MockAIProvider` y `validateArgs` ([Plugin de IA](./ai)). Cubierta por semver. |
| `<paquete>/internal` | Internos del motor y piezas sueltas, **sin garantía semver**: pueden cambiar en cualquier versión. Un paquete publicado nunca importa el `/internal` de otro. |

## Paquetes públicos (36)

Todos están en npm con `beta` y `latest`. El directorio es la carpeta dentro de
[`packages/`](https://github.com/andresayac/botmesh/tree/main/packages).

**Motor**

| Paquete | Directorio | Guía |
| --- | --- | --- |
| `@botmesh/core` | `core` | [Conceptos básicos](./conceptos) |

**Canales (12)**

| Paquete | Directorio | Guía |
| --- | --- | --- |
| `@botmesh/baileys` | `baileys-provider` | [Baileys (WhatsApp Web)](./baileys) |
| `@botmesh/meta` | `meta-provider` | [WhatsApp Cloud API](./whatsapp-cloud-api) |
| `@botmesh/evolution` | `evolution-provider` | [Evolution API](./evolution) |
| `@botmesh/wppconnect` | `wppconnect-provider` | [WPPConnect](./wppconnect) |
| `@botmesh/twilio` | `twilio-provider` | [Twilio](./twilio) |
| `@botmesh/gupshup` | `gupshup-provider` | [Gupshup](./gupshup) |
| `@botmesh/gohighlevel` | `gohighlevel-provider` | [HighLevel](./gohighlevel) |
| `@botmesh/messenger` | `messenger-provider` | [Messenger](./messenger) |
| `@botmesh/instagram` | `instagram-provider` | [Instagram](./instagram) |
| `@botmesh/telegram` | `telegram-provider` | [Telegram](./telegram) |
| `@botmesh/discord` | `discord-provider` | [Discord](./discord) |
| `@botmesh/email` | `email-provider` | [Email](./email) |

**Infraestructura compartida**

| Paquete | Directorio | Guía |
| --- | --- | --- |
| `@botmesh/http` | `http` | [Seguridad](./seguridad) (cliente HTTP anti-SSRF) |
| `@botmesh/graph-core` | `graph-core` | Helpers de Meta Graph compartidos por `meta`, `messenger` e `instagram` |
| `@botmesh/wa-gateway-kit` | `wa-gateway-kit` | Identidad, REST y media compartidos por `evolution` y `wppconnect` |
| `@botmesh/server` | `server` | [Servidor de webhooks](./servidor) |

**Stores (5)**

| Paquete | Directorio | Guía |
| --- | --- | --- |
| `@botmesh/sqlite-store` | `sqlite-store` | [Store persistente](./store) |
| `@botmesh/redis-store` | `redis-store` | [Store persistente](./store), [Redis Cluster](./redis-cluster) |
| `@botmesh/postgres-store` | `postgres-store` | [Store persistente](./store) |
| `@botmesh/mysql-store` | `mysql-store` | [Store persistente](./store) |
| `@botmesh/mongo-store` | `mongo-store` | [Store persistente](./store) |

**Operación y observabilidad**

| Paquete | Directorio | Guía |
| --- | --- | --- |
| `@botmesh/events` | `events` | [Operación](./operations) |
| `@botmesh/otel` | `otel` | [Trazas (OpenTelemetry)](./trazas) |

**Plugins (8)**

| Paquete | Directorio | Guía |
| --- | --- | --- |
| `@botmesh/ai` | `ai` | [Plugin de IA](./ai) |
| `@botmesh/rag` | `rag` | [Memoria y RAG](./ai-memoria-rag) |
| `@botmesh/voice` | `voice` | [Voz (STT/TTS)](./voz) |
| `@botmesh/nlu` | `nlu` | [Integraciones](./integraciones) |
| `@botmesh/dialogflow` | `dialogflow` | [Integraciones](./integraciones) |
| `@botmesh/chatwoot` | `chatwoot` | [Integraciones](./integraciones) |
| `@botmesh/tickets` | `tickets` | [Integraciones](./integraciones) |
| `@botmesh/moderation` | `moderation` | [Integraciones](./integraciones) |

**Herramientas**

| Paquete | Directorio | Guía |
| --- | --- | --- |
| `@botmesh/flow-schema` | `flow-schema` | [Esquema JSON de flujos](./flow-schema) |
| `create-botmesh` | `create-botmesh` | [Inicio rápido](./inicio) |
| `eslint-plugin-botmesh` | `eslint-plugin` | [Plugin de ESLint](./eslint) |
| `@botmesh/mcp` | `mcp` | [Servidor MCP](./mcp) |

Diez se publicaron por primera vez durante la alpha (`core`, `baileys`, `meta`,
`telegram`, `sqlite-store`, `redis-store`, `ai`, `http`, `graph-core` y
`create-botmesh`); los otros 26 salieron a npm por primera vez con la beta.

## Paquetes privados (9)

Estos paquetes están implementados y con tests, pero llevan `"private": true`
en su `package.json`: **no están en npm**, no siguen semver y su API puede
cambiar. Las páginas que los documentan llevan un aviso "Experimental" y van al
final de su sección. Úsalos desde un clon del monorepo, con dependencias
`"workspace:*"`. Un paquete publicado nunca depende de ellos.

| Paquete | Directorio | Qué es | Guía |
| --- | --- | --- | --- |
| `@botmesh/tiktok` | `tiktok-provider` | Canal de TikTok (comentarios y DMs) | [TikTok](./tiktok) |
| `@botmesh/manager` | `manager` | Muchos bots por proceso, control plane REST | [Control plane](./control-plane) |
| `@botmesh/sandbox` | `sandbox` | Simuladores locales de las plataformas y chat web | [Sandbox de plataformas](./sandbox) |
| `@botmesh/inbox` | `inbox` | Bandeja compartida: asignación, notas, no leídos | [Operación](./operations#paquetes-operativos) |
| `@botmesh/crm` | `crm` | Contactos, etiquetas, consentimiento y segmentos | [Operación](./operations#paquetes-operativos) |
| `@botmesh/hub` | `hub` | Manifiestos y permisos de plugins | [Operación](./operations#paquetes-operativos) |
| `@botmesh/campaigns` | `campaigns` | Envío de campañas con consentimiento y deduplicación | [Operación](./operations#paquetes-operativos) |
| `@botmesh/deployments` | `deployments` | Gate de publicación y log de auditoría de flujos | [Transcripciones doradas](./transcripciones#gate-de-publicacion-botmesh-deployments) |
| `@botmesh/tenant-kv` | `tenant-kv` | Documentos JSON por tenant sobre cualquier `DurableKv` | [Operación](./operations#paquetes-operativos) |

El repositorio incluye además un ejemplo ejecutable, `examples/bakery-ai`
(`@botmesh/example-bakery-ai`, privado).

## Siguientes pasos

- [Inicio rápido](./inicio): genera un proyecto o instálalo a mano.
- [Canales](./canales): elige un canal y compara lo que soporta cada uno.
- [Guía de actualización](./migracion-estable): si vienes de una alpha de 2.0.
