# Integraciones

::: tip Paquetes públicos
Los paquetes de esta página se publican en npm y quedan cubiertos por semver
desde su versión estable (1.0.0). Cada uno guarda sus piezas internas en una
entrada `/internal` sin garantía semver (`@botmesh/nlu` no tiene).
:::

| Paquete | Qué hace | Herramienta |
| --- | --- | --- |
| [`@botmesh/chatwoot`](#chatwoot) | Refleja los chats en un inbox de Chatwoot; los agentes de Chatwoot toman el control mediante el handoff del core | `ctx.tools.chatwoot` |
| [`@botmesh/tickets`](#tickets) | Tickets de soporte con cola por prioridad, horario de atención y persistencia en el store | `ctx.tools.tickets` |
| [`@botmesh/moderation`](#moderacion) | Moderación de grupos: anti-spam, filtros de palabras y enlaces, warn/mute/kick/delete | `ctx.tools.moderation` |
| [`@botmesh/dialogflow`](#dialogflow) | Detección de intenciones con Dialogflow ES/CX y ruteo de intención a flow | `ctx.tools.dialogflow` |
| [`@botmesh/nlu`](#intenciones-locales-nlu) | Intenciones locales a partir de frases de ejemplo, sin red | `ctx.tools.nlu` |

Todos son plugins normales con un `install` síncrono
(`bot.plug(factory({...}))`; `nluPlugin` es un spec, `bot.plug(nluPlugin, config)`). Importar un paquete tipa su entrada de `ctx.tools.*`;
fuera de un handler, usa `bot.injectTools.<nombre>`.

```bash
pnpm add @botmesh/chatwoot @botmesh/tickets @botmesh/moderation @botmesh/dialogflow @botmesh/nlu
```

Instala solo los que uses.

## Cómo encajan en el pipeline

Tres de ellos se enganchan en `before('message')`. La prioridad más alta
corre primero, así que el orden no depende del orden en que llames a
`bot.plug()`:

| Plugin | Hook | Prioridad | Efecto |
| --- | --- | --- | --- |
| chatwoot | `before('message')`, `after('send')` | `1000` | Refleja cada mensaje entrante y cada envío del bot, y luego llama a `next()` |
| moderation | `before('message')` | `100` (`priority`) | Hace `abort()` de un mensaje que infringe una regla o viene de un usuario silenciado |
| dialogflow | `before('message')` | `0` (`priority`) | Ejecuta `detectIntent` y guarda el resultado de ese mensaje (se omite mientras el chat está en handoff) |

De ahí se deduce que:

- Chatwoot ve los mensajes que la moderación descarta después (el agente
  tiene el contexto completo).
- Un mensaje que descarta la moderación nunca llega a Dialogflow, a los
  comandos ni a los handlers.
- Los hooks `before('message')` siguen corriendo mientras un chat está en
  [handoff](/es/guide/handoff), así que la moderación y Chatwoot siguen
  funcionando ahí. El hook de Dialogflow se salta los chats en handoff: no
  se llama a `detectIntent` mientras atiende un humano (ver
  [Dialogflow](#dialogflow)).
- Las rutas de Dialogflow son predicados de `bot.when`, así que ganan al
  catch-all de `aiPlugin` sea cual sea el orden de `plug`. La regla
  "instala `aiPlugin` después de `slashCommandsPlugin`" sigue valiendo;
  estos plugins no la cambian.

## Chatwoot

Conecta el bot con un inbox de **canal API** en
[Chatwoot](https://www.chatwoot.com), sobre la
[API de handoff](/es/guide/handoff) del core.

```ts
import { createServer } from 'node:http'
import { Bot } from '@botmesh/core'
import { chatwootPlugin } from '@botmesh/chatwoot'

const bot = new Bot({ provider, store, lang: 'es', handoff: { allowCommands: ['/bot'] } })

const chatwoot = chatwootPlugin({
  baseUrl: 'https://app.chatwoot.com',
  apiKey: process.env.CHATWOOT_TOKEN!,           // access token de un usuario/agente
  accountId: 1,
  inboxId: 2,                                    // un inbox de tipo "API"
  webhookToken: process.env.CHATWOOT_WEBHOOK_TOKEN!,
  labels: { handoff: ['humano'], resume: ['bot'] },
})
bot.plug(chatwoot)

bot.when('hablar con humano', async (ctx) => {
  await ctx.handoff({ reason: 'el usuario pidió un agente' })
  await ctx.reply('Te conecto con un agente…')
})

// Chatwoot: Settings → Integrations → Webhooks
//   URL: https://bot.example.com/chatwoot?token=<CHATWOOT_WEBHOOK_TOKEN>
//   eventos: message_created, conversation_status_changed
createServer(chatwoot.webhookHandler()).listen(3001)
await bot.start()
```

Con Express o Fastify, pasa el body **crudo**:

```ts
app.post('/chatwoot', express.raw({ type: '*/*' }), async (req, res) => {
  const r = await chatwoot.handleWebhook({ rawBody: req.body, headers: req.headers, query: req.query })
  res.status(r.status).send(r.body)
})
```

### Qué hace

| Evento | Comportamiento del plugin |
| --- | --- |
| Mensaje entrante (también durante el handoff) | Se publica como `incoming` en la conversación del chat (se crea la primera vez). En grupos, el texto va prefijado con el nombre del participante |
| El bot envía | Se publica como `outgoing`. Los medios se reflejan como texto (`[image] caption`…) |
| `ctx.handoff()` / `bot.handoff()` | Conversación en `open`, nota privada (`handoffNote`) y se añaden `labels.handoff`. Si el handoff lo originó el propio Chatwoot (`reason` que empieza por `chatwoot:`), solo se añaden las labels |
| Respuesta pública de un agente (`message_created`) | `bot.handoff(chatId, { reason: 'chatwoot:agent' })` si `autoHandoff` y el chat no está en handoff; luego `bot.send()` (adjuntos por URL). Nunca se re-refleja; un reenvío del mismo id de mensaje se ignora. Si el canal lo rechaza (por ejemplo `OutsideSessionWindowError` en la Cloud API), el mensaje queda **fallido** en Chatwoot con el nombre del error, para que el agente lo vea |
| Conversación resuelta (`conversation_status_changed`, `conversation_resolved`, o `conversation_updated` con cambio de `status`) | `bot.resume(chatId, { reason: 'chatwoot:resolved' })` si el chat está en handoff (`resumeOnResolve`). Solo termina el handoff: no cierra ningún ticket |
| `bot.resume()` por otra causa | Conversación `resolved` (`resolveOnResume`), se quitan `labels.handoff` y se añaden `labels.resume` |

Webhooks que se ignoran: notas privadas, mensajes `incoming`, mensajes de
*agent bots*, otros inboxes, conversaciones desconocidas y los ecos de los
mensajes que creó el propio plugin.

Cada chat se asocia a un contacto de Chatwoot (`identifier` = id del chat)
y a una conversación. El mapeo vive en el store del bot a través de la API
de cursores (`chatwoot:chat:<chatId>`, `chatwoot:conv:<id>`), así que
sobrevive a reinicios con un store persistente. Los ids de chat solo se
usan como claves opacas. Si el mapeo se pierde (un store nuevo, o un
reinicio con `MemoryStore`), el plugin encuentra el contacto por
`identifier` exacto (API de filtros de contactos) y sigue usando su
conversación más reciente en el inbox, así que los agentes que responden
ahí siguen llegando al chat.

Una instancia de `chatwootPlugin()` sirve a un bot: enchufar la misma
instancia en un segundo bot lanza un error (crea una por bot, cada una con
su URL de webhook).

### Opciones de Chatwoot

| Opción | Por defecto | Descripción |
| --- | --- | --- |
| `baseUrl`, `apiKey`, `accountId`, `inboxId` | — | Conexión a Chatwoot (obligatorias) |
| `webhookToken` / `webhookSecret` | — | Al menos una, o `insecureNoWebhookAuth: true` |
| `webhookToleranceSec` | `300` | Desfase admitido del timestamp firmado |
| `webhookAllowUntimedSignature` | `false` | Aceptar también una firma sin `x-chatwoot-timestamp` (repetible) |
| `autoHandoff` | `true` | Pausar el bot cuando responde un agente |
| `resumeOnResolve` | `true` | Reanudar el bot al resolver la conversación |
| `resolveOnResume` | `true` | Resolver la conversación cuando el bot se reanuda por otra vía |
| `handoffNote` | <code v-pre>'🤖 → 👤 Handoff: {{reason}}'</code> | Nota privada al hacer handoff; `false` la desactiva |
| `syncInbound` / `syncOutbound` | `true` | Reflejar entrantes / envíos del bot |
| `syncMode` | `'all'` | `'handoff'` solo refleja los chats que están en handoff |
| `labels` | — | `{ handoff?, resume?, message?(ctx) }` |
| `contact(chatId, ctx)` | — | Datos de un contacto nuevo (`name`, `phoneNumber`, `email`, `customAttributes`). El core nunca deriva un teléfono del id |
| `forwardAttachments` | `true` | Enviar al chat los adjuntos del agente como media por URL |
| `http` | — | `{ fetch, resolver, allowHttp, allowPrivateHosts, timeoutMs }` (timeout por defecto 15 s) |
| `storage` | store del bot | `{ get, set }` de strings propio para el mapeo |
| `onError(error, context)` | log `warn` | Errores de sincronización; nunca rompen el bot |

`ctx.tools.chatwoot` (también el objeto que devuelve `chatwootPlugin()`):
`handleWebhook()`, `webhookHandler({ maxBytes })`, `conversationOf(chatId)`,
`chatOf(conversationId)`, `addLabels(chatId, labels)`,
`removeLabels(chatId, labels)`, `flush()` (espera a la sincronización
pendiente, útil al apagar y en tests) y `client` (`ChatwootClient`).

### Seguridad

- **La autenticación del webhook es obligatoria**: la factory lanza un
  error sin `webhookToken`, `webhookSecret` o `insecureNoWebhookAuth: true`.
  Reserva esta última para un endpoint que no sea accesible desde fuera.
- El token se acepta en `?token=`, `x-chatwoot-token` o
  `Authorization: Bearer`. Chatwoot (comprobado en 4.7) no firma los
  webhooks de cuenta, así que pon el token en la URL del webhook;
  `webhookSecret` es para un emisor o proxy que firme como se describe a
  continuación. La firma HMAC-SHA256 va en
  `x-chatwoot-signature` (hex, admite el prefijo `sha256=`) y se calcula
  sobre `${timestamp}.${rawBody}`, con `x-chatwoot-timestamp` (segundos)
  dentro de `webhookToleranceSec` (300). Una firma sobre el body solo no
  caduca nunca, así que una petición capturada se podría repetir: se
  rechaza salvo con `webhookAllowUntimedSignature: true`. Las comparaciones
  son de tiempo constante.
- `handleWebhook` responde `401` sin autenticación válida, `400` con JSON
  inválido y `503` antes de que el plugin esté instalado; nunca lanza.
  `webhookHandler` solo acepta `POST` y limita el body a 1 MiB.
- El HTTP saliente pasa por `secureFetch` de `@botmesh/http`: solo HTTPS,
  protección anti-SSRF, timeouts y sin seguir redirecciones, así que el
  `api_access_token` nunca llega a otro origen. Un Chatwoot self-hosted en
  la LAN necesita `http.allowPrivateHosts` (y `http.allowHttp` para HTTP
  plano): una `baseUrl` `http://` sin `http.allowHttp` lanza al crear el
  plugin, y un host privado bloqueado se reporta indicando la opción.
- Con `syncMode: 'all'` todas las conversaciones se copian a Chatwoot. Usa
  `syncMode: 'handoff'` si solo los chats escalados deben salir del bot.

### Limitaciones de Chatwoot

- Los medios entrantes se reflejan como texto (`[image] caption`), no se
  suben como adjuntos.
- Un chat, una conversación. Si la conversación mapeada ya no existe
  (Chatwoot responde 404, o 422 mientras aún borra un contacto), se crea
  otra y el mensaje va ahí.
- Marcar como fallida una respuesta rechazada usa la API de estado de
  mensajes, que Chatwoot solo ofrece en inboxes de canal API (el tipo que
  este plugin necesita de todos modos).
- Si el store no tiene cursores, el mapeo vive en memoria (se avisa en el
  log al instalar).

## Tickets

Tickets de soporte y una cola en `ctx.tools.tickets`.

```ts
import { ticketsPlugin } from '@botmesh/tickets'

bot.plug(ticketsPlugin({
  workingHours: { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' },
  timezone: 'America/Bogota',
  queueMessage: 'Estás en cola, posición {{position}} (ticket #{{id}})',
  closedMessage: 'Estamos fuera de horario; te respondemos al abrir (ticket #{{id}})',
  assignMessage: '{{assignee}} atiende tu ticket #{{id}}',
  closeMessage: 'Ticket #{{id}} cerrado. ¡Gracias!',
  handoffOnAssign: true,   // bot.handoff(chatId) al asignar
  resumeOnClose: true,     // bot.resume(chatId) al cerrar
  onAssign: async (ticket) => notifyAgent(ticket),
}))

bot.when('soporte', async (ctx) => {
  const ticket = await ctx.tools.tickets!.create({ chatId: ctx.from, subject: ctx.body, priority: 'normal' })
  if (!ticket.created) await ctx.reply(`Ya tienes el ticket #${ticket.id}`)
})

// Panel de agentes / tu propia API
const tickets = bot.injectTools.tickets!
await tickets.assign('1', 'ana')
await tickets.close('1', { reason: 'resuelto' })
```

### API

| Método | Descripción |
| --- | --- |
| `create({ chatId, subject, priority?, meta? })` | Crea un ticket `open`. Resuelve con el ticket más `created`, `position` (1-based o `null`) y `withinWorkingHours`. Con `reuseOpen` (por defecto `true`) devuelve en su lugar el ticket no cerrado del chat (`created: false`) |
| `get(id)` | El ticket o `undefined` |
| `update(id, patch)` | `subject`, `priority`, `status`, `assignee` (`null` desasigna y lo devuelve a la cola), `meta`. Rechaza con `TicketNotFoundError` |
| `list(filter?)` | Por `status` (uno o varios), `chatId`, `assignee`, `priority`; del más antiguo al más nuevo |
| `assign(id, assignee)` | Estado `assigned`; dispara `onAssign` |
| `close(id, { reason? })` | Estado `closed`, rellena `closedAt` y `closeReason`; dispara `onClose` |
| `queue()` | Tickets `open` por prioridad (`urgent` > `high` > `normal` > `low`) y luego por antigüedad |
| `position(id)` | Posición en la cola o `null` |
| `isOpen(date?)` | Si es horario de atención (siempre `true` sin `workingHours`) |

Estados: `open` (en cola), `assigned`, `pending` (esperando al cliente,
fuera de la cola) y `closed`. Los ids son strings secuenciales (`'1'`,
`'2'`…).

### Opciones de tickets

| Opción | Por defecto | Descripción |
| --- | --- | --- |
| `workingHours` | — | `'9-18'`, `'09:30-18:15'`, `{ days, start, end }` (`0` = domingo … `6` = sábado), un array de ventanas o `(date) => boolean`. El fin es exclusivo; `'22-6'` cruza la medianoche |
| `timezone` | zona del proceso | Zona IANA con la que se evalúa `workingHours` (una zona desconocida lanza un error al hacer `plug`) |
| `queueMessage` / `closedMessage` | — | Se envían al crear, dentro / fuera del horario (`closedMessage` recurre a `queueMessage`) |
| `assignMessage` / `closeMessage` | — | Se envían al asignar / cerrar |
| `handoffOnAssign` | `false` | `bot.handoff(chatId, { reason: 'ticket:assigned' })` al asignar |
| `resumeOnClose` | `false` | `bot.resume(chatId, { reason: 'ticket:closed' })` al cerrar, si el chat está en handoff |
| `reuseOpen` | `true` | Devolver el ticket abierto del chat en lugar de crear otro |
| `onCreate`, `onAssign`, `onClose`, `onUpdate(ticket, previous)` | — | Se ejecutan tras persistir el cambio |
| `onError(error, source)` | log `warn` | Errores de callbacks y notificaciones; nunca hacen fallar la operación |
| `storage` / `keyPrefix` | store del bot / `'tickets:'` | Persistencia `{ get, set }` propia y prefijo de claves |

Las plantillas admiten <code v-pre>{{id}}</code>, <code v-pre>{{position}}</code>, <code v-pre>{{subject}}</code>,
<code v-pre>{{priority}}</code>, <code v-pre>{{assignee}}</code>, <code v-pre>{{status}}</code> y <code v-pre>{{reason}}</code>.

### Persistencia

Por defecto los tickets se guardan con la API de cursores del store
(`tickets:seq`, `tickets:index`, `tickets:t:<id>`), que implementan los
seis stores; con un `MemoryStore` simple viven en RAM. En memoria solo
quedan los tickets no cerrados; los cerrados se leen bajo demanda. Los
datos se cargan de forma perezosa en la primera llamada y las mutaciones se
serializan: si falla una escritura en el store, la llamada se rechaza y la
memoria no cambia. `TicketDesk` también se puede usar sin bot:
`new TicketDesk({ storage: memoryTicketStorage() })`.

### Limitaciones de tickets

- No hay interfaz ni identidad de agentes: `assignee` es un string libre.
  Construye el panel sobre `bot.injectTools.tickets` y protégelo tú.
- Con `handoffOnAssign`, solo la primera asignación pasa el chat a un
  humano: una reasignación mantiene el handoff y su `meta.assignee` (lee el
  ticket para saber el agente actual), y desasignar (`assignee: null`)
  devuelve el ticket a la cola pero deja el chat en handoff. Llama tú a
  `bot.resume(chatId)` si el bot debe volver a responder.
- `meta` tiene que ser un objeto JSON plano (sin `Date`, `Map`, instancias
  de clases, funciones ni `BigInt`); cualquier otra cosa se rechaza antes
  de guardar el ticket. Una propiedad con valor `undefined` se descarta,
  como en JSON, así que `{ email: user?.email }` o `{ ...prev, clave: undefined }`
  (para quitar una clave) funcionan; un `undefined` dentro de un array se
  rechaza.
- En modo compartido cada llamada relee el índice y todos los tickets
  activos, así que su coste crece con el número de tickets abiertos.
- `list()` con un filtro que pueda incluir `closed` recorre todos los ids
  desde 1 hasta el último.
- El almacenamiento por defecto (los cursores del store) no tiene
  compare-and-set, así que sirve para un proceso por namespace del store:
  dos réplicas sobre él repartirían el mismo id y se pisarían el índice.
  Para réplicas, pasa un almacenamiento con `setIf`, como
  `durableKvTicketStorage(kv)` sobre el mismo `DurableKv` (Postgres, Redis,
  SQLite o un archivo) en todas las réplicas. El desk relee entonces el
  índice en cada llamada, reclama los ids con compare-and-set y reintenta
  una escritura perdida (`maxRetries`, 20 por defecto; después
  `TicketContentionError`). Con `reuseOpen` (por defecto) también reclama
  con compare-and-set el ticket abierto del chat, así que dos réplicas que
  crean a la vez un ticket para el mismo chat (desde un handler, la API o
  el manager) obtienen el mismo. Un `create` que falla nunca deja un ticket
  abierto invisible para `get`, `list` y `queue`.

  ```ts
  import { durableKvTicketStorage, ticketsPlugin } from '@botmesh/tickets'

  bot.plug(ticketsPlugin({ storage: durableKvTicketStorage(kv) }))
  ```

## Moderación

Moderación de grupos que corre antes que cualquier handler.

```ts
import { Bot } from '@botmesh/core'
import { moderationPlugin } from '@botmesh/moderation'

const bot = new Bot({ provider, lang: 'es' }) // groupMode 'all' (el de por defecto)

bot.plug(moderationPlugin({
  provider,                                   // activa delete/kick/admins si el provider los admite
  antiSpam: { maxMessages: 5, windowMs: 10_000, action: 'warn' },
  wordFilter: { banned: ['spam', 'estafa', /bit\.ly\/\w+/i], action: 'delete' },
  autoKickOnLink: true,                       // = linkFilter: { action: ['delete', 'kick'] }
  warnings: { max: 3, then: 'kick' },
  groups: {
    [grupoStaff]: false,                      // sin moderación aquí
    [grupoVentas]: { wordFilter: { banned: ['gratis'] } },
  },
}))

bot.on('moderation', (report) => {
  // { chatId, senderId, rule, detail, ref, results: [{ action, status }], warnings }
})
```

Un mensaje que infringe una regla ejecuta sus acciones y recibe `abort()`:
no llega a comandos, conversaciones ni handlers. Los mensajes de un usuario
silenciado se descartan hasta que vence el silencio. Por defecto solo se
moderan **grupos** (`applyTo: 'all'` incluye los chats privados). Las
interacciones y los mensajes propios del bot nunca se moderan.

### Reglas y acciones

| Regla | Campos | Acción por defecto |
| --- | --- | --- |
| `antiSpam` | `maxMessages`, `windowMs` (ventana deslizante por chat + remitente) | `'warn'` |
| `wordFilter` | `banned: (string \| RegExp)[]`, `wholeWord` (por defecto `true`) | `'delete'` |
| `linkFilter` | `groupInvites` (por defecto `true`), `allLinks`, `allowInvites`, `allowDomains`, `invitePatterns` | `['delete', 'warn']` |

- Las palabras se comparan sin mayúsculas ni tildes (la `ñ` sigue siendo
  distinta de la `n`) y como palabra completa; las RegExp se prueban sobre
  el texto crudo.
- Antes de buscar palabras y enlaces se quitan los caracteres invisibles
  (espacios de ancho cero, guion suave, controles bidi) y las formas de
  compatibilidad como `ｓｐａｍ` (ancho completo) se leen como letras
  normales, así que no sirven para esconder una palabra o una invitación.
  El formato de WhatsApp alrededor de un enlace (`_cursiva_`, `*negrita*`,
  `~tachado~`) tampoco lo esconde.
- Invitaciones reconocidas: WhatsApp (`chat.whatsapp.com/…`), Telegram
  (`t.me/+…`, `t.me/joinchat/…`) y Discord (`discord.gg/…`,
  `discord.com/invite/…`). `allowInvites` compara el código exacto.
- `action` acepta una acción o varias en orden.
- `autoKickOnLink: true` es un atajo de
  `linkFilter: { action: ['delete', 'kick'] }` y solo se aplica si no hay
  `linkFilter` definido (global o en el override del grupo).

| Acción | Cómo se ejecuta | Sin soporte |
| --- | --- | --- |
| `delete` | `provider.deleteMessage(ref)` | `'unsupported'`. Sin `provider` en la config usa `ctx.delete()` y reporta `'attempted'` |
| `kick` | `provider.groups.removeParticipants(chatId, [userId])` | `'unsupported'` y se degrada a `mute` (`kickFallback: 'none'` lo evita) |
| `mute` | Estado interno: los mensajes del usuario se ignoran durante `muteMs` (por defecto 10 min) | Siempre disponible |
| `warn` | `bot.send` al grupo, citando el mensaje y mencionando al usuario | `'failed'` si el envío falla |

Las advertencias se cuentan por chat + usuario; al llegar a
`warnings.max` el plugin ejecuta `warnings.then` y pone el contador a cero
(`warnings: false` lo desactiva). Los textos se configuran con
`messages: { warn, reasons }` (`{name}`, `{reason}`, `{count}`, `{max}`); los
de serie siguen el idioma del chat (inglés por defecto, español con
`lang: 'es'`).

Los administradores se saltan todas las reglas (`adminBypass`, por defecto
`true`): los ids de `admins`, quien apruebe `isAdmin(chatId, userId)` y la
lista de `provider.groups.getAdmins(chatId)`, en caché durante
`adminCacheMs` (por defecto 5 min) e invalidada con los eventos de grupo
`promote`/`demote`. Los administradores solo se consultan para un mensaje
que rompe una regla o viene de un usuario silenciado. Si `isAdmin` lanza,
el remitente cuenta como no administrador (y se registra un aviso); si
`getAdmins` falla, se conserva la última lista conocida y se vuelve a
preguntar al provider tras 30 segundos como mucho. Cuando alguien sale (`remove`), se olvidan sus
advertencias, su silencio y su ventana de spam. El estado no crece sin
límite en un bot de larga duración: los silencios vencidos y las listas de
administradores caducadas se barren, y se guardan como mucho
`maxTrackedUsers` (10 000 por defecto) contadores de advertencias; se
descarta el del usuario advertido hace más tiempo.

`ctx.tools.moderation`: `mute`, `unmute`, `isMuted`, `warnings`,
`resetWarnings`, `kick` (resuelve un `ActionResult`), `setGroupRules`
(`false` desactiva, `undefined` quita el override) e `invalidateAdmins`.

La configuración se valida al llamar a `moderationPlugin()` y en
`setGroupRules`: una acción desconocida, un contador o una ventana no
positivos o un campo de tipo incorrecto lanzan un `TypeError`/`RangeError`
que nombra el campo. `{name}` en el texto de la advertencia es el nombre
visible del remitente sin caracteres de control ni bidi, en una sola línea
y con 64 caracteres como mucho.

::: warning `groupMode` corre antes
El filtro `groupMode` del bot corre **antes** de los hooks
`before('message')`. Con `groupMode: 'mentions'` o `'commands'`, los
mensajes de grupo que no mencionan al bot o no son comandos nunca llegan a
la moderación. Usa `groupMode: 'all'` (el valor por defecto) para moderar
todo el grupo; el plugin avisa en el log al instalarse si detecta un modo
restrictivo.
:::

### Limitaciones de la moderación

- El estado (ventanas de spam, advertencias, silencios) vive en memoria y
  se pierde al reiniciar.
- Ningún provider del monorepo expone todavía
  `groups.removeParticipants` / `getAdmins`, así que `kick` se degrada a
  `mute` y la detección de admins depende de `admins` / `isAdmin`.
- `GroupAdminApi` y `ModerationProvider.groups` son `@experimental`
  (fuera de semver) hasta que `@botmesh/core` defina una capacidad de
  grupos para los providers; su forma puede cambiar en una versión minor.

## Dialogflow

Pasa cada texto entrante por `detectIntent` de Dialogflow ES o CX y rutea
la intención a un handler o a un [flow](/es/guide/flujos). Sin SDK de
Google: el JWT de la cuenta de servicio se firma con `node:crypto` (RS256)
y todas las peticiones salen por `secureFetch`.

```ts
import { Bot, flow } from '@botmesh/core'
import { dialogflowPlugin, whenDialogflowIntent } from '@botmesh/dialogflow'

const bot = new Bot({ provider, lang: 'es' })

bot.plug(dialogflowPlugin({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS!), // JSON de la cuenta de servicio
  languageCode: 'es',
  fulfillment: 'unrouted',     // responde con el texto del agente si la intención no tiene ruta
}))

const df = bot.injectTools.dialogflow!

// Handler: recibe el resultado normalizado
whenDialogflowIntent(bot, df, 'order.status', (ctx, r) =>
  ctx.reply(`Buscando el pedido ${String(r.parameters.order)}…`))

// Flow: los parámetros se copian a c.state antes del primer paso
whenDialogflowIntent(bot, df, 'book.table', flow('reserva')
  .say((_ctx, c) => `Reserva para ${String(c.state.people)} personas`)
  .ask('¿A nombre de quién?', 'name'))

bot.onMessage((ctx) => ctx.reply('No te entendí'))   // aquí caen los mensajes sin ruta
```

Las rutas también pueden ir en la config:
`routes: { 'book.table': reservaFlow, greeting: (ctx) => ctx.reply('¡Hola!') }`.
Para CX, añade `cx: { agentId, location, environment? }`.

### Cómo funciona

1. El hook `before('message')` llama a `detectIntent` y guarda el
   resultado asociado a **ese** mensaje.
   `ctx.tools.dialogflow.resultFor(ctx)` lo lee desde cualquier handler.
2. `whenDialogflowIntent` registra un predicado de `bot.when` que lee ese
   resultado (sin una segunda llamada). Si la intención coincide con al
   menos `minConfidence`, se ejecuta el destino; si no, el mensaje sigue
   hacia los demás matchers y el catch-all.
3. No se envían a Dialogflow: mensajes vacíos, interacciones, comandos
   (`commandPrefix`, por defecto `'/'`), textos de más de `maxTextLength`
   (256 caracteres, el límite de la API), mensajes de un chat en
   [handoff](/es/guide/handoff), mensajes de un usuario dentro de una
   conversación activa (`skipActiveConversation`, por defecto `true`) y lo
   que rechace `filter`.
4. Si `detectIntent` (o `filter`) falla, se registra en el log, se llama a
   `onError(error, ctx)` y el mensaje sigue su camino. Un `401` descarta el
   access token en caché y reintenta una vez con uno nuevo.

Mientras a una intención de ES le faltan parámetros obligatorios, el
resultado trae `allRequiredParamsPresent: false` y la pregunta del agente en
`messages`. La ruta se ejecuta igual, así que comprueba ese campo en el
handler si la intención depende del rellenado de parámetros de Dialogflow.

`fulfillment: 'all'` también responde con el texto del agente a los
resultados de fallback / no-match, así que esos mensajes nunca llegan a tu
`onMessage` ni al catch-all de `aiPlugin`. Deja `'off'` o `'unrouted'` si
un LLM debe responder lo que Dialogflow no entiende.

### Opciones de Dialogflow

| Opción | Por defecto | Descripción |
| --- | --- | --- |
| `credentials` | — | JSON de la cuenta de servicio (`client_email`, `private_key`, `project_id`…) |
| `tokenSource` | — | `{ getAccessToken(), invalidate?(token) }`, alternativa a `credentials` (con `invalidate`, un `401` se reintenta una vez) |
| `projectId` | `credentials.project_id` | Proyecto de Google Cloud |
| `languageCode` / `languageFor(ctx)` | `'en'` | Idioma de las consultas, global / por mensaje |
| `queryParams(ctx)` | — | `queryParams` crudos por mensaje |
| `cx` | — | `{ agentId, location, environment? }` cambia a CX |
| `location` / `environment` | global / draft | Solo ES: agente regional o entorno publicado |
| `minConfidence` | `0` | Confianza mínima para rutear, entre 0 y 1 |
| `sessionScope` / `sessionKey(ctx)` | `'participant'` | En grupos, una sesión por participante (como las conversaciones) o por grupo (`'chat'`); o tu propia clave. Un chat privado es una sesión |
| `routes` | — | Intención → handler o flow |
| `fulfillment` | `'off'` | `'unrouted'` o `'all'` responden solos con los textos del agente |
| `commandPrefix` | `'/'` | `false` también envía los comandos |
| `maxTextLength` | `256` | Los textos más largos no se envían (la API los rechaza) |
| `skipActiveConversation` | `true` | No consultar dentro de una conversación |
| `filter(ctx)` | — | Devuelve `false` para saltarte un mensaje (si lanza, el mensaje no se envía y se llama a `onError`) |
| `priority` | `0` | Prioridad del before-hook |
| `onError(error, ctx)` | — | Fallos de `detectIntent` y de `filter` |
| `http` | — | `{ fetch, resolver, timeoutMs, maxBytes }` para `secureFetch` |

### Seguridad y privacidad

- Unas credenciales inválidas (`code: 'INVALID_CREDENTIALS'`) y unas
  opciones inválidas (`code: 'INVALID_CONFIG'`: `minConfidence` fuera de 0–1,
  un `fulfillment` o `sessionScope` desconocido, un `commandPrefix` vacío,
  una `location` mal formada…) lanzan `DialogflowError` de forma
  **síncrona** al hacer `bot.plug()`. El access token se pide de forma
  perezosa con el primer mensaje, se guarda en caché y se renueva poco
  antes de caducar.
- La clave de sesión se hashea (SHA-256, 32 caracteres) antes de usarse
  como id de sesión de Dialogflow, así que ni los ids de chat ni los
  números de teléfono se envían a Google. El **texto** del mensaje sí.
- Guarda el JSON de la cuenta de servicio en un secreto, nunca en el repo.
- Los parámetros (en el resultado y al copiarse a `c.state`) omiten `__proto__`, `constructor` y
  `prototype`: vienen de un servicio remoto y no deben llegar al prototipo del
  objeto de estado.
- Un destino de ruta que no sea una función handler, un builder `flow()` o un
  flow compilado lanza un `TypeError` al registrarlo.

### Limitaciones de Dialogflow

- Solo se envía texto (ni audio ni eventos). En CX el rellenado de
  formularios vive en las páginas: `allRequiredParamsPresent` siempre es
  `true`.

## Intenciones locales (NLU)

`@botmesh/nlu` compara los mensajes con intenciones que defines con frases de
ejemplo, todo dentro del proceso: sin red, sin modelo y sin dependencias
extra. Sirve para intenciones tipo comando ("dónde está mi pedido", "hablar con
una persona") en un bot que no debe pagar un LLM ni un agente de Dialogflow por
cada mensaje. Para lenguaje abierto, usa el [plugin de IA](/es/guide/ai), solo
o detrás de este.

```ts
import { nluPlugin, whenIntent } from '@botmesh/nlu'

bot.plug(nluPlugin, {
  threshold: 0.5, // confianza mínima, 0..1
  intents: {
    saludo: ['hola', 'buenas', 'buenos días'],
    'pedido.estado': ['mi pedido {id}', 'estado de mi pedido', 'dónde está mi pedido'],
  },
})
const nlu = bot.injectTools.nlu!

whenIntent(bot, nlu, 'saludo', (ctx) => ctx.reply('¡Hola! ¿En qué te ayudo?'))
whenIntent(bot, nlu, 'pedido.estado', async (ctx, match) => {
  const id = match.entities?.id
  await ctx.reply(id ? `Buscando el pedido ${id}…` : '¿Cuál es tu número de pedido?')
})
// Lo que ninguna intención reclama sigue a otros handlers (o al autoresponder de IA).
```

- `nluPlugin` es un plugin spec: se enchufa con `bot.plug(nluPlugin, config)`.
  Deja un `IntentEngine` en `ctx.tools.nlu` (y en `bot.injectTools.nlu`).
- `whenIntent(bot, engine, intent, handler)` es un predicado de `bot.when()`:
  el handler solo corre cuando la **mejor** intención del mensaje es esa, por
  encima del umbral, y recibe el resultado. Devuelve la función para quitarlo.
- `engine.match(text)` devuelve `{ intent, confidence, entities? }` o `null`;
  `engine.rank(text)` puntúa todas las intenciones (útil para depurar una
  frase); `engine.define(intent, utterances)` añade frases en caliente.
- La comparación normaliza mayúsculas, tildes, puntuación, letras de ancho
  completo y caracteres invisibles (`¡HOLA!` equivale a `hola`) y puntúa por
  palabras en común; los signos vocálicos de escrituras como el devanagari se
  quedan en su palabra. Una frase con solo emojis o puntuación lanza en
  `define()`: nunca podría coincidir. La puntuación separa palabras, así que un
  id como `A-1` no llena un único slot. Una frase exacta, o una con
  marcadores `{slot}` que encaja con todo el mensaje, puntúa `1`; cada slot
  captura una palabra.
- Alcance: sin lematización, sinónimos ni embeddings. Dale a cada intención
  varias frases cortas con las palabras que de verdad escriben tus usuarios y
  evita intenciones que compartan casi todo el vocabulario.

## Combinarlos

Tickets y Chatwoot controlan ambos el handoff del core, así que se
combinan a través de sus eventos:

```ts
bot.plug(moderationPlugin({ provider, antiSpam: { maxMessages: 5, windowMs: 10_000 } }))
bot.plug(chatwootPlugin({ /* … */ labels: { handoff: ['humano'] } }))
bot.plug(ticketsPlugin({ handoffOnAssign: true, resumeOnClose: true }))
```

Asignar un ticket llama a `bot.handoff()`, y el evento `'handoff'` abre la
conversación de Chatwoot con sus labels. Cerrar el ticket llama a
`bot.resume()`, y Chatwoot resuelve la conversación. Resolverla en Chatwoot
reanuda el bot, pero no cierra el ticket: hazlo desde tu propio listener
`bot.on('resume', …)` si lo necesitas (el `reason` del evento es
`'chatwoot:resolved'`).

## Siguientes pasos

- [Handoff humano](/es/guide/handoff)
- [Hooks](/es/guide/hooks)
- [Plugins](/es/guide/plugins)
- [IA](/es/guide/ai)
