# Flujos conversacionales

Los flujos son conversaciones multi-paso. `flow(trigger)` te da un DSL
encadenable que compila a una conversación async real por debajo: el bot
pregunta, el usuario responde, el bot guarda la respuesta en `c.state` y
continúa.

## Flujo básico

```ts
import { flow } from '@botmesh/core'

const saludo = flow('hola')
  .ask('👋 ¡Hola! ¿Cómo te llamas?', 'name')
  .say((_ctx, c) => `¡Mucho gusto, ${c.state.name}!`)

bot.use(saludo)
```

Cuando alguien escribe "hola", el bot pide el nombre, espera la respuesta, la
guarda en `c.state.name` y lo saluda. `flow()` acepta cualquier
[trigger](./conceptos#when-respuestas-simples): un texto, una lista, una regex,
un predicado, o `WELCOME`, `IMAGE` y los demás
[triggers especiales](./triggers).

## Registrar e iniciar flujos

| Llamada | Qué hace |
| --- | --- |
| `bot.use(flujo)` / `bot.use([a, b])` | Registra flujos; cada uno arranca cuando coincide su trigger. |
| `bot.registerFlow(flujo)` | Igual, y devuelve el id del flujo (para iniciarlo o reemplazarlo después). |
| `bot.trigger(id, { chatId })` | Inicia un flujo desde código: una tarea programada, un webhook, una acción de administración. Ver [Iniciar un flujo desde código](./mensajes#iniciar-un-flujo-desde-codigo). |
| `bot.abortConversation(ctx)` | Cancela la conversación en curso de ese usuario (lo que hace `/reset`). Acepta un `ctx` o `{ from, sender, isGroup }`. |

El id de un flujo es su trigger de texto, normalizado (`flow('Hola')` es
`'hola'`; una lista usa su primer texto). Un flujo construido con una regex, un
predicado o un trigger especial necesita `.id('nombre')` para iniciarlo por
nombre, usarlo como destino de `goto` o hacerlo `.persistent()`.

Mientras un usuario está dentro de un flujo, sus mensajes van al flujo, no a
otros triggers. Los comandos siguen ganando, así que `/reset` (con
[`slashCommandsPlugin`](./plugins#incluido-slashcommands)) siempre saca al
usuario.

## Métodos del DSL

### say — enviar un mensaje

```ts
flow('x').say('texto')                               // texto fijo
flow('x').say((_ctx, c) => `Hola ${c.state.name}`)    // dinámico, lee c.state
flow('x').say('Pensando…').say('¡Listo!', { delay: '2s' }) // pausa 2 s antes de enviar
```

`{ delay }` (`'500ms'`, `'2s'`, `'1m'` o milisegundos) también funciona en
`ask`, `choose` (cuarto argumento, después de la clave de estado:
`.choose(prompt, opciones, 'choice', { delay: '1s' })`) y `media`. Es una pausa
antes del paso, independiente del
[indicador de escritura](./mensajes#indicador-de-escritura-y-pausas) que
`BotConfig.typing` añade a cada `.say`. Para pausar entre pasos sin enviar nada, usa
`.delay('3s')`. Un delay inválido, o mayor de lo que admite un timer de
Node (2^31 − 1 ms, unos 24 días), lanza un error al construir el flow.
Terminar la conversación (`/reset`, un reemplazo, `bot.stop()`) cancela el
delay pendiente.

### ask — enviar un mensaje y esperar la respuesta {#ask}

```ts
flow('x').ask('¿Cómo te llamas?', 'name')  // guarda la respuesta en c.state.name

flow('x').ask('¿Email?', 'email', {
  validate: (body) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body) ? true : '❌ Email no válido, inténtalo de nuevo',
  maxAttempts: 3,
  timeout: '2m',
})
```

Si `validate` devuelve un texto de error, el bot lo envía y vuelve a
preguntar. Las opciones son las mismas en todas las esperas (`.ask()`,
`.choose()`, y `c.ask()`, `c.waitText()`, `c.choose()`… en conversaciones):

| Opción | Por defecto | Qué hace |
| --- | --- | --- |
| `validate(body, msg)` | ninguna | Devuelve `true` para aceptar, o un texto de error que se envía antes de volver a preguntar. Puede ser async. |
| `schema` | ninguna | Un schema compatible con zod; se guarda el valor **parseado** (ver abajo). |
| `maxAttempts` | `3` | Respuestas que acepta la espera en total, la primera incluida. `Infinity` = sin límite. |
| `retries` | | El mismo límite contado después de la primera respuesta: `retries: 2` es `maxAttempts: 3`. Pasa solo uno de los dos. |
| `otherwise` | el mensaje de `validate` o del schema | Texto que se envía cuando se rechaza una respuesta sin mensaje propio. |
| `timeout` | `conversation.timeout` (`'5m'`) | Cuánto esperar esta respuesta. |
| `filter(msg)` | ninguna | Un mensaje que no pasa no lo toma la espera: sigue hacia los demás handlers y no gasta intento. |
| `delay` | ninguna | Pausa antes de enviar la pregunta (solo en pasos de flujo). |

Cuando se rechaza el último intento, la conversación termina con
`retriesMessage` ("❌ Demasiados intentos. Conversación terminada." con
`lang: 'es'`; "❌ Too many attempts. Conversation ended." con el idioma por
defecto, inglés).

#### Validación con schema (compatible con zod)

`schema` acepta cualquier objeto con un método `safeParse()`: zod,
adaptadores de valibot o tu propio validador. El core no depende de zod. En
`c.state` se guarda el valor **parseado**, y una respuesta rechazada vuelve
a preguntar con `otherwise` o, si no está definido, con el mensaje del
primer issue del schema (o con el mensaje integrado y traducible
`core.wait.invalid` si el schema no da ninguno, ver
[i18n](./i18n#mensajes-internos)):

```ts
import { z } from 'zod'

flow('registro')
  .ask('¿Cuántos años tienes?', 'edad', { schema: z.coerce.number().min(18, 'Debes ser mayor de edad') })
  .say((_ctx, c) => `El año que viene tendrás ${c.state.edad + 1}`)   // c.state.edad: number
```

`schema` corre después de `validate` y comparte su presupuesto de
`maxAttempts`. También funciona en conversaciones: `await c.ask(q, { schema })`
y `await c.waitText({ schema })` resuelven con el valor parseado.

### do — ejecutar una acción, sin mensaje

```ts
flow('x').do((ctx, c) => {
  c.state.registeredAt = Date.now()
})
```

### media — enviar media

```ts
flow('x')
  .media('image', 'https://picsum.photos/400/300', 'Nuestro menú')
  .media('document', './factura.pdf', 'Tu factura', { filename: 'factura.pdf' })
  .media('voice', './saludo.ogg')
  .media('location', { lat: 4.71, lng: -74.07 }, 'Bogotá')
```

`kind` es `image`, `video`, `audio`, `voice`, `document`, `sticker` o
`location`. La fuente puede ser una URL, una ruta, un `Buffer` o una
función `(ctx, c) => fuente` calculada en tiempo de ejecución. El cuarto
argumento acepta `delay` y opciones por tipo (`filename`, `ptv`,
`gifPlayback`, `pack`, `author`).

### choose — branching (menú numerado)

```ts
flow('confirmar')
  .choose('¿Confirmas tu pedido?', { si: 'Sí', no: 'No' })
  .say((_ctx, c) => c.state.choice === 'si' ? '✅ Confirmado' : '❌ Cancelado')
```

`choose` envía un menú numerado construido a partir de `options`
(`Record<string, string>`, key → label) y guarda la **key** elegida en
`c.state.choice` — o en la key que le pases como tercer argumento:
`.choose(prompt, options, 'answer')`.

Cada opción puede en cambio llevar un sub-flow `then` que se ejecuta justo
después de elegirla; el control vuelve al flow padre después:

```ts
flow('menu')
  .choose('¿Qué te interesa?', {
    ofertas: { label: 'Ofertas 🏷️', then: (_ctx, c) => { c.state.interes = 'ofertas' } },
    soporte: { label: 'Soporte 🛠️', then: (_ctx, c) => { c.state.interes = 'soporte' } },
  })
  .say((_ctx, c) => `Entendido: ${c.state.interes}`)
```

`then` también puede ser un flow completo (se ejecuta en línea y vuelve,
como `.use()` más abajo). Una opción con `goto` sale del flow actual hacia
otra conversación; así se construye una opción de "volver al menú
principal":

```ts
const menu = flow('menu').choose('Menú principal', { pedidos: 'Pedidos', ayuda: 'Ayuda' })

flow('ayuda').choose('Temas de ayuda', {
  envios: { label: 'Envíos', then: flow('envios').say('Enviamos en 48 h') },
  volver: { label: '⬅️ Volver', goto: menu },
})
```

### timeout — expiración por inactividad

```ts
flow('soporte')
  .timeout('60s')
  .ask('Describe tu problema', 'problema')
```

`.timeout()` solo define la duración de espera — no recibe un argumento de
mensaje. El texto que se envía cuando expira se configura una sola vez, de
forma global, en el bot:

```ts
const bot = new Bot({
  provider: new BaileysProvider({ session: 'mi-bot' }),
  lang: 'es',
  conversation: { timeoutMessage: '⏰ La sesión expiró por inactividad.' },
})
```

Un sub-flujo `then:` usa su propio `.timeout()`; **no** hereda el del
flujo padre. Si no tiene, se aplica el `conversation.timeout` del bot (o el
valor por defecto de 5 minutos).

### goto — saltar a otro flow

```ts
flow('a').say('Te redirijo...').goto('b')
```

El destino también tiene que estar registrado (`bot.use(flow('b')...)` o
`bot.conversation('b', ...)`); `bot.lint()` avisa de un `goto` a un flujo
inexistente con `goto-target-missing`.

### use — ejecutar un sub-flow y volver

```ts
const direccion = flow('direccion').ask('¿Calle?', 'calle').ask('¿Ciudad?', 'ciudad')

flow('pedido')
  .say('Datos de envío')
  .use(direccion)
  .say((_ctx, c) => `Envío a ${c.state.calle}, ${c.state.ciudad}`)
```

`.use(subFlow)` ejecuta otro flow en línea y luego sigue con el paso
siguiente. El sub-flow comparte `c.state`, así que lo que captura se ve en
el padre (y con tipos, ver [Estado tipado](#estado-tipado)). El sub-flow se
copia al llamar a `.use()`; los cambios posteriores a su builder no afectan
al padre. Un `c.retry()` en un paso del padre después de `.use()` vuelve a
ejecutar el sub-flow cuando su última espera estaba ahí.

### guard — detener si no se cumple una condición

```ts
flow('admin')
  .guard((ctx) => admins.includes(ctx.sender), '⛔ Este menú es solo para admins')
  .guard(() => esHorarioLaboral(), { redirect: 'fuera-de-horario' })
  .say('Menú de admin')
```

Si el predicado (síncrono o async) devuelve un valor falsy, el flow se
detiene: con un mensaje (un string o `(ctx, c) => string`) lo envía y termina
la conversación; sin mensaje termina en silencio; con `{ redirect, message? }`
envía el mensaje (si lo hay) y salta a otra conversación como `goto` (también
acepta un `FlowBuilder` como destino).
`bot.lint()` revisa los destinos de `redirect` igual que los de `goto`.

### persistent — sobrevive reinicios

```ts
flow('registrar').persistent().ask('¿Nombre?', 'name').say('Listo')
```

`.persistent()` hace un checkpoint al empezar el flow y después de cada paso,
así que un reinicio mientras espera, incluso en su primer `.ask()`, lo retoma
ahí (la pregunta pendiente se vuelve a hacer). Eso solo sobrevive a un
**reinicio del proceso** si el store tiene un archivo detrás:

```ts
const bot = new Bot({
  provider: new BaileysProvider({ session: 'mi-bot' }),
  lang: 'es',
  store: new MemoryStore({ file: './store.json' }), // o un store real — ver la guía de Store
})
```

Un flow necesita un id estable para poder hacer checkpoint. Un trigger de
tipo string ya provee uno; si construiste el flow con un trigger de
regex/predicado, dale un id explícito con `.id('registrar')`.

### scope — restringir a dm / group / all

```ts
flow('soporte').scope('dm').ask('Describe tu problema', 'problema')
```

### form — varios campos tipados en un paso

`.form(definicion, opts)` recoge campos de texto, número, email, fecha, selección,
selección múltiple y opt-in con validación. En la Cloud API de WhatsApp se envía
como un WhatsApp Flow nativo; en el resto, el bot pregunta campo por campo. Más
en [Formularios (WhatsApp Flows)](./formularios).

## `c.state` — memoria entre pasos

`c.state` es un objeto plano y mutable, con alcance al flow en ejecución.
`.ask` y `.choose` escriben en él automáticamente; `.do` y la forma función
de `.say` lo leen y escriben directamente:

```ts
flow('x')
  .ask('¿Nombre?', 'name')
  .do((_ctx, c) => { c.state.name = c.state.name.trim() })
  .say((_ctx, c) => `Hola ${c.state.name}`)
```

### Estado tipado

`.ask()`, `.choose()` y `.use()` añaden al tipo del flow las keys que
capturan, así que `c.state` queda tipado sin casts. Con `schema`, la key
toma el tipo de salida del schema; sin él es `string`, y `.choose()` da la
unión de las keys de las opciones. Declara de antemano el estado que el
flow espera con `flow<S>()`, y obtén el tipo de un builder con
`FlowStateOf<typeof f>`:

```ts
const f = flow<{ plan: 'free' | 'pro' }>('alta')
  .ask('¿Edad?', 'edad', { schema: z.coerce.number() })
  .choose('¿Cómo pagas?', { tarjeta: 'Tarjeta', efectivo: 'Efectivo' }, 'pago')
  .do((_ctx, c) => {
    c.state.edad   // number
    c.state.pago   // 'tarjeta' | 'efectivo'
    c.state.plan   // 'free' | 'pro'
  })
```

Una key que no es un literal de string no se puede seguir; esos valores
quedan accesibles como `unknown`.

## Ejemplo completo: registro

```ts
const registro = flow('registrar')
  .say('📝 *Vamos a registrarte*')
  .ask('¿Nombre?', 'name')
  .ask('¿Email?', 'email', {
    validate: (body) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body) ? true : '❌ Email no válido',
  })
  .say((_ctx, c) => `✅ ${c.state.name} <${c.state.email}>`)

bot.use(registro)
```

## Más allá del DSL

Para control de flujo arbitrario (bucles, ramas propias, llamar a una API
externa a mitad de la conversación) escribe la conversación como una función
async. Los flujos construidos con `flow()` compilan exactamente a este
runtime.

```ts
bot.conversation('quiz', async (c, ctx) => {
  let aciertos = 0
  for (const [pregunta, respuesta] of [['¿2 + 2?', '4'], ['¿Capital de Francia?', 'paris']]) {
    const r = await c.ask(pregunta, { timeout: '1m' })
    if (r.trim().toLowerCase() === respuesta) aciertos++
  }
  await ctx.reply(`Puntuación: ${aciertos}/2`)
}, { trigger: 'quiz' })
```

Sin `{ trigger }`, iníciala con `bot.trigger('quiz', { chatId })` o con
`c.goto('quiz')` desde otra conversación. El objeto `c`:

| Miembro | Qué hace |
| --- | --- |
| `c.ask(texto, opts?)` | Envía `texto` y espera una respuesta de texto. Resuelve con la respuesta (el valor parseado con `schema`). Pulsar un botón o una fila de lista nativos cuenta como respuesta: su texto es el id del botón o el título elegido (`ctx.body`). |
| `c.waitText(opts?)` | Espera un mensaje de texto (o la pulsación de un botón o lista, como `ask`), sin pregunta. |
| `c.choose(pregunta, opciones, opts?)` | Envía un menú numerado y resuelve con la clave elegida. |
| `c.waitMedia(tipos?, opts?)` | Espera media y resuelve con el mensaje. Por defecto `image`, `video`, `audio`, `document` o `sticker`; las notas de voz solo si las pides (`['voice']`). Descarga los bytes con [`loadMediaOf()`](./mensajes#acceder-al-contenido-del-media). |
| `c.waitLocation(opts?)` | Espera una ubicación compartida y resuelve con su `InboundLocation` (ver [Recibir una ubicación](./mensajes#recibir-una-ubicacion)). |
| `c.waitAny(opts?)` | Espera cualquier mensaje. |
| `c.say(texto)` | Envía texto (igual que `ctx.reply`, tipado para la conversación). |
| `c.state` | Objeto plano que dura toda la conversación (se persiste en flujos `.persistent()`). |
| `c.retry(mensaje?)` | Repite la última espera. Ver [abajo](#c-retry-repetir-la-ultima-espera). |
| `c.idle(duración, fn)` / `c.idleClear()` | Vigilante de inactividad. Ver [abajo](#c-idle-inactividad-dentro-de-una-conversacion). |
| `c.goto(nombre, args?)` | Sale de esta conversación e inicia otra. |
| `c.end(despedida?)` | Termina la conversación, opcionalmente con un último mensaje. |
| `c.t(clave, params?)`, `c.lang` | Traduce en el idioma actual del usuario. Ver [i18n](./i18n#conversaciones). |

`opts` acepta las [opciones de espera](#ask)
(`timeout`, `validate`, `maxAttempts`, `otherwise`, `filter`, `schema`).

::: warning No captures las señales de control
`c.goto()`, `c.end()`, un timeout y el exceso de intentos funcionan lanzando un
`ConversationError`. Si envuelves esperas en `try/catch`, relánzalo:
`if (e instanceof ConversationError) throw e`.
:::

## `ctx` en `bot.conversation()` es un `MessageContext` completo

El segundo argumento de un handler de `bot.conversation()` es el
`MessageContext` completo, tipado a través de `DefaultTools`: `ctx.tools`
(incluidas augmentations como `ctx.tools.ai` o `ctx.tools.nlu`),
`ctx.user`, `ctx.handoff()`, `ctx.photo`, `ctx.poll`, `ctx.react`,
`ctx.quote`, `ctx.senderInfo`... Sin casts.

```ts
bot.conversation('foto', async (c, ctx) => {
  const img = await c.waitMedia(['image'], { timeout: '2m' })
  await ctx.react('📸')
  await ctx.reply(`Recibida (${img.type})`)
})
```

El tipo del handler es `ConversationHandler<TTools = DefaultTools>`. En el DSL (`flow().do((ctx, c) => ...)`) `ctx` sigue
siendo un `RuntimeMessage`; ahí usa `userOf(ctx)` y `bot.handoff(ctx.from)`.

## `c.retry()`: repetir la última espera

`c.retry(message?)` repite la espera más reciente (`ask`, `waitText`,
`waitMedia`, `waitLocation`, `choose`, `waitAny`) con las mismas opciones (`validate`,
`filter`, `timeout`, `otherwise`, `maxAttempts`). Antes de esperar reenvía la
pregunta del `ask` o el menú del `choose`, o `message` en su lugar. En
`choose`, `message` solo reemplaza el encabezado; las opciones numeradas se
mantienen. `waitText`/`waitMedia`/`waitLocation`/`waitAny` no tienen pregunta, así que solo
envían `message` si lo pasas. `c.retry('')` vuelve a esperar sin enviar
nada.

En una conversación async devuelve el valor nuevo:

```ts
bot.conversation('ahorcado', async (c, ctx) => {
  let letra = await c.ask('Escribe una letra')
  while (letra.length !== 1) letra = await c.retry('❌ Solo una letra')
  await ctx.reply(`✅ ${letra}`)
})
```

Para `waitMedia`/`waitAny`, tipa el valor: `await c.retry<RuntimeMessage>('Envía otra foto')`
(`c.retry<InboundLocation>()` después de `waitLocation`).

En un **paso de flujo** (`.do()` o una acción `then` de `.choose()`) cuya
última espera es de un paso anterior, `c.retry()` rebobina el flujo hasta
ese paso: lo vuelve a preguntar (con `message` en lugar de la pregunta, si
lo pasas), guarda la respuesta nueva en su clave de estado y vuelve a
ejecutar los pasos siguientes, incluido el `.do()` que lo llamó. Lanza una
señal de control síncrona, así que el código posterior del paso no corre
(como con `c.end()`):

```ts
flow('juego')
  .ask('Escribe una letra', 'letra')
  .do((_ctx, c) => {
    if (String(c.state.letra).length !== 1) c.retry('❌ Solo una letra')
  })
  .say((_ctx, c) => `✅ ${c.state.letra}`)
```

- Funciona en sub-flujos (`then: subFlow`, `.use(subFlow)`) y en flujos `.persistent()`
  reanudados tras un reinicio. Si la espera se hizo en el mismo `.do()`
  (`await c.waitText()`), reintenta en el sitio.
- **Límite:** cada `c.retry()` cuenta como un intento inválido de esa
  espera, sumado a los rechazos de `validate`. Al llegar a `maxAttempts` (por
  defecto 3) se lanza `RetriesExceeded` y la conversación termina con
  `retriesMessage`. Cada espera nueva empieza en cero. Para reintentos
  ilimitados usa `maxAttempts: Infinity`.
- Sin una espera previa falla con `RetryUnavailableError` (va al evento
  `'error'` y se envía `errorMessage`).
- Haz siempre `await` (o `return`). Una conversación tiene un solo hueco de
  espera pendiente: una espera nueva iniciada mientras un retry sin `await`
  sigue esperando falla con `ConcurrentWaitError`.
- No lo llames dentro de `validate` (ahí devuelve un string de error). Si
  envuelves un paso en `try/catch`, relanza `ConversationError`
  (`if (e instanceof ConversationError) throw e`).

## `c.idle()`: inactividad dentro de una conversación

```ts
bot.conversation('juego', async (c, ctx) => {
  c.idle('2m', async () => {
    await ctx.reply('⏰ Te desconecté por inactividad')
    c.end('👋 ¡Hasta luego!')          // termina la conversación (envía la despedida)
  })
  await ctx.reply('Escribe una letra')
  const letra = await c.waitText({ timeout: '10m' })
  c.idleClear()                         // lo desarma cuando respondió
})
```

- El callback corre una vez cuando pasa `duración` (`'30s'`, `'2m'`, `'1h'`,
  `'1d'`, `'10 minutes'` o ms, hasta unos 24,8 días) sin mensajes del
  usuario de la conversación. Cada mensaje entrante lo reprograma, aunque
  la espera pendiente lo filtre; tras dispararse, el siguiente mensaje lo
  vuelve a armar.
- Llamar otra vez a `c.idle()` reemplaza el anterior. Se desarma al
  terminar la conversación, con `/reset` o `bot.abortConversation`, con
  `goto` y con `bot.stop()`, así que no deja temporizadores colgados.
- Dentro del callback: `c.end(despedida?)` o `c.goto('menu')` terminan o
  redirigen la conversación en la espera pendiente. `c.retry(msg?)` reenvía
  la pregunta pendiente como recordatorio y sigue esperando la misma
  respuesta (cuenta para `maxAttempts`; para un recordatorio que no cuente, usa
  `ctx.reply`). Si no hay espera pendiente no hace nada. El callback no
  puede iniciar esperas nuevas. Otros errores van al evento `'error'` y la
  conversación sigue.
- Es independiente del `timeout` de la espera, que termina la conversación
  con `timeoutMessage`. Funciona en los `.do()` de un flujo y sigue activo
  entre pasos. Los comandos que atiende el dispatcher no cuentan como
  actividad. No se persiste (no sobrevive a un reinicio ni a un `goto`).

## `bot.onIdle()`: inactividad por chat

```ts
bot.onIdle('10m', async (ctx, { chatId, idleMs, lastActivityAt }) => {
  await ctx.reply('¿Sigues ahí? 👀')       // ctx = el último mensaje procesado de ese chat
})
const off = bot.onIdle('1h', (ctx) => bot.send(ctx.from, 'Cerramos tu sesión por inactividad'))
off()                                       // deja de vigilar y cancela sus temporizadores
bot.clearIdle(chatId)                       // cancela los temporizadores de un chat (de todos sin argumento)
```

- Por chat (`ctx.from`); en un grupo cuenta cualquier participante.
- Se dispara una vez por periodo, contado desde el último mensaje entrante
  que el bot terminó de procesar. Cada mensaje nuevo lo reprograma y lo
  vuelve a armar.
- Los mensajes descartados antes de terminar el pipeline (un hook
  `before('message')` que aborta, el filtro `groupMode`) no cuentan como
  actividad.
- `bot.stop()` lo cancela todo; los registros sobreviven a stop/start.
- [Handoff humano](./handoff): los temporizadores de un chat en handoff se
  cancelan y quedan suspendidos (sus mensajes no los rearman) hasta el
  resume, también para los handoffs restaurados del store al arrancar.
- Los errores del handler (síncronos o async) van al evento `'error'` con
  el `ctx`.
- Usa el `Scheduler` del bot. Una duración inválida (≤ 0, no finita o mayor
  que 2^31 − 1 ms) lanza `RangeError`. Dentro de un plugin, pasa el
  unsubscribe devuelto a `ctx.onDispose`.

## Revisar tus flujos

`bot.describe()` dibuja tus flujos como un diagrama Mermaid y `bot.lint()`
avisa de `goto` rotos, pasos inalcanzables, triggers duplicados y más. Ver
[Inspeccionar y validar flujos](./inspeccion-flujos).

## Siguientes pasos

- [Ejemplos de flujos](/es/ejemplos/flujo-registro) — recetas completas
- [Triggers especiales](./triggers) — WELCOME, tipos de mensaje y CALL
- [Hooks](./hooks) — interceptar mensajes
- [Plugins](./plugins) — empaquetar funcionalidad
