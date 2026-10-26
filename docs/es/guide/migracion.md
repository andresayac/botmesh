# Migrar desde las versiones alpha

Los paquetes siguen en la prerelease `alpha`, la última ventana para cambios
incompatibles antes de la versión estable. Esta página recoge cada ruptura
deliberada desde la primera alpha, qué cambiar en tu código y los alias
obsoletos que mantienen el comportamiento anterior mientras tanto.

## Actualización de dependencias (octubre de 2026)

Estos cambios ponen al día las dependencias de los paquetes públicos antes de
congelar la API.

### Nombres de métricas de Prometheus: prefijo `botmesh_`

`toPrometheus(bot.metrics())` (`@botmesh/core`) nombra ahora cada familia
`botmesh_*` en lugar de `botwa_*`, por ejemplo `botmesh_messages_in_total`.
Los paneles y alertas que consultan los nombres anteriores siguen funcionando si
pasas el prefijo antiguo:

```ts
toPrometheus(bot.metrics(), { prefix: 'botwa_' })
```

El puente de OpenTelemetry (`@botmesh/otel`) pasó de `botwa.*` a `botmesh.*` de
la misma forma (`otelMetricsPlugin({ prefix: 'botwa' })` conserva los nombres
anteriores), y el control plane (`@botmesh/manager`) sirve ahora
`botmesh_manager_bots_registered` y `botmesh_manager_bots_running`.

### Variables de entorno

| Nombre nuevo | Nombre anterior (se sigue leyendo) | Dónde |
|---|---|---|
| `BOTMESH_DEV=1` | `BOT_WA_DEV=1` (se sigue definiendo) | la define `botmesh dev` para el código de tu bot |
| `BOTMESH_MANAGER_LOG_LEVEL` | `BOTWA_MANAGER_LOG_LEVEL` | logger por defecto de `BotManager` |
| `BOTMESH_DOCS_DIR` | `BOTWA_DOCS_DIR` | árbol de documentación del servidor MCP |

La query de recarga en caliente de `botmesh dev` es ahora `?botmesh_v=<n>` (solo
se ve en las trazas de pila).

### `@botmesh/redis-store`: `redis` es una dependencia peer

`redis` (node-redis) pasó de `dependencies` a `peerDependencies` con el rango
`^4.7.0 || ^5.0.0 || ^6.0.0`. npm y pnpm instalan solos una dependencia peer que
falta (node-redis 6), así que `pnpm add @botmesh/redis-store` sigue funcionando;
si ya dependes de `redis`, el store usa tu versión.

- node-redis 5 y 6 quedan soportados, en un nodo y en Redis Cluster, con RESP2 o
  RESP3 (el valor por defecto de node-redis 6).
- `NativeRedisClient` y `NativeRedisClusterClient` son ahora interfaces
  estructurales pequeñas en lugar de `ReturnType<typeof createClient>`, de modo
  que el cliente de cualquier major soportada pasa el chequeo de tipos. Si los
  usabas para llamar comandos, usa el tipo de `redis`
  (`ReturnType<typeof createClient>`).

### `@botmesh/baileys`: ffmpeg ya no viene incluido

El provider ya no depende de `fluent-ffmpeg` (obsoleto) ni de
`@ffmpeg-installer/ffmpeg` (sin mantenimiento, con un ffmpeg antiguo). Las notas
de voz se transcodifican ejecutando directamente un binario de ffmpeg, que se
busca en este orden:

1. `FFMPEG_PATH`, si está definida;
2. la dependencia peer opcional `ffmpeg-static`, si está instalada y su binario
   se descargó (con pnpm, permite su script de build);
3. `ffmpeg` en el `PATH` (`apt install ffmpeg`, `brew install ffmpeg`,
   `choco install ffmpeg`).

Sin ninguno de ellos, una nota de voz se rechaza con un `UnsupportedContentError`
que explica cómo instalar ffmpeg. El texto, las imágenes y el resto no se ven
afectados. La imagen Docker de un bot que envía notas de voz necesita ffmpeg (o
`ffmpeg-static`).

