# Store persistente

El **store** es donde el bot guarda mensajes, chats, contactos, checkpoints de
flujos, historial de conversaciones de IA y los datos de
[`ctx.user`](./datos-usuario). Con el store en memoria por defecto, un reinicio
lo olvida todo; con uno persistente, el bot sigue donde lo dejó.

Todos los stores implementan el contrato `IStore` de `@botmesh/core`, neutral
respecto al transporte, así que el mismo store funciona con cualquier canal.

## Elegir un store

| Store | Paquete | Dónde viven los datos | Úsalo para |
|---|---|---|---|
| `MemoryStore` *(default)* | `@botmesh/core` | Memoria del proceso (snapshot JSON opcional) | Desarrollo y tests |
| `SQLiteStore` | `@botmesh/sqlite-store` | Un archivo SQLite | **Producción con un proceso** |
| `RedisStore` | `@botmesh/redis-store` | Un servidor Redis o un Redis Cluster | **Producción con varias réplicas** |
| `PostgresStore` · `MysqlStore` · `MongoStore` | `@botmesh/postgres-store` · `@botmesh/mysql-store` · `@botmesh/mongo-store` | PostgreSQL / MySQL / MongoDB | Aún sin publicar en npm (ver [más abajo](#postgresql-mysql-y-mongodb)) |

Reglas prácticas:

- Un proceso del bot en un VPS o en un contenedor: **`SQLiteStore`**. Sin
  servidor que mantener, un archivo que respaldar.
- Varios procesos del mismo bot ([réplicas](./replicas)), o estado que leen
  otros servicios: **`RedisStore`**. Todas las réplicas deben ver los mismos
  datos, así que `MemoryStore` y `SQLiteStore` no sirven ahí.
- Pasa siempre una **instancia** de store (`store: new SQLiteStore({ … })`). Un
  string como `store: 'sqlite'` solo se acepta por compatibilidad y sigue
  creando un `MemoryStore`.

El bot llama por ti a `start()` y `stop()` del store.

## MemoryStore

Sin la opción `store`, el bot crea un `MemoryStore`. Todo vive en RAM. Un
archivo JSON opcional guarda una copia de chats, contactos, checkpoints de
flujos, conversaciones de IA y datos de `ctx.user` (no los mensajes) cada cierto
intervalo y en `stop()`:

```ts
import { Bot, MemoryStore } from '@botmesh/core'

const bot = new Bot({
  provider,
  store: new MemoryStore({
    file: './store.json',     // snapshot opcional
    autoSaveInterval: '1m',   // una duración o ms; 0 desactiva el temporizador
    maxMessagesPerChat: 1000, // el valor por defecto; Infinity quita el tope
  }),
})
```

| Opción | Tipo | Default | Descripción |
|---|---|---|---|
| `file` | `string` | — | Archivo JSON que se carga al arrancar y se guarda en cada intervalo y en `stop()` |
| `autoSaveInterval` | `string \| number` | `60000` | Periodo de guardado de `file`; `0` lo desactiva |
| `maxMessagesPerChat` | `number` | `1000` | Mensajes más recientes que se guardan por chat; `Infinity` los guarda todos |
| `logger` | `MemoryStoreLogger` | — | Recibe los fallos de carga y guardado |

El log de mensajes tiene un tope de 1000 mensajes por chat por defecto porque
vive en RAM. Los stores persistentes no tienen tope salvo que pongas uno.

::: warning Los mensajes no se restauran
El snapshot JSON omite a propósito el log de mensajes (tamaño y privacidad).
Usa `SQLiteStore` o `RedisStore` cuando el historial deba sobrevivir a un
reinicio.
:::

## SQLiteStore

Una base de datos real en un archivo, sobre
[better-sqlite3](https://github.com/WiseLibs/better-sqlite3). `better-sqlite3`
es una peer dependency, así que instálala junto al store:

```bash
pnpm add @botmesh/sqlite-store better-sqlite3
```

Mientras botmesh esté en prerelease, añade a los paquetes `@botmesh/*` el
dist-tag que indica [Instalación](./inicio).

```ts
import { Bot } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'
import { SQLiteStore } from '@botmesh/sqlite-store'

const bot = new Bot({
  provider: new BaileysProvider({ session: 'mi-bot' }),
  store: new SQLiteStore({ file: './data/bot.db' }),
})
```

La carpeta de `file` debe existir: SQLite crea el archivo, no sus carpetas.

### Instalar better-sqlite3

`better-sqlite3` es un módulo nativo. El rango soportado es
`^11.7.0 || ^12.0.0 || ^13.0.0`, y el store se prueba con los tres.

::: warning Node.js 24.19 o superior: usa better-sqlite3 13
Las versiones 11 y 12 pueden abortar el proceso (`Assertion failed: (env) != nullptr`
en `RemoveEnvironmentCleanupHook`) cuando el recolector de basura libera un
prepared statement, por una regresión de Node.js
([nodejs/node#65446](https://github.com/nodejs/node/issues/65446)). La versión
13 usa N-API y no está afectada.
:::

| Error al construir el store | Solución |
|---|---|
| `better-sqlite3` no está instalado | `pnpm add better-sqlite3` |
| `better-sqlite3 is installed but its native module was never built` | pnpm 10 y posteriores se saltan los scripts de build de las dependencias. Ejecuta `pnpm approve-builds` una vez (o, en `pnpm-workspace.yaml`, pon `allowBuilds:` con `better-sqlite3: true` en pnpm 11, o añádelo a `onlyBuiltDependencies` en pnpm 10) y reinstala. |
| El binario se compiló para otra versión de Node.js | `npm rebuild better-sqlite3` (tras actualizar Node.js) |
| La carpeta no existe | Crea la carpeta de `file` |
| `SQLITE_NOTADB` | `file` apunta a algo que no es una base de datos SQLite |

### Opciones

| Opción | Tipo | Default | Descripción |
|---|---|---|---|
| `file` | `string` | `'./bot.db'` | Archivo de la base de datos. `':memory:'` es una base en memoria que `stop()` deja abierta (cerrarla perdería sus datos). |
| `wal` | `boolean` | `true` | Modo de journal WAL (los lectores no bloquean al escritor) |
| `maxMessagesPerChat` | `number` | — (sin tope) | Guardar solo los N mensajes más recientes por chat; las filas antiguas se podan al guardar |
| `busyTimeoutMs` | `number` | `5000` | Cuánto espera una sentencia el lock de otra conexión antes de `SQLITE_BUSY` |
| `purgeBatchSize` | `number` | `1000` | Filas borradas por sentencia en `purgeExpiredUserData` (repite hasta que no queda nada caducado) |
| `logger` | `Partial<LoggerLike>` | — | Recibe los fallos de cierre y las notas de migración del esquema (pino o `bot.logger`) |

Un número inválido (negativo, decimal) lanza un `RangeError` en el constructor.

### Qué almacena

| Tabla | Contenido |
|---|---|
| `messages` | Mensajes entrantes y salientes, indexados por chat y timestamp |
| `chats`, `contacts` | Metadatos de chats y contactos |
| `checkpoints` | Checkpoints de flujos `.persistent()`, incluido `c.state` |
| `conversations` | Historial de conversaciones de IA (`@botmesh/ai`) |
| `cursors` | Cursores de entrega (el `update_id` de Telegram), marcas de `WELCOME` y el índice de handoff |
| `user_data` | Entradas de [`ctx.user`](./datos-usuario) |
| `schedules`, `schedule_fences` | Tareas del [scheduler durable](./scheduler#tareas-durables-sobreviven-a-reinicios-una-replica-por-ejecucion) (`store.schedules()`) |
| `durable` | Journals de [durabilidad](./durabilidad) (`store.durability()`) |

### Versiones del esquema y actualizaciones

El archivo guarda su estructura en `PRAGMA user_version`;
`SQLITE_SCHEMA_VERSION` es la versión que escribe esta release. Al abrir un
archivo se ejecutan en orden las migraciones pendientes, cada una en su propia
transacción, así que una base escrita por una release anterior se actualiza en
el sitio conservando sus filas. Nunca creas ni migras tablas a mano.

Un archivo escrito por una release **más nueva** se rechaza, sin tocarlo, con
`SQLiteSchemaVersionError` (`code: 'SQLITE_SCHEMA_TOO_NEW'`, con `found` y
`supported`). No se admiten bajadas de versión, así que:

- **Respalda el archivo antes de actualizar** `@botmesh/sqlite-store` si puedes
  necesitar volver atrás.
- Si varios procesos comparten un archivo, para los de la versión antigua antes
  de que uno nuevo lo abra.

El [README del paquete](https://www.npmjs.com/package/@botmesh/sqlite-store#schema-versioning)
detalla qué cambió en cada versión y cómo deshacer el último paso sin copia de
seguridad.

### Ciclo de vida

`bot.stop()` (y un `bot.start()` fallido) cierra la base de datos, y el
siguiente `bot.start()` la reabre, así que una misma instancia de
`SQLiteStore`, con los backends `schedules()` y `durability()` que entregó,
sobrevive a ciclos de parada y arranque.

SQLite guarda el texto en UTF-8, donde un surrogate UTF-16 suelto se convierte
en U+FFFD y dos ids distintos podrían compartir fila. `saveMessage` y
`setCursor` rechazan ese id, clave o valor de cursor con un `TypeError`.

## Flujos persistentes

Con un store persistente, los checkpoints de `flow(...).persistent()`
sobreviven a un reinicio:

```ts
import { Bot, flow } from '@botmesh/core'
import { SQLiteStore } from '@botmesh/sqlite-store'

const bot = new Bot({ provider, store: new SQLiteStore({ file: './data/bot.db' }) })

bot.use(
  flow('registro')
    .persistent()                 // checkpoint guardado tras cada paso
    .ask('¿Cómo te llamas?', 'name')
    .ask('¿Y tu email?', 'email')
    .say((_ctx, c) => `¡Gracias, ${c.state.name}!`),
)
```

Si el proceso se detiene a mitad del flujo, el siguiente mensaje del usuario lo
**retoma en el paso donde se quedó**. Ese mensaje solo despierta el flujo: la
pregunta pendiente se envía otra vez (`¿Y tu email?` arriba) y la siguiente
respuesta del usuario es la que cuenta. Con [durabilidad](./durabilidad), el
mensaje que lo despierta se toma como la respuesta.

Se escribe un checkpoint al empezar el flujo y después de cada paso, así que
incluso un flujo que aún espera su **primera** pregunta se retoma ahí. Un
reinicio a mitad de un [`.form()`](./formularios) vuelve a preguntar el
formulario desde su primer campo: todo el formulario es un solo paso.

## RedisStore

Estado compartido por todos los procesos de un bot, sobre Redis (node-redis 4,
5 o 6 como peer dependency):

```bash
pnpm add @botmesh/redis-store redis
```

```ts
import { Bot } from '@botmesh/core'
import { RedisStore } from '@botmesh/redis-store'

const bot = new Bot({
  provider,
  store: new RedisStore({ url: process.env.REDIS_URL, prefix: 'mybot', sessionTtl: '7d' }),
})
```

| Opción | Tipo | Default | Descripción |
|---|---|---|---|
| `url` | `string` | `redis://localhost:6379` | URL de conexión; se ignora con `client` |
| `prefix` | `string` | `'botwa'` | Prefijo de todas las claves. Elígelo una vez: lo guardado bajo un prefijo no se ve bajo otro. |
| `client` | cliente o cluster de node-redis | — | Un cliente existente. El store nunca lo conecta ni lo cierra; ponle un listener de `'error'`. |
| `cluster` | `{ rootNodes, … }` | — | Crea y gestiona un cliente cluster (ver [Redis Cluster](./redis-cluster)) |
| `sessionTtl` | `string \| number` | — (no caduca) | Caducidad de las conversaciones de IA y de los checkpoints (`'24h'`, `'7d'` o ms). Mensajes, chats, contactos y cursores no caducan. |
| `maxMessagesPerChat` | `number` | — (sin tope) | Guardar solo los N mensajes más recientes por chat |
| `logger` | `{ error?, warn? }` | — | Recibe los errores de conexión de un cliente creado por el store |

El mismo `RedisStore` entrega los demás backends de Redis, todos sobre su
cliente y su prefijo: `store.coordinator()` para [réplicas](./replicas),
`store.schedules()` y `store.leases()` para el
[scheduler durable](./scheduler#backends). El backend de durabilidad es
`new RedisDurability({ client, prefix })` (ver
[Procesamiento durable](./durabilidad#backends)).

Un cliente inyectado sin listener de `'error'` tumba el proceso en la primera
caída de conexión (node-redis relanza el evento), así que ponle siempre uno. El
esquema de claves y el resto de detalles están en el
[README del paquete](https://www.npmjs.com/package/@botmesh/redis-store).

## PostgreSQL, MySQL y MongoDB

`@botmesh/postgres-store`, `@botmesh/mysql-store` y `@botmesh/mongo-store`
pasan la misma suite de conformidad que los stores publicados y también traen
stores de schedules (y, en PostgreSQL, un backend de durabilidad). **Aún no
están publicados en npm**: úsalos desde una copia del
[repositorio](https://github.com/andresayac/botmesh/tree/main/packages), donde
sus README documentan las opciones.

## Tablas de datos de usuario

Los perfiles de [`ctx.user`](./datos-usuario) se guardan junto al resto del
estado del bot, respetando `tablePrefix` / `collectionPrefix`:

| Store | Dónde |
| --- | --- |
| `MemoryStore` | en memoria; el `file` JSON gana un campo `userData` (los archivos anteriores siguen cargando) |
| `SQLiteStore` | tabla `user_data` (`user_id`, `namespace`, `key`, `value_json`, `expires_at`, `updated_at`) + índice sobre `expires_at` |
| `RedisStore` | una clave por entrada, `{prefix}:ud:{user}:{ns}:{key}`, con caducidad nativa `PX`; los listados usan `SCAN` incremental |
| `PostgresStore` | tabla `{prefix}user_data` (valor como `TEXT`, no JSONB, para que el JSON exacto vaya y vuelva) + índice de caducidad |
| `MysqlStore` | tabla `{prefix}user_data`: ids, namespace y clave como `VARBINARY` (exactos byte a byte), valor `MEDIUMTEXT` (16 MiB) |
| `MongoStore` | colección `{prefix}user_data`, índices sobre `{ userId, namespace }` y `expiresAt` |

Las entradas caducadas se borran de forma perezosa con
`bot.purgeExpiredUserData()` (Redis las caduca solo). Los stores SQL y Mongo
las borran en lotes de `purgeBatchSize` (por defecto `1000`) hasta que no queda
nada caducado, así que un gran atraso nunca se ejecuta como un único borrado
largo.

## Escribir tu propio store

Implementa `IStore` para conectar otro backend. Quien escribe un store importa
el contrato y sus helpers desde `@botmesh/core/spi`:

```ts
import type { MessageRef } from '@botmesh/core'
import type { IStore, StoredMessage } from '@botmesh/core/spi'

class MyStore implements IStore {
  async start(): Promise<void> { /* conectar */ }
  async stop(): Promise<void> { /* desconectar */ }
  async saveMessage(msg: StoredMessage): Promise<void> { /* … */ }
  async getMessage(ref: MessageRef): Promise<StoredMessage | undefined> { /* … */ }
  // …el resto de métodos obligatorios de IStore
}
```

La interfaz completa está en la [referencia de la API](/api/interfaces/_botmesh_core.IStore.html).
`MemoryStore` es la implementación de referencia, y dentro del monorepo todos
los stores pasan la suite de conformidad compartida
(`test-utils/store-conformance.ts`).

Semántica que todo store debe respetar:

- `upsertChat` / `upsertContact` hacen **merge superficial** sobre el registro
  guardado. Un campo propio con valor `undefined` **borra** ese campo, así que
  un upsert parcial debe omitir lo que no conoce. El bot ya lo hace: un mensaje
  sin nombre visible nunca borra el guardado.
- `deleteChat` borra también el log de mensajes de ese chat.
- `getMessagesByChat(chatId, limit)` devuelve los `limit` mensajes más
  recientes, **del más antiguo al más nuevo** (por defecto `50`). Un `limit` de
  `0` o menos no devuelve nada, una fracción se redondea hacia arriba e
  `Infinity` devuelve todo el log. Los stores persistentes ordenan por
  `timestamp`, así que volver a guardar un mensaje con otro timestamp lo mueve;
  `MemoryStore` lo deja en la posición de su primer guardado.
- `saveMessage` ignora un mensaje sin `ref.id` o sin `chatId` (los providers
  mandan `ref.id: ''` cuando no tienen un id estable), y `getMessage` de esa ref
  resuelve `undefined`. Volver a guardar un id reemplaza el mensaje.
- `maxMessagesPerChat` es opcional en los stores persistentes. Rechaza un tope
  negativo o decimal con un `RangeError`.
- `setUserData` rechaza con un `TypeError` un valor que no es JSON
  (`undefined`) y no escribe nada.
- Las filas de mensajes se indexan con `messageKey(ref)` (de
  `@botmesh/core/spi`): `{chatId}:{id}` con `%` y `:` escapados en cada parte
  (`%25`, `%3A`), para que los ids con `:` (los chat ids `whatsapp:+1…` de
  Twilio) nunca choquen. Las filas escritas con la clave antigua sin escapar
  (`legacyMessageKey(ref)`) deben seguir leyéndose y borrándose, comprobando
  que el `ref.id` y el `ref.chatId` guardados son los del mensaje pedido, y al
  volver a guardarlas pasan a la clave nueva.

Métodos opcionales:

- **Datos de usuario** (`getUserData`, `setUserData`, `deleteUserData`,
  `listUserData`, `purgeExpiredUserData`): sin ellos, `ctx.user` rechaza con
  `UNSUPPORTED_STORE`. Compruébalos con `test-utils/user-data-conformance.ts`.
- **Cursores** (`getCursor`/`setCursor`): además persisten las marcas de
  [`WELCOME`](./triggers#welcome) y el índice de [handoff](./handoff).
- **Checkpoints condicionales** (`setCheckpointIf`/`clearCheckpointIf`):
  necesarios para un relevo seguro entre [réplicas](./replicas). Sin ellos, el
  bot avisa en el log cuando la coordinación está activa.

## Docker

Monta la carpeta de datos como volumen para que la base de datos sobreviva a
los reinicios del contenedor. Ver [Despliegue](./deploy#docker-compose-yml) para
la configuración completa y las [copias de seguridad](./deploy#copias-de-seguridad).
