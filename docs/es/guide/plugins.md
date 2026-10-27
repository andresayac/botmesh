# Plugins

Los plugins son paquetes reutilizables de funcionalidad.

## Usar un plugin

```ts
import { Bot, slashCommandsPlugin } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

const bot = new Bot({ provider: new BaileysProvider({ session: 'mi-bot' }), lang: 'es' })

const unplug = bot.plug(slashCommandsPlugin, {
  greeting: '🤖 ¡Hola! Envía /help para ver mis comandos.',
})

await bot.start()

// más adelante, si necesitas revertir todo lo que registró el plugin:
// unplug()
```

`config` lo tipa el plugin (`definePlugin<MiConfig>()`): una opción
desconocida es un error de compilación, y una configuración declarada con la
interfaz de configuración del plugin se pasa tal cual.

`bot.plug(plugin, config?)` devuelve una función **unplug** (no el bot, así
que las llamadas a `plug()` no se encadenan). Al llamarla, primero ejecuta el
`uninstall(ctx)` del plugin, si lo tiene, y después revierte, de lo más nuevo
a lo más antiguo, lo que el plugin registró vía `ctx.bot`:

- comandos (`command()`), matchers (`when()`, `onMessage()`, `onType()`),
  conversaciones y disparadores de flows (`conversation()`, `use(flow)`);
- hooks (`before()`, `after()`, `onError()`, `hook()`);
- plugins anidados (`ctx.bot.plug()`);
- flows registrados en caliente con `ctx.bot.registerFlow()`, o creados (no
  reemplazados) con `ctx.bot.replaceFlow()`;
- cada callback de `ctx.onDispose(fn)`.

**No** deshace nada más: listeners de eventos (`ctx.bot.on()` / `once()`),
herramientas inyectadas (`ctx.bot.provide()` / `ctx.tools`), mensajes de
idioma (`ctx.bot.locale()`), tareas programadas (`schedule()`, `every()`,
`delay()`), handlers de inactividad (`onIdle()`), un flow que `replaceFlow()`
sobrescribió (no se restaura), el estado de handoff, escrituras en el store ni
timers o conexiones propios. Deshazlos en `ctx.onDispose()` (o en
`uninstall()`). Llamar a unplug dos veces no hace nada. Si `install()` lanza de
forma síncrona, lo que alcanzó a registrar se revierte antes de que el error te
llegue; si devuelve una promesa que rechaza, el rechazo va al evento `'error'`
y no se revierte nada.

### Dependencias entre plugins (`requires`)

Un plugin puede listar por nombre los plugins que necesita. `bot.plug()` los
comprueba antes de ejecutar `install()` y lanza un error descriptivo si falta
alguno:

```ts
const crm = definePlugin({ name: 'crm', version: '1.0.0', requires: ['inbox'], install(ctx) { /* … */ } })

bot.plug(crm)                        // Error: Plugin "crm" requires plugin(s) "inbox", which is not plugged…

const unplugInbox = bot.plug(inbox)  // ok: primero la dependencia...
const unplugCrm = bot.plug(crm)      // ...y después el plugin que la requiere
// plug() devuelve una función unplug, no el bot: una llamada por plugin, sin encadenar
```

La comprobación solo ocurre al enchufar: desenchufar `inbox` después no
desenchufa `crm`. Un plugin anidado dentro de otro (`ctx.bot.plug()` desde
`install()`) puede requerir a su padre.

### Una instancia por nombre (`multiple`)

`bot.plug()` rechaza un plugin cuyo `name` ya está enchufado en el bot, así un
plugin registrado dos veces por error nunca ejecuta sus handlers dos veces:

```ts
const unplug = bot.plug(inbox)
bot.plug(inbox)   // Error: Plugin "inbox" is already plugged on this bot…
unplug()
bot.plug(inbox, { tenant: 'b' })  // vale otra vez: la primera instancia ya no está
```

Un plugin pensado para correr varias veces con configuraciones distintas pone
`multiple: true` en su spec (todas las instancias deben ponerlo). Cada
instancia se desenchufa por separado y cualquiera de ellas cumple `requires`.

### Incluido: slashCommands