Baileys sigue en `7.0.0-rc14`: todavía no existe una 7.x estable (ver el
[README del paquete](https://github.com/andresayac/botmesh/tree/main/packages/baileys-provider#requirements)).

### Providers de Meta: Graph API v26.0

`@botmesh/meta`, `@botmesh/messenger` y `@botmesh/instagram` llaman ahora por
defecto a la Graph API `v26.0` (antes `v21.0`, que Meta retira el 21-01-2027).
Los payloads de envío y de webhook que usan los providers no cambiaron entre esas
versiones. Para quedarte en una versión, fíjala:

```ts
new CloudAPIProvider({ /* ... */ apiVersion: 'v21.0' })
```

El estado `played` de WhatsApp (se escuchó una nota de voz) llega ahora como
`status: 'read'` con `platformData.played: true`; antes se descartaba.

### `@botmesh/ai`: SDK y modelos por defecto

| Cambio | Antes | Ahora |
|---|---|---|
| SDK de Gemini | `@google/generative-ai` (obsoleto) | `@google/genai` `^2`; el SDK anterior se sigue usando, con un `DeprecationWarning`, si el nuevo no está instalado |
| Modelo por defecto de Anthropic | `claude-opus-4-8` | `claude-opus-5-5` |
| Modelo por defecto de Gemini | `gemini-2.0-flash` (apagado por Google) | `gemini-3.8-flash` |
| Modelo del preset `grok` | `grok-2-latest` | `grok-4.7` |
| Modelo del preset `glm` | `glm-4-plus` | `glm-5.3` |

Para mover un bot de Gemini: `pnpm remove @google/generative-ai && pnpm add @google/genai`.
Nada más cambia en `aiPlugin`; `baseUrl` pasa a ser el `httpOptions.baseUrl` del
SDK. Para Vertex AI, crea el cliente tú mismo con `fromGoogleGenAI` (ver
[Gemini](/es/guide/ai#gemini)).

Los modelos por defecto no entran en semver: fija `model` si la elección te
importa. Claude Opus 5.5 siempre piensa (`thinking: 'off'` no reduce nada en él;
usa `effort: 'low'`) y su esfuerzo por defecto es `medium`.

### `@botmesh/hub`: campo `botmesh` del manifiesto

Un manifiesto de plugin declara su rango de runtime en `botmesh`
(`"botmesh": "^2.0.0"`). Los manifiestos con el campo antiguo `botwa` se siguen
aceptando, y la validación los devuelve con `botmesh`.

### `eslint-plugin-botmesh`: nombres de los tipos

Los tipos exportados son `BotMeshConfigs` y `BotMeshPlugin`. Los antiguos
`BotWaConfigs` y `BotWaPlugin` se mantienen como alias obsoletos de los mismos
tipos, así que los imports existentes siguen compilando; renómbralos cuando
te venga bien.

## Nombres que se mantienen

Algunos identificadores del nombre anterior del proyecto viven en datos ya
guardados. Renombrarlos ocultaría datos que ya existen, así que son permanentes:

| Nombre | Dónde |
|---|---|
| prefijo de claves `'botwa'` | `prefix` por defecto de `RedisStore`, `RedisCoordinator`, `RedisDurability`, `RedisScheduleStore` y `RedisLeaseProvider` |
| `$botwaMedia` | marcador de media dentro de los registros del inbox durable |
| `'botwa:durable'`, `botwa.inbound.*`, `botwa.outbox` | canal, tipos de evento y sidecar de `@botmesh/events/durability` |
| base de datos `botwa` | base por defecto de `MongoStore` y de las cadenas de conexión de Postgres/MySQL |
| `BOTWA_TEST_*` | variables de los tests de integración del propio repositorio (ningún paquete publicado las lee) |

Pasa tu propio `prefix`, `dbName` o cadena de conexión para usar otros nombres en
un despliegue nuevo.
