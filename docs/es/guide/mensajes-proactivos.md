# Mensajes proactivos

Casi todo el código de un bot responde a un mensaje. Esta página reúne las
formas en que un bot **escribe primero**: un envío suelto, una difusión, un
flujo iniciado desde código, tareas programadas y seguimientos por
inactividad. Cada sección trae un ejemplo corto y enlaza a la página con todas
las opciones.

| Quieres | Usa |
| --- | --- |
| Enviar un mensaje a un chat | [`bot.send()`](#enviar-a-un-chat) |
| Enviar el mismo mensaje a muchos chats | [`bot.broadcast()`](#difundir-a-muchos-chats) |
| Iniciar un flujo o conversación para alguien que no ha escrito | [`bot.trigger()`](#iniciar-un-flujo-desde-codigo) |
| Ejecutar código según un horario (cron, intervalo, una vez) | [`bot.schedule()`, `bot.every()`, `bot.delay()`](#tareas-programadas) |
| Hacer seguimiento cuando un chat se queda en silencio | [`bot.onIdle()`](#seguimiento-por-inactividad) |
| Sobrevivir a una caída entre "decidí enviar" y "enviado" | [`bot.enqueue()`](#envios-durables) |

## Enviar a un chat

`bot.send(chatId, contenido, opciones?)` envía a cualquier chat desde
cualquier sitio (una tarea, un webhook, un panel de administración). Un string
se envía como texto; lo demás es la unión de contenido neutral
(`{ kind, ... }`). Pasa por los hooks `before('send')` / `after('send')` igual
que una respuesta desde un handler.

```ts
await bot.send(chatId, '🌅 ¡Buenos días!')
await bot.send(chatId, { kind: 'image', media: { url }, caption: 'El menú de hoy' })
```

Resuelve un `SentMessage` (`{ ref, id, chatId, raw, skipped? }`); `skipped`
viene cuando un hook `before('send')` abortó el envío. `chatId` es el id opaco
que usa el canal (guarda el `ctx.from` de un mensaje anterior). Ver
[Enviar fuera de un handler](./mensajes#enviar-fuera-de-un-handler).

## Difundir a muchos chats

`bot.broadcast(chatIds, contenido, opciones?)` envía un mismo contenido a
muchos chats por lotes, sin retener las colas de entrada de cada chat:

```ts
const res = await bot.broadcast(chatIds, '🎉 ¡Nueva promo!', { batchSize: 10, delayBetween: '2s' })
// → { total, sent, failed, skipped, errors, messages, cancelled, pending }
```

Un `RateLimitedError` pausa toda la difusión y reintenta ese chat; los demás
errores se anotan y la difusión sigue. Desde un handler, lánzala con
`void bot.broadcast(...)`. Todas las opciones (`concurrency`, `retries`,
`signal`, `onProgress`, `onFail`…) están en
[Difusiones](./mensajes#difusiones-broadcast).

## Iniciar un flujo desde código

`bot.trigger(nombre, { chatId, userId?, isGroup?, data?, ifActive?, body? })`
inicia un flujo registrado o una `bot.conversation` sin mensaje de entrada.
Las respuestas del usuario le llegan después como siempre. `data` siembra
`c.state`:

```ts
const recordatorio = flow('recordatorio')
  .say((_ctx, c) => `Recordatorio: tu cita es a las ${c.state.hora}.`)
  .ask('Responde *sí* para confirmar.', 'respuesta')
bot.registerFlow(recordatorio)

const result = await bot.trigger('recordatorio', { chatId, data: { hora: '15:00' } })
if (!result.started) bot.logger.info({ reason: result.reason }, 'recordatorio no iniciado')
```

Pasa por las listas de acceso, el gate de handoff y la cola FIFO del chat, y
resuelve `{ started, name, chatId, userId, reason? }` en cuanto la
conversación entra (no cuando termina). A un sujeto que ya tiene una
conversación no se le toca (`reason: 'busy'`) salvo que pases
`ifActive: 'replace'`. `bot.triggerFlow()` es un wrapper deprecado sobre él.
Detalles en [Iniciar un flujo desde código](./mensajes#iniciar-un-flujo-desde-codigo).

## Tareas programadas

El bot trae un scheduler para código que corre según un horario. Cada llamada
devuelve una `ScheduledTask` cuyo `cancel()` la detiene:

```ts
bot.schedule('0 9 * * 1-5', { timeZone: 'America/Bogota' }, async () => {
  for (const cita of await db.citasDeHoy()) {
    await bot.trigger('recordatorio', { chatId: cita.chatId, data: { hora: cita.hora } })
  }
})

const sync = bot.every('10m', () => sincronizarPedidos())   // intervalo: una duración o ms
bot.delay('30s', () => bot.send(chatAdmin, 'Bot arriba'))   // una vez
sync.cancel()
```

Estas tareas viven en memoria: un reinicio las olvida. Dale un `id` a una tarea
para hacerla **durable** (calendario guardado, política de ejecuciones
perdidas, una réplica por ejecución). Ver
[Scheduler y tareas durables](./scheduler).

## Seguimiento por inactividad

`bot.onIdle(duración, handler)` corre una vez cuando un chat se queda en
silencio durante `duración` tras su último mensaje procesado; `ctx` es el
contexto de ese mensaje, así que `ctx.reply()` responde en el chat correcto:

```ts
const off = bot.onIdle('10m', async (ctx) => {
  await ctx.reply('¿Sigues ahí? 👀')
})
// off() deja de vigilar; bot.clearIdle(chatId) cancela el temporizador pendiente de un chat
```

Un mensaje nuevo del chat lo rearma, y nunca salta en un chat en handoff
humano. Para un timeout **dentro** de una conversación (un `ask` que el
usuario no responde), usa `c.idle()` o `.timeout()`. Ver
[`bot.onIdle()`: inactividad por chat](./flujos#bot-onidle-inactividad-por-chat).

## Envíos durables

Con `BotConfig.durability` activo, `bot.enqueue(chatId, contenido, opciones?)`
anota el envío en el journal y devuelve su clave de outbox al momento; un
barrido en segundo plano lo entrega con reintentos y cola de muertos. Una
`idempotencyKey` que ya existe no hace nada, así que una tarea que puede
correr dos veces es segura:

```ts
await bot.enqueue(chatId, 'Tu cita es mañana a las 9', {
  idempotencyKey: `recordatorio:${cita.id}`,
})
```

Ver [Reintentos, envíos diferidos y la cola de muertos](./durabilidad#reintentos-envios-diferidos-y-la-cola-de-muertos).

## Límites de los canales

No todos los canales dejan que el bot escriba primero:

- **WhatsApp Cloud API, Twilio y Gupshup (WhatsApp):** fuera de la ventana de
  atención de 24 horas un mensaje libre rechaza con
  `OutsideSessionWindowError`; reabre el chat con una plantilla aprobada. Ver
  [Ventana de 24 h y costos](./ventana-24h).
- **Messenger:** pasada la ventana de 24 horas, envía con una etiqueta de
  mensaje (ver [Messenger](./messenger)).
- **TikTok** (experimental): el bot no puede iniciar una conversación.
- **Baileys (WhatsApp Web):** los envíos masivos no solicitados son la forma
  más rápida de que bloqueen un número. Deja activo el
  [rate limiter](./rate-limiting) y espacia las difusiones con `delayBetween`.

## Siguientes pasos

- [Mensajes y media](./mensajes): todos los tipos de contenido que acepta `bot.send()`.
- [Scheduler y tareas durables](./scheduler): sintaxis cron, zonas horarias y tareas durables.
- [Procesamiento durable](./durabilidad): los journals de inbox/outbox detrás de `bot.enqueue()`.
- [Ejemplo: bot de recordatorios](/es/ejemplos/recordatorios) y [resumen diario programado](/es/ejemplos/resumen-diario).
