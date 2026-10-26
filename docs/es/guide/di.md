# Inyección de dependencias

Comparte herramientas entre handlers, hooks y plugins sin usar globales.

## El problema que resuelve

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

## Cómo funciona

### 1. Registrar una herramienta

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

### 2. Tiparla

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

### 3. Usarla en cualquier handler

```ts
bot.when('visitas', async (ctx) => {
  const db = ctx.tools.db
  const user = await db.touch(ctx.from)
  await ctx.reply(`📊 Nos has visitado ${user.visits} veces.`)
})
```

### 4. También disponible en hooks y plugins

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

## Múltiples herramientas

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

## Siguientes pasos

- [Plugins](./plugins) — accede a herramientas desde un plugin
- [Scheduler](./scheduler) — tareas programadas
