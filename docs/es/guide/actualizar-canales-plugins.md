# Notas de actualización: canales y plugins

Estos son los cambios desde la primera alpha (`@botmesh/core@2.0.0-alpha.2` y el resto en
`0.2.0-alpha.0`) que pueden cambiar cómo se comporta un bot existente, en los paquetes de
canales, stores y plugins. Cada uno dice qué cambió y qué hacer. La mayoría de los bots no
necesitan ningún cambio.

## Paquetes públicos

### `@botmesh/baileys`

**`toJid()` lanza con una entrada que no puede convertir en JID.** Devolvía
`'@s.whatsapp.net'` para una entrada sin dígitos, y un texto inválido `…@g.us:<usuario>`
para `{ groupId, userId }`. Las dos lanzan ahora un `TypeError`.

```ts
toJid({ groupId: '120363000000000000', userId: '573001112233' }) // antes: texto inválido; ahora: TypeError
toJid({ groupId: '120363000000000000' })                         // '120363000000000000@g.us'
toJid('573001112233')                                           // '573001112233@s.whatsapp.net'
```

Un participante de un grupo no tiene JID propio: usa el JID del grupo para el chat y
`toJid(userId)` para la persona.

**Las ediciones de texto llegan al bot.** Un mensaje editado se descartaba. Ahora llega como
mensaje con el texto nuevo y el `ref.id` **original**, como en Telegram.
`isEditedMessage(ctx)` lo distingue. El dedupe del core deja pasar la edición y sigue
descartando un reintento idéntico. Solo se entrega la edición de un mensaje que el proceso
ha visto, enviado en el mismo chat por quien manda la edición: la que nombra el mensaje de
otra persona, uno del propio bot o uno de otro chat se descarta, igual que la de un original
que ya no está en la caché de mensajes del provider (p. ej. tras un reinicio). Para volver al
comportamiento anterior:

```ts
new BaileysProvider({ session: 'mi-bot', editedMessages: 'ignore' })
```

### `@botmesh/ai`

**`provider: 'openai'` con `baseUrl` envía `max_tokens`.** Con cualquier `baseUrl` que no
sea `api.openai.com` ni Azure OpenAI (`*.openai.azure.com`, `*.cognitiveservices.azure.com` o
un endpoint de Azure AI Foundry `*.services.ai.azure.com` bajo `/openai`), el tope de tokens de salida va ahora en
`max_tokens`, que es lo que esperan los servidores compatibles con OpenAI (vLLM, LM Studio,
gateways). Si tu `baseUrl` es un proxy delante de OpenAI y usas un modelo o-series o gpt-5,
vuelve a fijar el campo:

```ts
aiPlugin({ provider: 'openai', baseUrl: 'https://mi-proxy.example/v1', maxTokensField: 'max_completion_tokens' })
```

**Las opciones de memoria fallan pronto.** Un `memory.maxFactLength`, `memory.maxFacts` o
`memory.ttl` inválido lanza ahora un `RangeError` desde `aiPlugin()` en vez de fallar en
`plug()` (o, con `maxFactLength`, descartar en silencio todos los hechos).

**`onStreamEnd` tiene un contrato fijo.** `GenerateInput.onStreamEnd(info)` (un
`AIStreamEndInfo`: `stopReason`, más `usage` en Anthropic y Gemini) se llama exactamente una vez
por llamada a `stream()`, tras el último fragmento y antes de que termine la iteración, y solo
si el stream termina con normalidad: nunca si falla, se aborta o el consumidor sale antes con
`break`. Una excepción lanzada por el callback hace fallar la iteración del consumidor. Todos
los proveedores integrados y `MockAIProvider` lo cumplen, también la regla del aborto cuando el
cliente ignora `signal` (un stream abortado no llama al callback y rechaza con el motivo del
aborto); un `AIProvider` propio que llame a `onStreamEnd` también debería (comprueba
`signal.aborted` antes de llamarlo).

