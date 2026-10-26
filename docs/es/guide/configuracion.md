# Referencia de configuración

Todo lo que acepta `new Bot(config)`, los eventos que emite el bot, cómo
registra logs y los errores que puedes capturar. Las demás guías explican cada
función; esta página es la tabla de consulta.

```ts
import { Bot, MemoryStore } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

const bot = new Bot({
  provider: new BaileysProvider({ session: 'mi-bot' }), // la única opción obligatoria
  store: new MemoryStore({ file: './store.json' }),
  lang: 'es', // textos internos: 'en' (por defecto) o 'es'
  groupMode: 'mentions',
  conversation: { timeout: '10m' },
  typing: true,
})
```

`new Bot()` valida el objeto completo y lanza un
[`ConfigValidationError`](#errores) que nombra la primera opción incorrecta.

## Opciones de `BotConfig`

### Lo esencial

| Opción | Tipo | Por defecto | Qué hace |
| --- | --- | --- | --- |
| `provider` | `IProvider` | obligatoria | El transporte: `BaileysProvider`, `CloudAPIProvider`, `TelegramProvider`… Ver [Canales](./canales). |
| `store` | `IStore` | `MemoryStore` en memoria | Dónde viven chats, contactos, mensajes, checkpoints de flujos y los datos de `ctx.user`. Ver [Store persistente](./store). |
| `lang` | `string` | `'en'` | Idioma de los textos internos (timeouts, reintentos, comandos slash, formularios) y de `ctx.lang`. `'es'` también viene incluido. No activa la resolución por usuario; ver [i18n](./i18n#un-bot-en-un-solo-idioma-lang). |
| `i18n` | `I18nConfig` | desactivado | Resolución del idioma por usuario: `defaultLocale`, `locales`, `detect`, `providerLanguage`, `userKey`. Ver [i18n](./i18n). |
| `logger` | `LoggerLike` | pino propio en `warn` | Cualquier logger estilo pino. Ver [Logs](#logs). |
| `debug` | `boolean` | `false` | Logger propio en nivel `debug` (se ignora si pasas `logger`). |

### Enrutado y conversaciones

| Opción | Tipo | Por defecto | Qué hace |
| --- | --- | --- | --- |
| `commandPrefix` | `string` | `'/'` | Prefijo que marca un mensaje como comando de `bot.command()`. |
| `groupMode` | `'all' \| 'mentions' \| 'commands'` | `'all'` | Qué mensajes de grupo se enrutan: todos, solo los que mencionan al bot o solo comandos. Los filtrados se guardan igual. |
| `conversationScope` | `'participant' \| 'chat'` | `'participant'` | En grupos, una conversación por participante o una compartida por chat. |
| `conversation.timeout` | duración | `'5m'` | Cuánto dura una espera (`ask`, `choose`, `waitText`…) cuando el paso no fija `timeout`. |
| `conversation.timeoutMessage` | `string` | texto interno `core.conversation.timeout` | Se envía cuando una espera vence. |
| `conversation.retriesMessage` | `string` | texto interno | Se envía cuando una espera agota `maxAttempts`. |
| `conversation.errorMessage` | `string` | texto interno | Se envía cuando un paso de la conversación lanza un error. |
| `conversation.cancelledMessage` | `string` | texto interno | Se envía cuando se cancela una conversación (`/reset`, un reemplazo). |
| `handoff` | `{ allowCommands?, persist? }` | `{ persist: true }` | Handoff humano: comandos que siguen funcionando durante el handoff y si el estado se guarda. Ver [Handoff](./handoff). |
| `dedupe` | `{ size?, ttl? } \| false` | `{ size: 1000 }` | Descarta mensajes entrantes reenviados. Ver [Dedupe de entrada](./conceptos#dedupe-de-entrada). |
| `echoFilter` | `{ size?, ttl? } \| true` | desactivado | Descarta mensajes entrantes que son envíos del propio bot. Ver [Filtro de ecos](./conceptos#filtro-de-ecos). |

Un mensaje en `conversation.*` gana al texto interno traducido; para traducir
los textos internos, ver [Mensajes internos](./i18n#mensajes-internos).

### Envío

| Opción | Tipo | Por defecto | Qué hace |
| --- | --- | --- | --- |
| `typing` | `boolean \| { enabled?, minMs?, maxMs?, charsPerSecond? }` | desactivado | Muestra "escribiendo…" antes de cada texto enviado con `ctx` y con `.say` de los flujos. `true` = `{ minMs: '800ms', maxMs: '3s', charsPerSecond: 20 }`. Ver [Indicador de escritura](./mensajes#indicador-de-escritura-y-pausas). |
| `splitLongText` | `boolean` | `true` | Divide un texto más largo que el límite del canal en varios mensajes (en límites de párrafo, frase o palabra). Con `false` se envía entero y el provider puede rechazarlo con `PayloadTooLargeError`. |
| `rateLimitRetry` | `{ retries?, maxWaitMs? } \| false` | `{ retries: 1, maxWaitMs: '5s' }` | Reintenta en el sitio un envío de `ctx` cuando el transporte responde "límite de envío, reintenta en N s" y N es corto. `retries` cuenta los intentos después del primero. Ver [Rate limiting](./rate-limiting). |
| `rateLimit` | `object` | ninguno | **Obsoleta, se ignora.** El core no dosifica envíos y avisa en el log si la pasas; pasa `rateLimit` al provider (ver [Rate limiting](./rate-limiting)) y usa `rateLimitRetry` para las respuestas limitadas. Se quitará en la próxima major. |

### Identidad y espacio de nombres

Estos ids son el espacio de nombres de todo lo que escribe el bot (filas del
store, datos de usuario, tareas programadas, journals durables, trazas), así
que dos bots pueden compartir una base de datos.

| Opción | Por defecto | Qué es |
| --- | --- | --- |
| `session` | ninguno | Nombre corto del bot. Es el valor por defecto de `botId` y `connectionId`. |
| `tenantId` | `'local'` | Espacio del tenant. |
| `environmentId` | `'default'` | Espacio del entorno (`'prod'`, `'staging'`…). |
| `botId` | `session`, si no el id del provider | Id estable del bot. |
| `connectionId` | `session`, si no `'default'` | Id de la cuenta o conexión del provider. |
| `persistRaw` | `false` | Guarda también el payload nativo del provider. Desactivado para guardar menos datos personales. |

Cambiar cualquiera de ellos más adelante hace que el bot busque en otro
espacio: las filas existentes quedan en el anterior.

### Funciones de producción (opt-in)

Cada una está desactivada hasta que la configuras, y tiene su propia guía.

| Opción | Qué activa | Guía |
| --- | --- | --- |
| `durability` | Journal de entrada y outbox de salida con reintentos y cola de mensajes muertos | [Procesamiento durable](./durabilidad) |
| `coordination` | Varias réplicas compartiendo chats en orden, un líder para las sesiones exclusivas | [Varias réplicas](./replicas) |
| `scheduler` | Store, lease y zona horaria por defecto de las tareas durables | [Scheduler](./scheduler#backends) |
| `telemetry` | Spans al estilo OpenTelemetry por mensaje, envío y tarea | [Trazas](./trazas) |
| `logIds` | Cómo aparecen los ids de chat y remitente en los logs: `'hash'` (por defecto), `'raw'` u `'omit'` | [Logs](#logs) |

`storeConfig` está obsoleta: pasa `store: new MemoryStore({ file, maxMessagesPerChat, autoSaveInterval })`.

## Duraciones

Toda opción de duración acepta un texto o un número de milisegundos. Incluye
todas las opciones cuyo nombre termina en `Ms` (`typing.minMs`,
`coordination.turnWaitMs`, `scheduler.tickMs`, `durability.outbox.backoff.baseMs`…):

| Escribe | Significa |
| --- | --- |
| `500` | 500 ms |
| `'500ms'`, `'30s'`, `'2m'`, `'1h'`, `'1d'`, `'1w'` | las unidades habituales |
| `'30 seconds'`, `'5 minutes'`, `'2 hours'`, `'1 day'` | también los nombres largos (en inglés) |

```ts
const bot = new Bot({
  provider,
  typing: { minMs: '800ms', maxMs: '3s' },
  durability: { pollMs: '1s', outbox: { inlineMaxMs: '15s', backoff: { baseMs: '1s', capMs: '1m' } } },
})
```

Un valor inválido falla al construir el bot y nombra la opción:

```text
ConfigValidationError: Invalid config.durability.pollMs: expected a duration ('500ms', '30s', '10m', '1h') or milliseconds, got string ("soon")
```

`parseDuration('2m')` (de `@botmesh/core`) usa la misma gramática y devuelve
milisegundos.

## Ciclo de vida y eventos

```ts
await bot.start()                 // conecta el transporte; desde aquí se aceptan envíos
await bot.stop({ drain: true })   // termina antes los envíos en curso (`timeout`, por defecto '10s', limita la espera)
```

- Los envíos, ediciones y `ctx.delete()` antes de `start()` o después de
  `stop()` rechazan con `BotNotRunningError`. Un listener de `'ready'` ya
  puede enviar.
- Las llamadas a `start()` y `stop()` se ejecutan de una en una, en orden.
- Las señales de presencia (`ctx.typing()`, `ctx.markRead()`) nunca lanzan
  con el transporte desconectado: se omiten y cuentan en
  `metrics().presenceSkipped`.

Escucha con `bot.on(evento, fn)` (también `bot.once` y `bot.off`):

| Evento | Payload | Cuándo |
| --- | --- | --- |
| `qr` | `string` | Un QR (o código de vinculación) para enlazar la cuenta (Baileys). |
| `connection` | `ConnectionUpdate` | Cambió el estado de conexión del transporte. |
| `ready` | ninguno | El transporte está conectado. |
| `started` / `stopping` / `stopped` | ninguno | Ciclo de vida. `stopping` llega antes del drain: cancela ahí el trabajo largo. |
| `message` | `MessageContext` | Tras cada mensaje procesado, aunque un handler lo haya consumido. |
| `command:unknown` | `{ ctx, command }` | Un `/comando` que nadie registró. |
| `error` | `{ error, ctx? }` | Error de un handler, hook, store o provider. Siempre se emite. |
| `reaction`, `poll`, `call`, `group`, `presence`, `status` | evento del provider | Reacciones, votos, llamadas, cambios de grupo, presencia, acuses de entrega. |
| `handoff` / `resume` | `HandoffEvent` / `ResumeEvent` | Un chat pasó a un humano / volvió al bot. |
| `conversation:started` / `conversation:ended` | datos de la conversación | Ver [Operación](./operations#eventos-de-conversacion). |
| `coordination:*`, `durability:*` | | Solo con esas funciones activas; ver sus guías. |

::: tip Escucha siempre `'error'`
Los errores nunca tumban el proceso, así que sin listener solo quedan en el
log. `bot.on('error', ({ error, ctx }) => ...)` es donde los reportas.
:::

## Logs

`logger` acepta un `LoggerLike`: pino, `console` o cualquier objeto con
`debug`, `info`, `warn` y `error`. Providers y stores aceptan la misma opción
`logger`. Los paquetes siempre lo llaman al estilo pino, así que un logger
propio solo tiene que entender dos formas:

```ts
logger.warn('provider reconnected')                  // un mensaje
logger.error({ err, chatId }, 'dispatch error')      // primero el objeto de contexto, luego el mensaje
```

Un error va siempre bajo la clave `err`, y `child(bindings)` es opcional. Sin
`logger`, el bot usa su propio pino en `warn` (`debug: true` lo baja a
`debug`); `bot.logger` es el logger en uso.

Los ids de chat y remitente son datos personales (teléfonos, emails), así que
las líneas de log del propio bot los hashean por defecto:

| `logIds` | Los logs muestran |
| --- | --- |
| `'hash'` (por defecto) | un HMAC-SHA256 del id, 16 caracteres, estable dentro del proceso (el mismo hash que las trazas) |
| `'raw'` | el id tal cual, para depurar en local |
| `'omit'` | ningún id |

Los cuerpos de los mensajes nunca se registran.

## Errores

Todos se exportan desde `@botmesh/core`. Compruébalos con `instanceof`; la
mayoría lleva además un `code` o `name` estable.

| Error | Cuándo | Qué hacer |
| --- | --- | --- |
| `ConfigValidationError` | `new Bot()` recibió una opción inválida. `field` es la ruta de la opción. | Corrige la opción que nombra el mensaje. |
| `BotNotRunningError` | Un envío, edición o borrado antes de `start()` o después de `stop()` (`code: 'BOT_NOT_RUNNING'`). | Envía después de `start()`, o desde un listener de `'ready'`. |
| `ProviderError` | Base de todos los errores de envío de abajo. | Captúralo para manejar cualquier fallo de envío. |
| `UnsupportedContentError` | El canal no puede enviar ese contenido (sin botones, sin stickers, demasiadas opciones…). | Consulta `ctx.supports()` o envía algo más simple. |
| `RateLimitedError` | La plataforma limitó el envío; `retryAfterMs` cuando se conoce. | Espera; los envíos de `ctx` reintentan solos una vez las esperas cortas. |
| `RecipientUnreachableError` | El chat no existe, bloqueó al bot o no se puede contactar. | Deja de enviar a ese chat. |
| `PayloadTooLargeError` | El mensaje o la media supera el límite de la plataforma. `MediaTooLargeError` es el caso entrante (`maxBytes` de `loadMediaOf`). | Envía menos, o un enlace. |
| `OutsideSessionWindowError` | WhatsApp Cloud API: la ventana de 24 horas está cerrada. | Envía una plantilla. Ver [Ventana de 24 h](./ventana-24h). |
| `MediaUnavailableError` | La media entrante ya no se puede descargar (un mensaje reproducido, un mock sin bytes). | Pide al usuario que la envíe de nuevo. |
| `SendDeferredError` | Outbox durable: el envío no terminó dentro de `inlineMaxMs`; queda en cola y se reintentará. | Nada; escucha `'durability:dead'` para los fallos definitivos. |
| `ConversationError` | Base de las señales de control de conversación: `ConversationTimeout`, `ConversationCancelled`, `RetriesExceeded`, `ConversationEnded`, `ConversationGoto`. | Si envuelves un paso en `try/catch`, relánzala: `if (e instanceof ConversationError) throw e`. |
| `ConcurrentWaitError` | Empezó una segunda espera con otra pendiente (un `c.ask()` o `c.retry()` sin `await`). | Usa `await` en cada espera. |
| `RetryUnavailableError` | `c.retry()` sin una espera previa. | Llámalo después de una espera. |
| `UserDataError` | Ruta, valor, TTL o namespace de `ctx.user` inválido, o un store sin datos de usuario (`code`). | Ver [Errores de datos de usuario](./datos-usuario#errores). |
| `InvalidProviderEventError` | Un provider emitió un evento mal formado; se descartó (se reporta en `'error'`). | Corrige el provider. |
| `LeaseLostError`, `ProviderNotLeaderError`, `CoordinationUnavailableError` | Solo con varias réplicas: se perdió el turno del chat o el liderazgo. | Ver [Varias réplicas](./replicas). |
| `TimeoutError` | Venció un plazo: una llamada a un modelo o herramienta de `@botmesh/ai`, o una espera del kit de tests como `chaos.settle()`. | Reintenta, o sube ese timeout. |

## Siguientes pasos

- [Conceptos básicos](./conceptos): el pipeline de entrada y las piezas del bot
- [Mensajes y media](./mensajes): todo lo que `ctx` puede enviar
- [Operación](./operations): métricas, salud y eventos de conversación
