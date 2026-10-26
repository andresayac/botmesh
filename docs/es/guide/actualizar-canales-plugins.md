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
descartando un reintento idéntico. Para volver al comportamiento anterior:

```ts
new BaileysProvider({ session: 'mi-bot', editedMessages: 'ignore' })
```

### `@botmesh/ai`

**`provider: 'openai'` con `baseUrl` envía `max_tokens`.** Con cualquier `baseUrl` que no
sea `api.openai.com` ni `*.openai.azure.com`, el tope de tokens de salida va ahora en
`max_tokens`, que es lo que esperan los servidores compatibles con OpenAI (vLLM, LM Studio,
gateways). Si tu `baseUrl` es un proxy delante de OpenAI y usas un modelo o-series o gpt-5,
vuelve a fijar el campo:

```ts
aiPlugin({ provider: 'openai', baseUrl: 'https://mi-proxy.example/v1', maxTokensField: 'max_completion_tokens' })
```

**Las opciones de memoria fallan pronto.** Un `memory.maxFactLength`, `memory.maxFacts` o
`memory.ttl` inválido lanza ahora un `RangeError` desde `aiPlugin()` en vez de fallar en
`plug()` (o, con `maxFactLength`, descartar en silencio todos los hechos).

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

### `@botmesh/telegram`

- En modo webhook, `ingest()` tras `stop()` responde `503` y no emite nada (Telegram reenvía
  el Update tras el reinicio). Los hosts que vuelven a arrancar el provider no tienen que
  cambiar nada.
- Las subidas de archivos tienen su propio timeout, `uploadTimeoutMs` (5 minutos por
  defecto).

### `@botmesh/sqlite-store`

`saveMessage` y `setCursor` lanzan `TypeError` con un id de mensaje, id de chat, clave o
valor de cursor que lleve un surrogate UTF-16 suelto (antes SQLite lo guardaba como U+FFFD y
dos ids podían compartir fila). Escapa o quita esos caracteres antes de guardarlos.

## Paquetes privados

No están en npm; estas notas solo importan dentro del monorepo o de un fork.

- **`@botmesh/chatwoot`:** se rechaza una firma de webhook sin `x-chatwoot-timestamp` (no
  caducaba, así que una petición capturada se podía repetir). Activa
  `webhookAllowUntimedSignature: true` solo para un emisor que no pueda añadir el timestamp.
- **`@botmesh/discord`:** `ctx.interaction.id` (`interactionId`) es el id de la interacción a
  secas; el token se queda en el provider. `acknowledgeInteraction()` sigue aceptando la
  forma antigua `"<id>:<token>"`. Las interacciones que el bot no confirma en `autoAckMs`
  (2 s) se difieren por él; pon `autoAckMs: false` para seguir haciéndolo tú.
- **`@botmesh/messenger` / `@botmesh/instagram`:** más de 3 botones (o 10 filas de lista) en
  Messenger, o más de 13 quick replies en Instagram, rechazan con `UnsupportedContentError`
  en vez de cortarse.
- **`@botmesh/tickets`:** `TicketKeyValue` tiene un `setIf` opcional. Un almacenamiento
  propio que lo implemente pasa el desk a modo compartido (seguro con réplicas).
- **Stores de producto:** `InboxStore.erase`, `ContactStore.erase` y
  `DeploymentStore.prune` son métodos nuevos obligatorios, y `DeploymentStore.list` /
  `InboxStore.listNotes` aceptan un cursor `after`. Un store propio debe añadirlos (las
  suites de conformidad compartidas de `test-utils/` los comprueban). `attachInbox()` sin
  `tenantId` guarda ahora las conversaciones en el tenant del propio bot en vez de
  `'local'`.
- **`@botmesh/flow-schema`:** `publishFlow()` acepta cualquier registro con un `publish()`
  compatible (un `DeploymentRegistry` encaja) y ya no depende de `@botmesh/deployments` en
  tiempo de ejecución.
