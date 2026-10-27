# Pasar a producción

Una lista de comprobación para llevar un bot de "funciona en mi máquina" a un
despliegue que puedas dejar corriendo. Cada punto enlaza a la página con los
detalles. Empieza por **Todo bot**; las secciones siguientes solo aplican
cuando las necesitas.

## Todo bot

### Runtime

- **Node.js 22 o superior**, y tu app es ESM (`"type": "module"` en el
  `package.json`, o archivos `.mjs`). Los paquetes no traen build de CommonJS.
- **Un gestor de procesos** reinicia el bot cuando termina: PM2, systemd,
  `restart: unless-stopped` de Docker o tu orquestador. Ver [Despliegue](./deploy).
- **Apagado ordenado**: ante `SIGTERM`/`SIGINT`, llama a
  `await bot.stop({ drain: true, timeout: '15s' })` para que las respuestas en
  vuelo se envíen y se registren antes de que el proceso termine
  ([Apagado ordenado](./deploy#apagado-ordenado)).
- **Fija las versiones** (commitea el lockfile). Mientras los paquetes estén en beta, lee las [páginas de migración](./migracion-estable) antes de
  cada actualización.

### Estado

- **Un store persistente.** El `MemoryStore` por defecto guarda todo en
  RAM. Usa `SQLiteStore` para un proceso o `RedisStore` para varios
  ([Store persistente](./store#elegir-un-store)).
- Pasa la **instancia** del store: `store: new SQLiteStore({ file })`. Un
  string como `store: 'sqlite'` se acepta por compatibilidad, pero sigue
  creando un `MemoryStore`.
- **Los flujos de varios pasos son `.persistent()`**, para que un usuario a
  mitad de un flujo lo retome tras un reinicio ([Flujos](./flujos)).
- **En Node.js 24.19 o superior, usa `better-sqlite3` 13** con
  `SQLiteStore` ([por qué](./store#sqlitestore)).
- **Volúmenes y copias de seguridad**: la carpeta de la sesión de WhatsApp
  (`sessions/`) y la de datos (`data/`) están en disco persistente y se
  respaldan juntas ([Copias de seguridad](./deploy#copias-de-seguridad)).

### Secretos

- Los tokens, claves de API y secretos de webhook salen del entorno (o de
  tu gestor de secretos), nunca del código. El framework no lee ninguna
  variable de entorno por su cuenta: tú las pasas a las opciones del provider
  ([Variables de entorno](./deploy#variables-de-entorno)).
- `sessions/`, `.env`, `*.db` y `*.qr.png` están en `.gitignore` y nunca se
  copian a una imagen de Docker.

### Webhooks (Cloud API, webhook de Telegram, Twilio…)

- Servidos por **HTTPS** y con la verificación de firma del canal
  configurada (`appSecret`, `webhookSecret`…). Nunca pongas
  `allowUnsignedWebhooks: true` en producción
  ([Seguridad](./seguridad#lista-de-comprobacion-para-produccion)).
- La firma se comprueba sobre el **body crudo**: no pongas un parser de JSON
  delante de la ruta del webhook ([Servidor de webhooks](./servidor)).

### Observabilidad

- **Logs**: pasa tu propio `logger` de pino (o deja el integrado, que
  registra desde `warn`). Los ids de chat y de remitente van hasheados en los
  logs por defecto (`logIds: 'hash'`); déjalo así fuera de la depuración local.
- **Errores**: escucha `bot.on('error', …)` y envíalos a tu sistema de
  seguimiento de errores.
- **Salud y métricas**: expón un endpoint de liveness/readiness y
  `bot.metrics()` en formato Prometheus
  ([Comprobaciones de salud](./deploy#comprobaciones-de-salud),
  [Operación](./operations#metricas-de-runtime)).

### Límites de los canales

- **WhatsApp con Baileys**: deja activado el rate limiter del provider y
  evita los envíos masivos no solicitados ([Rate limiting](./rate-limiting)).
- **Cloud API**: respuestas libres solo dentro de la ventana de 24 horas;
  fuera de ella, plantillas ([Ventana de 24 h de WhatsApp](./ventana-24h)).
- **Crecimiento del log de mensajes**: los stores persistentes guardan todos
  los mensajes salvo que pongas `maxMessagesPerChat`
  ([Store persistente](./store#sqlitestore)).

## Cuando necesitas más

| Necesitas… | Activa | Guía |
| --- | --- | --- |
| Ninguna respuesta perdida ni duplicada si el proceso cae a mitad de un mensaje | `BotConfig.durability` con un backend persistente | [Procesamiento durable](./durabilidad) |
| Recordatorios e informes que sobreviven a reinicios y corren una sola vez con varias réplicas | Tareas durables (`{ id }`) + `BotConfig.scheduler` | [Scheduler](./scheduler#tareas-durables-sobreviven-a-reinicios-una-replica-por-ejecucion) |
| Varios procesos del mismo bot (failover, despliegues sin corte, volumen de webhooks) | `BotConfig.coordination` + `RedisStore` | [Varias réplicas](./replicas) |
| Redis Cluster en lugar de un Redis único | El layout de claves `'cluster'` | [Redis Cluster](./redis-cluster) |
| Ver dónde se va el tiempo de cada mensaje | `BotConfig.telemetry` | [Trazas](./trazas) |

Todo esto es opt-in: sin la opción, el bot funciona exactamente igual que antes.

## Qué paquetes están publicados

Los paquetes de npm (36) son `@botmesh/core`; los canales `@botmesh/baileys`,
`@botmesh/meta`, `@botmesh/telegram`, `@botmesh/messenger`, `@botmesh/instagram`,
`@botmesh/discord`, `@botmesh/evolution`, `@botmesh/wppconnect`, `@botmesh/twilio`,
`@botmesh/gupshup`, `@botmesh/gohighlevel` y `@botmesh/email`; los stores
`@botmesh/sqlite-store`, `@botmesh/redis-store`, `@botmesh/postgres-store`,
`@botmesh/mysql-store` y `@botmesh/mongo-store`; la infraestructura `@botmesh/http`,
`@botmesh/graph-core`, `@botmesh/wa-gateway-kit`, `@botmesh/server`, `@botmesh/events`
y `@botmesh/otel`; los plugins `@botmesh/ai`, `@botmesh/rag`, `@botmesh/voice`,
`@botmesh/nlu`, `@botmesh/dialogflow`, `@botmesh/chatwoot`, `@botmesh/tickets` y
`@botmesh/moderation`; y el tooling `@botmesh/flow-schema`, `@botmesh/mcp`,
`eslint-plugin-botmesh` y `create-botmesh`. Los 36 están en npm. Diez se publicaron por primera vez durante la alpha
(`core`, `baileys`, `meta`, `telegram`, `sqlite-store`, `redis-store`, `ai`,
`http`, `graph-core` y `create-botmesh`); los otros 26 se publicaron por primera vez con la beta.
Algunas páginas describen además paquetes que de momento solo están en el
[repositorio](https://github.com/andresayac/botmesh/tree/main/packages) (el
canal de TikTok, `@botmesh/manager`, el sandbox…), y cada una lo indica. Planifica un
despliegue de producción sobre los publicados.

## Antes de cada versión de tu bot

- Los tests pasan con `createTestBot` / `MockProvider` ([Testing](./testing)).
- Los archivos o bases de datos del store tienen copia **antes** de
  actualizar `@botmesh/sqlite-store`: una versión anterior no puede abrir un
  esquema más nuevo ([Versiones del esquema](./store#versiones-del-esquema-y-actualizaciones)).
- Con réplicas, todas corren una versión que entiende las opciones que
  activas (por ejemplo `coordination.handover.flows: 'forward'`).