Config: `{ greeting?: string; unknownMessage?: string }`. El prefijo de
comandos es una opción del bot (`new Bot({ commandPrefix })`), no del
plugin. Las respuestas son [textos internos](./i18n#mensajes-internos) en el
idioma del bot.

| Comando | Qué hace |
|---|---|
| `/start` | Muestra `greeting`, o la lista de comandos |
| `/help` | Igual que `/start` |
| `/reset` | Cancela la conversación activa y rearma [`WELCOME`](./triggers#welcome), así que el siguiente mensaje vuelve a ser un primer contacto |
| `/cancel` | Solo cancela la conversación activa |
| `/id` | Muestra el id del chat |
| `/ping` | Health check (responde "pong 🏓") |

Los `/comandos` desconocidos reciben automáticamente una respuesta de
"comando desconocido" (`unknownMessage`).

## Crear un plugin

### Plugin simple

```ts
import { definePlugin } from '@botmesh/core'

const loggingPlugin = definePlugin({
  name: 'logging',
  version: '1.0.0',
  description: 'Registra el tipo de cada mensaje',
  install(ctx) {
    // ctx.bot        → la instancia de Bot
    // ctx.logger     → el logger del bot
    // ctx.tools      → registro de herramientas
    // ctx.config     → configuración pasada a plug()
    // ctx.onDispose  → registra lógica de limpieza

    ctx.bot.before('message', async (c, next) => {
      ctx.logger.info({ type: c.type }, '📥 mensaje recibido') // sin ids ni cuerpos en los logs
      await next()
    })
  },
})

bot.plug(loggingPlugin)
```

### Plugin configurable con cleanup

```ts
const rateLimitPlugin = definePlugin({
  name: 'rate-limit',
  version: '1.0.0',
  install(ctx, config: { max?: number; windowMs?: number } = {}) {
    const max = config.max ?? 10
    const windowMs = config.windowMs ?? 60000
    const counts = new Map()

    ctx.bot.before('message', async (c, next) => {
      const now = Date.now()
      let entry = counts.get(c.from)

      if (!entry || entry.resetAt < now) {
        entry = { count: 0, resetAt: now + windowMs }
        counts.set(c.from, entry)
      }

      entry.count++
      if (entry.count > max) {
        await c.reply(`⏳ Espera ${Math.ceil((entry.resetAt - now) / 1000)} s`)
        c.abort()
        return
      }

      await next()
    })

    // se ejecuta cuando el plugin se desinstala (bot.plug() devolvió unplug())
    ctx.onDispose(() => counts.clear())
  },
})

bot.plug(rateLimitPlugin, { max: 20, windowMs: 60000 })
```

## Estructura de un plugin

`definePlugin(spec)` devuelve el spec sin cambios, tipado. Un plugin también
puede ser una función `(config) => spec`.

| Campo | Obligatorio | Qué es |
| --- | --- | --- |
| `name` | sí | Nombre único. Enchufar el mismo nombre dos veces lanza, salvo con `multiple`. |
| `version` | sí | Versión semver del plugin. |
| `description` | no | Descripción para humanos. |
| `requires` | no | Nombres de plugins que deben estar enchufados antes. |
| `multiple` | no | Permite varias instancias en un bot (por defecto `false`). |
| `install(ctx, config)` | sí | Lo registra todo. Debe ser síncrono y no devolver nada (ver abajo). |
| `uninstall(ctx)` | no | Corre primero al desenchufar, antes de la reversión automática. |

El `ctx` que recibe `install`:

| Miembro | Qué es |
| --- | --- |
| `ctx.bot` | El bot, con ámbito del plugin: lo que registras a través de él se deshace al desenchufar. |
| `ctx.logger` | El logger del bot (`LoggerLike`). |
| `ctx.tools` | El registro de [herramientas inyectadas](#compartir-herramientas-inyeccion-de-dependencias). |
| `ctx.config` | La config pasada a `bot.plug()`. |
| `ctx.onDispose(fn)` | Registra limpieza para el momento de desenchufar. |

::: warning `install()` debe ser síncrono y no devolver nada
`bot.plug()` no hace `await` de `install()`. TypeScript rechaza un `install`
async (o uno que devuelva una promesa o cualquier otro valor) en tiempo de
compilación: `PluginSpec.install` devuelve `void | SyncInstallError`, y el
mensaje de error explica el motivo. En JavaScript el bot sigue antes de que un
`install` async termine y su rechazo solo llega al evento `'error'`: no se
revierte nada y el
plugin cuenta como enchufado; la regla de ESLint
[`no-async-plugin-install`](./eslint#botmesh-no-async-plugin-install) cubre ese
caso. Si tu plugin necesita inicialización async (abrir una conexión, cargar
un SDK), mantén `install` síncrono y resuelve de forma perezosa en el primer
uso, reportando los errores de configuración sin tumbar el bot. Así carga
`@botmesh/ai` los SDKs de sus proveedores.
:::

## Compartir herramientas (inyección de dependencias)

Comparte herramientas entre handlers, hooks y plugins sin usar globales.

### El problema que resuelve

```ts
// ❌ Mal: variable global
const db = new Database()

bot.when('visitas', async (ctx) => {
  const user = await db.touch(ctx.from)  // db es global
})
```

```ts
// ✅ Bien: inyectada
bot.provide('db', new Database())

bot.when('visitas', async (ctx) => {
  const user = await ctx.tools.db.touch(ctx.from)  // db está en ctx.tools
})
```

### Cómo funciona

#### 1. Registrar una herramienta

```ts
const db = {
  users: new Map<string, { visits: number }>(),
  async touch(jid: string) {
    const u = this.users.get(jid) ?? { visits: 0 }
    u.visits++
    this.users.set(jid, u)
    return u
  },
}

bot.provide('db', db)
```

`bot.provide(name, value)` devuelve `this`, así que las llamadas se pueden
encadenar:

```ts
bot
  .provide('db', myDatabase)
  .provide('cache', myCache)
```

#### 2. Tiparla

`ctx.tools` se tipa con la interfaz `DefaultTools`, que está vacía hasta que la
amplías (declaration merging). Declara cada herramienta una vez, junto al código
que la registra, y todos los handlers la ven tipada:

```ts
declare module '@botmesh/core' {
  interface DefaultTools {
    db: typeof db
  }
}
```

Los plugins hacen lo mismo con las herramientas que registran: importar
`@botmesh/ai` tipa `ctx.tools.ai`, e importar `@botmesh/nlu` tipa
`ctx.tools.nlu`. En JavaScript no hay nada que declarar.

#### 3. Usarla en cualquier handler

```ts
bot.when('visitas', async (ctx) => {
  const db = ctx.tools.db
  const user = await db.touch(ctx.from)
  await ctx.reply(`📊 Nos has visitado ${user.visits} veces.`)
})
```

#### 4. También disponible en hooks y plugins

```ts
bot.before('message', async (ctx, next) => {
  const db = ctx.tools.db
  await db.touch(ctx.from)
  await next()
})
```

El `install(ctx)` de un plugin también recibe `ctx.tools`, así que los
plugins pueden consumir herramientas registradas en otro lugar (o
registrar las suyas con `ctx.bot.provide`). Fuera de los handlers (una tarea
programada, un webhook), léelas de `bot.injectTools`.

### Quitar una herramienta

`bot.unprovide(name)` quita una herramienta y devuelve `true` si existía.
Desenchufar un plugin no deshace sus `provide()`, así que hazlo en
`ctx.onDispose()`:

```ts
install(ctx) {
  ctx.bot.provide('cache', createCache())
  ctx.onDispose(() => { ctx.bot.unprovide('cache') })
}
```

### Múltiples herramientas

```ts
bot.provide('db', myDatabase)
bot.provide('cache', myCache)
bot.provide('api', myApiClient)

bot.when('test', async (ctx) => {
  await ctx.tools.db.query(/* ... */)
  await ctx.tools.cache.get(/* ... */)
  await ctx.tools.api.fetch(/* ... */)
})
```

Con TypeScript, declara las tres en `DefaultTools` como arriba.

## Paquetes de plugins

Además de `slashCommandsPlugin`, estos paquetes traen plugins listos:

- [IA](/es/guide/ai) — `@botmesh/ai`: respuestas con LLM (`aiPlugin`), con
  [herramientas](/es/guide/ai-herramientas),
  [memoria y RAG](/es/guide/ai-memoria-rag) y
  [streaming](/es/guide/streaming).
- [Voz](/es/guide/voz) — `@botmesh/voice` (`voicePlugin`):
  voz a texto para las notas de voz entrantes y respuestas con texto a voz.
- [Integraciones](/es/guide/integraciones) —
  `@botmesh/chatwoot`, `@botmesh/tickets`, `@botmesh/moderation`,
  `@botmesh/dialogflow` y `@botmesh/nlu` (intenciones locales).
- [Trazas](/es/guide/trazas) — `@botmesh/otel`
  (`otelMetricsPlugin`): `bot.metrics()` y los spans del bot en OpenTelemetry.

Todos están en npm.
`@botmesh/rag` (recuperación para `aiPlugin`) se
explica en [memoria y RAG](/es/guide/ai-memoria-rag).

## Siguientes pasos

- [Scheduler](./scheduler) — tareas programadas, que leen las herramientas de `bot.injectTools`
- [Ejemplo: rate limiter](/es/ejemplos/rate-limiter) — plugin completo