**Entradas y datos congelados.** `MockAIProvider` pasa a `@botmesh/ai/testing`, los helpers del
plugin y los nombres de los tipos de los SDK a `@botmesh/ai/internal`, y los vocabularios,
presets y textos exportados quedan congelados. Ver
[Migrar a la API estable](./migracion-estable#entradas-de-botmesh-ai).

### `@botmesh/meta`

- **Los límites interactivos se comprueban antes de enviar.** Un `buttons` o `card` sin
  botones, ids o títulos de botón repetidos (comparados tras el corte a 20 caracteres), una
  lista sin filas, con más de 10 filas o con ids de fila repetidos rechazan ahora con
  `UnsupportedContentError`. Graph también los rechazaba, pero con un error opaco tras la
  petición.
- **Una respuesta interactiva que no es una pulsación** (por ejemplo
  `call_permission_reply`) llega como mensaje `unknown` con el payload en `ctx.ref.native`,
  no como interacción `button` con datos vacíos. Un handler que dependía de eso debe leer el
  mensaje.
- Las subidas de media tienen su propio timeout, `uploadTimeoutMs` (5 minutos por defecto).
- **Nueva opción `lang`** para las etiquetas que `publishForm()` fija en un Flow (por
  defecto `'en'`): ponle el `BotConfig.lang` de tu bot. `publishForm(def, { lang })` la
  sobrescribe.
- **Deprecados (se quitan en v3):** `toProviderError` (usa `toGraphError` de
  `@botmesh/graph-core`), `GraphClient` (internos del transporte), los
  `verifyChallenge`/`verifySignature` reexportados (usa `provider.verifyChallenge(query)` y
  `provider.ingest()`, o impórtalos de `@botmesh/graph-core`) y `debug` (pasa un `logger`).
  `phoneNumberId` admite `string | number` en el tipo.

### `@botmesh/telegram`

- En modo webhook, `ingest()` tras `stop()` responde `503` y no emite nada (Telegram reenvía
  el Update tras el reinicio). Los hosts que vuelven a arrancar el provider no tienen que
  cambiar nada.
- Las subidas de archivos tienen su propio timeout, `uploadTimeoutMs` (5 minutos por
  defecto).
- **Las encuestas se envían no anónimas y sus votos llegan al bot.** Cada `poll_answer` se
  convierte en un evento `'poll'` con la misma forma que en WhatsApp (`vote.ref`,
  `vote.senderId`, `vote.options` con `voters`). Los miembros del chat ven quién votó. Los canales no
  admiten votantes públicos: una encuesta a un canal se reintenta una vez como anónima (sin
  votos) y el canal se recuerda. Para
  mantener encuestas anónimas (sin recibir votos):

```ts
new TelegramProvider({ token, anonymousPolls: true })
```

- **`pollTimeoutMs`** sustituye a `pollTimeout` (segundos, deprecado): `pollTimeout: 30`
  equivale a `pollTimeoutMs: 30_000`. `toProviderError` pasa a ser `toTelegramError` (el
  nombre antiguo es un alias deprecado), `debug` queda deprecado (pasa un `logger`) y los
  helpers de cable `parseUpdate`, `parsePollAnswer`, `toOutbound` y `MEDIA_UPLOAD` son
  `@experimental`.

### `@botmesh/sqlite-store`

`saveMessage` y `setCursor` lanzan `TypeError` con un id de mensaje, id de chat, clave o
valor de cursor que lleve un surrogate UTF-16 suelto (antes SQLite lo guardaba como U+FFFD y
dos ids podían compartir fila). Escapa o quita esos caracteres antes de guardarlos.

**Versionado del esquema.** La base de datos guarda su layout en `PRAGMA user_version`
(`SQLITE_SCHEMA_VERSION`, ahora `2`). Abrir un archivo escrito por una versión anterior
(versión `0` o `1`) lo migra en el sitio y conserva todas las filas; no hay que hacer nada.
La versión `2` incorpora a las migraciones versionadas las tablas del scheduler durable
(`schedules`, `schedule_fences`) y la de durabilidad (`durable`): antes se creaban sobre la
marcha la primera vez que se llamaba a `schedules()` o `durability()`, y ahora se crean al
abrir el archivo. Un
archivo escrito por una versión **más nueva** se rechaza con `SQLiteSchemaVersionError`
(`code: 'SQLITE_SCHEMA_TOO_NEW'`) y no se toca: no se admite volver atrás, así que haz una
copia del archivo antes de actualizar si puedes necesitar revertir.

**Volver a la alpha anterior.** La alpha anterior escribe y lee la versión de esquema `1`.
En cuanto esta versión abre un archivo, este pasa a la versión `2` y la alpha anterior lo
rechaza con `SQLITE_SCHEMA_TOO_NEW` en su siguiente arranque, aunque la app nunca llame a
`schedules()` ni a `durability()`. Pasa lo mismo en un despliegue escalonado: un proceso que
sigue en la alpha anterior y comparte el archivo falla al reiniciarse, así que para todos
los procesos de la versión vieja antes de que el primero de la nueva abra el archivo. Para
volver atrás, restaura la copia hecha antes de actualizar. La migración no cambia ninguna
fila (solo añade tablas con `CREATE TABLE IF NOT EXISTS`), así que, si no tienes copia,
puedes fijar a mano `PRAGMA user_version = 1` con la CLI `sqlite3` mientras ningún proceso
tenga el archivo abierto, y la alpha anterior vuelve a abrirlo. El salto de versión existe
para que las migraciones futuras puedan dar por hecho que esas tablas existen; sin él
seguirían fuera de la versión.

Opciones nuevas:
`busyTimeoutMs` (por defecto 5000, `PRAGMA busy_timeout`) y un `logger` que acepta
cualquier `LoggerLike`. Las cadenas DDL exportadas `SCHEDULES_SCHEMA` y `DURABLE_SCHEMA`
quedan deprecadas.

### `@botmesh/messenger` y `@botmesh/instagram`

Los dos canales son públicos desde la beta (`1.0.0-beta`), así que su primera versión en npm
ya trae la entrada congelada. Dentro del monorepo o de un fork, importar un nombre quitado
deja de compilar:

| Quitado de la entrada principal | Usa en su lugar |
| --- | --- |
| `toProviderError` | `toMessengerError` / `toInstagramError` |
| reexportaciones de `verifyChallenge`, `verifySignature` | `provider.verifyChallenge(query)` / `provider.ingest()`, o `@botmesh/graph-core` |
| `parseInbound`, `toOutbound`, `toOutboundMessages` (Messenger) | `@botmesh/messenger/internal` (sin semver) |
| `GraphClient`, `parseInbound`, `toOutbound` (Instagram) | `@botmesh/instagram/internal` (sin semver) |
| `GraphSendResponse` (Instagram) | `InstagramSendResponse` (misma forma) |

La opción `debug` queda deprecada en los dos: pasa un `logger`. Más de 3 botones (o 10
filas de lista) en Messenger, o más de 13 quick replies en Instagram, rechazan con
`UnsupportedContentError` en vez de cortarse.

### `@botmesh/evolution`, `@botmesh/wppconnect` y `@botmesh/wa-gateway-kit`

Nuevos en npm en la beta (antes eran privados). Si los usabas desde el monorepo:

- Los parsers de webhooks, los mapeadores de salida y los tokens de media (`parseWebhook`,
  `parseMessage`, `toOutbound`, `numberedMenu`, `keyFromRef`, `target`, `jidOf`…) y los
  helpers JWT de Evolution (`verifyHs256Jwt`, `signHs256Jwt`) pasaron a
  `@botmesh/evolution/internal` y `@botmesh/wppconnect/internal`, sin garantía semver.
- Los providers ya no reexportan `WaIdentityStore` ni `normalizeJid`: impórtalos de
  `@botmesh/wa-gateway-kit`. `IdentityPersistence` y `RestHttpOptions` siguen en la entrada
  principal de los providers.
- Se quitó la opción `debug`: pasa un `logger` (`pino({ level: 'debug' })`).
- Las opciones inválidas lanzan `TypeError` (antes un `Error` genérico; los mensajes no cambian).

## Plugins que pasan a npm

`@botmesh/rag`, `@botmesh/voice`, `@botmesh/nlu`, `@botmesh/dialogflow`,
`@botmesh/chatwoot`, `@botmesh/tickets` y `@botmesh/moderation` se publican en npm desde
la beta (`1.0.0-beta`; instálalos con `@beta` hasta la versión estable). El código que
los usaba desde el monorepo (`workspace:*`) necesita estos cambios:

- **Helpers movidos a una entrada `/internal`** (sin semver; una aplicación rara vez los
  necesita): `@botmesh/rag/internal` (`splitMarkdownSections`, `resolveChunkOptions`,
  `cosine`, `hashText`, `tokenize`, `resolveEmbedder`, `createPdfParser`),
  `@botmesh/voice/internal` (`trimPunctuation`, `resolveStt`, `resolveTts`,
  `OPENAI_TTS_MIMETYPES`, `elevenLabsMimetype`, `estimateOggDurationSec`,
  `estimateDurationSec`, `sniffMimetype`), `@botmesh/dialogflow/internal`
  (`normalizeEsResult`, `normalizeCxResult`, `toSessionId`, `parseCredentials`,
  `createServiceAccountJwt`, `DIALOGFLOW_SCOPE`, `DEFAULT_TOKEN_URI`),
  `@botmesh/chatwoot/internal` (`ChatwootMapping`, `verifyWebhook`, `inboundText`,
  `outboundText`), `@botmesh/tickets/internal` (`renderTemplate`, `localClock`) y
  `@botmesh/moderation/internal` (`findLinks`, `findInviteLinks`, `compileTerms`,
  `foldText`).
- **`@botmesh/dialogflow`:** `dialogflowPlugin` es el nombre canónico y
  `dialogflowContext` un alias obsoleto. `languageCode` vale por defecto `'en'` (antes
  `'es'`): ponle el idioma de tu agente.
- **Datos congelados:** `DEFAULT_VOICE_LIMITS`, `SUPPORTED_EXTENSIONS` (rag),
  `TICKET_PRIORITIES` y `TICKET_STATUSES` ya no se pueden mutar; cópialos antes.
- **`@botmesh/chatwoot`:** se rechaza una firma de webhook sin `x-chatwoot-timestamp` (no
  caducaba, así que una petición capturada se podía repetir). Activa
  `webhookAllowUntimedSignature: true` solo para un emisor que no pueda añadir el timestamp.
- **`@botmesh/tickets`:** `TicketKeyValue` tiene un `setIf` opcional. Un almacenamiento
  propio que lo implemente pasa el desk a modo compartido (seguro con réplicas).

## Paquetes que eran privados

Estas notas importan al código que usaba los paquetes desde el monorepo o un fork antes de
la beta. `@botmesh/discord`, `@botmesh/email` y `@botmesh/flow-schema` están en npm desde la
beta; `@botmesh/tiktok` y los paquetes de producto siguen siendo privados.

- **`@botmesh/discord`:** `ctx.interaction.id` (`interactionId`) es el id de la interacción a
  secas; el token se queda en el provider. `acknowledgeInteraction()` sigue aceptando la
  forma antigua `"<id>:<token>"`. Las interacciones que el bot no confirma en `autoAcknowledgeMs`
  (2 s; `autoAckMs` es su alias obsoleto) se difieren por él; pon `autoAcknowledgeMs: false` para seguir haciéndolo tú.
  Las ediciones de mensajes (`MESSAGE_UPDATE`) llegan ahora como mensajes con el `ref.id`
  original (`isEditedMessage(ctx)`; `editedMessages: 'ignore'` las descarta).
- **Mapeadores de errores renombrados** (los nombres antiguos son alias deprecados):
  `toDiscordError`, `toTikTokError`, `toEmailError`.
- **Stores de producto:** `InboxStore.erase`, `ContactStore.erase` y
  `DeploymentStore.prune` son métodos nuevos obligatorios, y `DeploymentStore.list` /
  `InboxStore.listNotes` aceptan un cursor `after`. Un store propio debe añadirlos (las
  suites de conformidad compartidas de `test-utils/` los comprueban). `attachInbox()` sin
  `tenantId` guarda ahora las conversaciones en el tenant del propio bot en vez de
  `'local'`.
- **`@botmesh/flow-schema`:** `publishFlow()` acepta cualquier registro con un `publish()`
  compatible (un `DeploymentRegistry` encaja) y ya no depende de `@botmesh/deployments` en
  tiempo de ejecución.
