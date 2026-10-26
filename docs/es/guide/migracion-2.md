# Migrar a 2.0

`@botmesh/core` 2.0 sale de la serie alpha con unos pocos cambios de
comportamiento deliberados. Esta página explica cada uno, qué cambió y cómo
mantener el comportamiento anterior cuando todavía es posible. La mayoría de
los bots necesitan como mucho dos cambios: `lang: 'es'` si el bot habla
español y `maxAttempts` donde una espera usaba `retries`.

| Cambio | A quién afecta | Qué hacer |
| --- | --- | --- |
| [Los textos internos pasan a inglés](#los-textos-internos-pasan-a-ingles) | Bots que contaban con los textos en español | Añade `lang: 'es'` |
| [`retries` y `maxAttempts`](#retries-y-maxattempts) | Esperas, formularios y flujos JSON con `retries` | Cambia `retries: N` por `maxAttempts: N` |
| [Los envíos necesitan el bot en marcha](#los-envios-necesitan-el-bot-en-marcha) | Código que envía antes de `start()` o después de `stop()` | Envía después de `start()` o captura `BotNotRunningError` |
| [Los flujos se validan al definirlos](#los-flujos-se-validan-al-definirlos) | `choose({})`, `ask(texto, '')` | Corrige la definición |
| [Un envío de `ctx` limitado se reintenta una vez](#un-envio-de-ctx-limitado-se-reintenta-una-vez) | Bots sobre transportes que responden 429 | Nada, o ajusta `rateLimitRetry` |
| [Eventos de provider inválidos](#eventos-de-provider-invalidos) | Providers propios | Emite eventos bien formados |
| [Un hook que llama a `next()` dos veces](#un-hook-que-llama-a-next-dos-veces) | Hooks con ese error | Llama a `next()` una sola vez |
| [Los ids de los logs van hasheados](#los-ids-de-los-logs-van-hasheados) | Búsquedas en logs por teléfono o id de chat | `logIds: 'raw'` para depurar en local |
| [Logs append dañados](#logs-append-danados) | `FileDurability` / `SharedFileEventJournal` con `appendLog` | Repara el log si `open` lo rechaza |
| [`MemoryCoordinationHub` expulsa chats inactivos](#memorycoordinationhub-expulsa-chats-inactivos) | Tests que inspeccionan el hub | Nada |
| [`broadcast({ maxRetries })`](#reintentos-de-broadcast) | Difusiones | Renómbralo a `retries` (el alias se mantiene) |
| [Las etiquetas de WhatsApp Flows pasan a inglés](#las-etiquetas-de-whatsapp-flows-pasan-a-ingles) | Formularios de `@botmesh/meta` publicados con `toFlowJson` / `publishForm` | Pasa `lang: 'es'` |
| [Presencia sin conexión](#presencia-sin-conexion) | Código que esperaba que `typing()` / `markRead()` lanzaran sin conexión; providers propios | Nada; los providers propios resuelven sin conexión |
| [Evento `'stopping'`](#evento-stopping) | Plugins que cancelan trabajo en `'stopped'` | Escucha `'stopping'` para cancelar antes de parar el transporte |
| [Los flujos persistentes hacen checkpoint al empezar](#los-flujos-persistentes-hacen-checkpoint-al-empezar) | Stores que cuentan escrituras de checkpoint | Nada (una escritura más por entrada al flujo) |
| [Mensajes de error sin ids de chat](#mensajes-de-error-sin-ids-de-chat) | Código que sacaba el chat del mensaje de un error | Lee `error.chatId` |
| [Arreglos menores](#arreglos-menores) | `ctx.delete()` después de `stop()`, `ctx.acknowledge`, tipos de evento desconocidos, `lang` + `i18n.defaultLocale`, `ChaosProvider.selfId` | Ver la sección |

## Los textos internos pasan a inglés

Los textos que el core escribe por ti (expiración de la conversación,
"demasiados intentos", avisos de las esperas, respuestas de los comandos slash,
pistas de los formularios y la palabra para omitir un campo) estaban en español
salvo que el bot configurara i18n. Ahora están en inglés: la palabra para omitir
es `skip`, el mensaje de reintentos es `❌ Too many attempts. Conversation
ended.`, etc. `@botmesh/ai` hace lo mismo: sus textos internos (pregunta de
confirmación, botones Sí/No, respuestas de reserva, línea de fuentes) están en
inglés cuando no se conoce el idioma.

Los textos en español siguen incluidos. Una opción los recupera sin activar la
resolución de idioma por usuario:

```ts
const bot = new Bot({ provider, lang: 'es' })
```

`i18n: { defaultLocale: 'es' }` también sirve, pero activa la resolución de
idioma (preferencia guardada, idioma del cliente, detector). Consulta
[Internacionalización](./i18n#un-bot-en-un-solo-idioma-lang). Las plantillas de
`create-botmesh` ya ponen `lang: 'es'`.

## `retries` y `maxAttempts`

Toda opción `retries` significa ahora lo mismo: intentos **después** del
primero. Así funcionaba ya `durability.outbox.retries`, pero en las esperas
(`ask`, `waitText`, `choose`…), los pasos de formulario y los pasos `ask`/`form`
de los flujos JSON `retries: N` significaba N respuestas en total. El total
tiene ahora su propia opción:

- `maxAttempts: N`: la espera acepta N respuestas en total, la primera incluida.
- `retries: N`: equivale a `maxAttempts: N + 1`.

El valor por defecto no cambia (3 respuestas en total). Para conservar el
comportamiento de las alphas, cambia el nombre de la opción:

```ts
// 2.0 alpha: 3 respuestas en total
flow('x').ask('¿Email?', 'email', { validate, retries: 3 })
// 2.0: lo mismo
flow('x').ask('¿Email?', 'email', { validate, maxAttempts: 3 })
```

Pasar las dos con valores que no cuadran lanza un `TypeError`. Los valores
inválidos (`maxAttempts: 0`, `retries: -1`) lanzan al definir el flujo.
`bot.broadcast()` sigue la misma convención (ver [más abajo](#reintentos-de-broadcast)).

El código que aún no hayas renombrado sigue funcionando con una respuesta más que
antes. Para que se note, el bot escribe **un aviso** (`logger.warn`, una vez por
bot) la primera vez que una espera, un formulario o un paso de flujo usa
`retries` sin `maxAttempts`. Poner `maxAttempts` (sola o con un `retries` que
cuadre) lo silencia.

Los documentos de flujo JSON (`@botmesh/flow-schema`, que guardan el manager y
`@botmesh/deployments`) no cambian de significado: el formato pasa a la
**versión 2** y un documento de la versión 1 se migra al cargarlo
(`validateFlowDocument`, `compileFlowDocument`, `flowFromArtifact` o, de forma
explícita, `migrateFlowDocument`). La migración 1 → 2 reescribe `retries: N` como
`maxAttempts: N` (un `retries: 0` antiguo se comportaba como 1 y pasa a
`maxAttempts: 1`), así que los flujos v1 publicados conservan su presupuesto. En
un documento de la versión 2, `retries` tiene el significado nuevo.
`isFlowDocument()` solo acepta la versión actual.

## Los envíos necesitan el bot en marcha

`bot.send()`, `ctx.reply()`, las ediciones y las actualizaciones de stream
hechas antes de `bot.start()` (o tras un arranque fallido) o después de
`bot.stop()` llegaban al provider. Ahora rechazan con `BotNotRunningError`
(`code: 'BOT_NOT_RUNNING'`) y no envían nada. Los envíos se aceptan desde que
el transporte empieza a conectar, así que un listener de `'ready'` puede seguir
enviando.

Las llamadas concurrentes a `start()` / `stop()` se ejecutan de una en una y en
orden: la última decide el estado final (`start(); stop(); start()` termina en
marcha).

## Los flujos se validan al definirlos

Estos casos solo fallaban cuando un usuario llegaba al paso. Ahora lanzan un
`TypeError` al definir el flujo:

- `.choose(prompt, {})` (sin opciones), `options` que no es un objeto, o una
  opción sin etiqueta;
- `.ask(texto, '')` o `.choose(prompt, opciones, '')` (clave de estado vacía);
- `maxAttempts` / `retries` inválidos en `.ask()`, `.choose()` y `.form()`.

## Un envío de `ctx` limitado se reintenta una vez

Un envío de `ctx` (en un handler, un flujo o una conversación) que el transporte
rechaza con un `RateLimitedError` que pide esperar como mucho 5 s se reintenta
en el sitio. Las alphas reintentaban dos veces; 2.0 reintenta una vez por
defecto y permite configurarlo:

```ts
new Bot({ provider, rateLimitRetry: { retries: 2, maxWaitMs: '10s' } })
new Bot({ provider, rateLimitRetry: false })   // nunca reintentar en el sitio
```

`bot.send()` no se reintenta (las difusiones y el outbox durable tienen su
propio back-off).

## Eventos de provider inválidos

Un evento que rompe el contrato normalizado (no es un objeto, un `kind` que no
es string, un mensaje sin `chatId`, `ref`, `senderId`, `type` o `body`…)
fallaba dentro del pipeline con un `TypeError` genérico. Ahora se descarta y se
informa una sola vez en el evento `'error'` como `InvalidProviderEventError`,
que nombra el provider y el campo roto (nunca ids ni contenido de mensajes). Un
evento cuyo `kind` es un string que este core no conoce (un provider más nuevo)
no es un error: se ignora, con una línea de log en debug, para que los providers
puedan añadir tipos de evento sin romper cores anteriores.

## Un hook que llama a `next()` dos veces

Un hook `before` que llamaba a `next()` dos veces lanzaba
`next() called multiple times` y el mensaje se perdía. Ahora se conserva el
primer despacho (el resto de la cadena corre una vez y cada `next()` posterior
devuelve la misma promesa) y el mal uso se informa en el evento `'error'`.

## Los ids de los logs van hasheados

Las líneas de log del propio bot (descartes por listas de acceso y handoff,
"dispatching message", fallos del indicador de escritura, claves de
conversación) llevaban los ids de chat y de remitente tal cual: teléfonos o
correos. Ahora pasan por una política de ids, `BotConfig.logIds`:

- `'hash'` (por defecto): HMAC-SHA256 de 16 caracteres, estable dentro del
  proceso. Con trazas activas es el mismo hash que el de los spans (se reutiliza
  `telemetry.idKey`).
- `'raw'`: los ids tal cual, para depurar en local.
- `'omit'`: sin ids.

## Logs append dañados

Con `appendLog`, una línea mala al **final** de `<archivo>.log` es una escritura
cortada y se recorta, como antes. Una línea mala en **medio** se trataba igual,
y se perdían en silencio todas las entradas posteriores. `FileDurability.open()`
y `SharedFileEventJournal.open()` rechazan ahora ese log con un error de `code`
`'APPEND_LOG_CORRUPT'` (indica el archivo, la línea y el byte) y no lo tocan:
restáuralo desde una copia o córtalo en esa línea.

Los snapshots pueden forzarse a disco antes de reemplazar al anterior:
`FileDurability.open(ruta, { fsync: true })`, y la misma opción `fsync` en
`FileEventJournal` y `SharedFileEventJournal`.

## `MemoryCoordinationHub` expulsa chats inactivos

El hub de coordinación en proceso guardaba el estado de cada chat para siempre.
Ahora expulsa los chats inactivos por encima de `maxIdleKeys` (por defecto
10.000; `Infinity` los conserva todos). Los fences siguen siendo monótonos tras
una expulsión; un chat recreado informa `previousHolder: null`, así que su
siguiente titular refresca su estado. El chat que se está usando nunca se
expulsa, así que `maxIdleKeys: 0` conserva solo el último chat inactivo.

## Reintentos de `broadcast` {#reintentos-de-broadcast}

`bot.broadcast(ids, contenido, { maxRetries })` pasa a ser `{ retries }`, con el
mismo significado (reintentos después del primer envío de cada chat).
`maxRetries` sigue funcionando y queda obsoleto. `autoReconnect.maxRetries` del
manager se renombra igual.

## Las etiquetas de WhatsApp Flows pasan a inglés

`@botmesh/meta` construye el WhatsApp Flow nativo de un formulario con
`toFlowJson()` y `provider.publishForm()`. La etiqueta del botón de envío queda
fijada en el Flow publicado, y su valor por defecto seguía en español
(`'Enviar'`) mientras el core pasaba a inglés. Ahora usa el locale por defecto del
core: `'Submit'`. Los textos de reserva que se usan al enviar una definición sin
contexto de bot (`'Open form'`, `'Fill in the form.'`) también. Para conservar
las etiquetas en español:

```ts
toFlowJson(definicion, { lang: 'es' })
provider.publishForm(definicion, { flowJson: { lang: 'es' } })
```

Un `submitLabel` en la definición siempre manda. Los formularios que envía un bot
ya usan el `ctx.lang` del usuario para el botón y el cuerpo.

## Presencia sin conexión

`ctx.typing()`, `ctx.recording()`, `ctx.markRead()` y el indicador automático de
escritura son señales de mejor esfuerzo. Antes se comportaban distinto en cada canal
mientras el transporte estaba caído: Baileys no hacía nada, los canales REST llamaban
igual a la API y algunos rechazaban. Ahora hay una sola regla (la sección "PRESENCE
WHILE DISCONNECTED" del contrato `IProvider`): mientras el último estado de conexión
del provider no es `'ready'`, o una vez parado el bot, la señal se omite sin error, se
registra en debug y se cuenta en `metrics().presenceSkipped`
(`botmesh_presence_skipped_total` en `toPrometheus()`). Los 13 providers integrados la
cumplen también si se les llama directamente. Ya conectado, un fallo del transporte
sigue rechazando como antes.

Un provider propio debe resolver `typing()` y `markRead()` sin tocar su transporte
mientras no está conectado; `assertPresenceWhileDisconnected()` de
`@botmesh/core/testing` lo comprueba. Un provider que nunca emite un evento de conexión
no queda limitado por el bot mientras este corre.

## Evento `'stopping'` {#evento-stopping}

`bot.stop()` sobre un bot en marcha emite ahora `'stopping'` justo después de cerrar la
entrada, antes del drenado y antes de parar el transporte; `'stopped'` sigue llegando
al final. Cancela ahí el trabajo largo (llamadas al modelo, descargas): el transporte
todavía puede entregar lo que está en curso. `@botmesh/ai` aborta sus llamadas al
modelo en `'stopping'` (antes esperaba a `'stopped'`, con el transporte ya parado).

## Los flujos persistentes hacen checkpoint al empezar

Un flujo `.persistent()` escribe ahora su checkpoint al empezar (paso 0) además de
después de cada paso, así que un reinicio mientras espera su primer paso, normalmente
un flujo que empieza con `.ask()`, lo retoma ahí y vuelve a preguntar. Antes se perdía
salvo con durabilidad o coordinación. El coste es una escritura de checkpoint más por
entrada al flujo.

## Mensajes de error sin ids de chat

Los mensajes por defecto de `OutsideSessionWindowError` y `RecipientUnreachableError`
ya no incluyen el id del chat (acababa en los logs): dicen `Outside the session window;
a template is required` y `Recipient unreachable`. El id sigue en `error.chatId`, y un
mensaje que pase el provider se conserva tal cual.

## Arreglos menores

- `ctx.delete()` antes de `start()` o después de `stop()` rechaza con
  `BotNotRunningError` (`operation: 'delete'`), como los envíos.
- `IMessageContext.acknowledge` se tipa como método obligatorio: siempre existió en
  ejecución (sin interacción no hace nada). `ctx.acknowledge?.()` sigue compilando.
- Un evento de provider cuyo `kind` es un string que el core no conoce se ignora con
  una línea en debug en vez de informarse como `InvalidProviderEventError`.
- `lang` e `i18n.defaultLocale` pueden nombrar el mismo idioma con distinta precisión
  (`'es'` y `'es-MX'`); la etiqueta más específica queda como predeterminada.
- Con `telemetry.ids: 'raw'` y sin `logIds`, las líneas de log siguen hasheando los ids
  (antes reutilizaban la política cruda de los spans).
- `ChaosProvider.selfId` y `RecordingProvider.selfId` (`@botmesh/core/testing`)
  devuelven `null` en vez de `undefined` cuando el provider envuelto no tiene id
  propio, así implementan `IProvider` con `exactOptionalPropertyTypes`.
- En el outbox durable, una parte posterior de un texto dividido ya no adelanta a una
  anterior que espera un reintento, y el barrido divide un registro anotado que supera
  el límite de texto del canal (ver [Procesamiento durable](/es/guide/durabilidad)).
