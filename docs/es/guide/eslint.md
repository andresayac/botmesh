# Plugin de ESLint

`eslint-plugin-botmesh` detecta en el código fuente los errores que ningún
linter genérico conoce: API v1 que ya no existe, un `runtime.enter()`
bloqueante, un `install()` de plugin async, triggers vacíos, esperas sin
timeout y estado por usuario en variables de módulo. Complementa a
[`bot.lint()` / `lintFlows()`](/es/guide/inspeccion-flujos) en tiempo de
ejecución, que revisan los flujos registrados (gotos rotos, pasos
inalcanzables, triggers duplicados).

Necesita **ESLint 9 o superior** (flat config) y Node >= 22. El `src/bot.js`
de cada plantilla de [`create-botmesh`](/es/guide/inicio#crear-un-proyecto-con-create-botmesh)
pasa el preset `strict` sin avisos (lo comprueban los tests del plugin).

## Instalación

```bash
pnpm add -D eslint eslint-plugin-botmesh
```

## Uso

```js
// eslint.config.js
import botmesh from 'eslint-plugin-botmesh'

export default [
  botmesh.configs.recommended,
]
```

O regla por regla:

```js
import botmesh from 'eslint-plugin-botmesh'

export default [
  {
    plugins: { 'botmesh': botmesh },
    rules: {
      'botmesh/no-v1-api': 'error',
      'botmesh/require-timeout-on-ask': ['error', { methods: ['ask', 'choose'], allowFlowTimeout: true }],
    },
  },
]
```

Las reglas son sintácticas y no necesitan información de tipos. Para archivos
TypeScript, combina el plugin con `typescript-eslint` (su parser) y lista los
archivos `.ts`, porque ESLint solo revisa `.js`/`.mjs`/`.cjs` por defecto:

```js
import botmesh from 'eslint-plugin-botmesh'
import tseslint from 'typescript-eslint'

export default [
  { ...botmesh.configs.recommended, files: ['src/**/*.{js,ts}'] },
  { files: ['src/**/*.ts'], languageOptions: { parser: tseslint.parser } },
]
```

## Presets

| Preset | Reglas |
| --- | --- |
| `configs.recommended` | Errores: `no-v1-api`, `no-await-runtime-enter`, `no-async-plugin-install`, `no-empty-trigger`. Avisos: `require-timeout-on-ask`, `prefer-ctx-user-over-global-state`. |
| `configs.strict` | Todas las reglas como error; `require-timeout-on-ask` revisa también `waitText`, `waitMedia`, `waitLocation`, `choose`, `waitAny` y el `.form()` de los flujos. |

## Reglas

### `botmesh/no-v1-api`

Marca la API v1 / builderbot que no existe en v2 e indica el reemplazo en el
mensaje:

| v1 | Usa en su lugar |
| --- | --- |
| `.addAnswer()` | `flow(...).say(text)` / `.ask(text, 'stateKey')` |
| `.addAction()` | `.do(async (ctx, c) => { ... })` |
| `{ capture: true }` | `.ask(text, 'stateKey')` en un flujo o `await c.ask(text)` en una conversación |
| `flowDynamic()` | `ctx.reply(...)` o un paso `.say((ctx, c) => ...)` |
| `gotoFlow()` | `.goto('flowName')` o `c.goto('flowName')` |
| `endFlow()` | volver del paso, o `c.end(message)` |

```js
addKeyword('hola').addAnswer('¿Tu nombre?', { capture: true })   // se marca
flow('hola').ask('¿Tu nombre?', 'name', { timeout: '5m' })         // bien
```

Sin opciones.

### `botmesh/no-await-runtime-enter`

`ConversationRuntime.enter()` resuelve cuando la conversación **termina**.
Hacerle `await` en un handler bloquea la cola FIFO del chat, así que el mensaje
que espera la conversación nunca se despacha. La regla marca
`await runtime.enter(...)`, `return runtime.enter(...)` (el dispatcher espera
la promesa devuelta), una arrow function cuyo cuerpo es `runtime.enter(...)`
y esas tres formas con `.catch(...)` / `.then(...)` / `.finally(...)`
encadenados o con llamadas opcionales (`await runtime?.enter(...)`): la promesa
encadenada también se resuelve solo cuando la conversación termina.

```js
await runtime.enter(handle, msg)                                     // se marca
void runtime.enter(handle, msg).catch((err) => log.error({ err }))   // bien
```

Opción: `{ receiverPattern: string }`, el código de una regex que debe cumplir
el nombre del receptor (por defecto `runtime$`, sin distinguir mayúsculas).

### `botmesh/no-async-plugin-install`

`Plugin.install()` debe ser síncrono: `bot.plug()` no lo espera, así que el
bot arranca antes de que un `install` async termine y su rechazo solo llega al
evento `'error'` (en versiones anteriores del core era un unhandled rejection
que tumbaba el proceso). TypeScript ya rechaza un `install` async al compilar
(`PluginSpec.install` devuelve `void | SyncInstallError`); la regla cubre
JavaScript y los escapes con `as any`. Revisa el objeto que se pasa a `definePlugin(...)`, cualquier
objeto literal con `name` e `install`, y las clases con un método `install`
que declaran un campo `name` o `implements Plugin`. Para inicialización async
usa el patrón lazy (resolver en el primer uso y reportar los errores de
configuración desde un warmup no fatal), como `LazyProvider` en `@botmesh/ai`.

Sin opciones.

### `botmesh/no-empty-trigger`

Un trigger vacío (`''`, `'   '`, un template literal vacío, `[]`, `['']`,
`{ pattern: '' }`) no coincide con ningún mensaje real o, con `contains`,
coincide con todos. Se revisa en `flow(...)` / `addKeyword(...)`,
`bot.when(...)` y la opción `trigger` de `bot.conversation(name, fn, { trigger })`.
El core además lanza un `TypeError` al registrar un patrón de texto vacío; la
regla lo detecta (igual que `[]`) antes de ejecutar el código. `flow([])` /
`addKeyword([])` sí se permite: es la forma de declarar un subflujo sin trigger
propio (se ejecuta desde un `then` de choose, `.use()` o un `goto`); `bot.lint()`
avisa de los que nada alcanza.

Sin opciones.

### `botmesh/require-timeout-on-ask`

Toda espera de respuesta debería fijar su timeout a propósito. Sin él, la
espera usa el `conversation.timeout` del bot o, si no hay, los 5 minutos
integrados, que rara vez sirven igual para un formulario largo que para un sí/no
rápido. Un timeout de `0` (o `'0s'`) lo desactiva: si el usuario deja de
responder, la conversación sigue abierta, capturando sus mensajes, hasta un
comando como `/reset`. La regla marca los dos casos.

- DSL de flujos: `.ask(text, key, { timeout })`,
  `.choose(prompt, options, key, { timeout })`, `.form(definition, { timeout })`,
  o un `.timeout(...)` en cualquier punto de la misma cadena `flow(...)` (salvo
  con `allowFlowTimeout: false`).
- Conversaciones: `c.ask(text, { timeout })` y, si están en `methods`,
  `c.waitText({ timeout })`, `c.waitMedia(types, { timeout })`,
  `c.waitLocation({ timeout })`, `c.choose(prompt, options, { timeout })` y
  `c.waitAny({ timeoutMs })`. `waitAny` recibe milisegundos en `timeoutMs` e
  ignora una clave `timeout`, así que la regla también marca
  `c.waitAny({ timeout })`.
- Si el argumento de opciones no es un objeto literal (una variable, una
  llamada) o contiene un spread, la regla no puede ver su contenido y no avisa.

```js
await c.ask('¿Tu email?')                        // se marca (usa el valor por defecto)
await c.ask('¿Tu email?', { timeout: 0 })        // se marca (nunca expira)
await c.ask('¿Tu email?', { timeout: '10m' })    // bien
await c.waitAny({ timeoutMs: 60_000 })           // bien (con 'waitAny' en methods)
```

Si todas las esperas deben usar el `conversation.timeout` del bot, desactiva la
regla en lugar de repetirlo en cada paso.

Opciones: `{ methods?: ('ask' | 'waitText' | 'waitMedia' | 'waitLocation' | 'choose' | 'waitAny' | 'form')[], allowFlowTimeout?: boolean }`
(por defecto `['ask']` y `true`).

### `botmesh/prefer-ctx-user-over-global-state`

Marca el `globalState` de v1 y los `Map`, `Set` u objetos **de módulo** indexados
por `ctx.from`, `ctx.sender` o `ctx.senderId`. Las escrituras
(`users.set/delete(ctx.from)`, `seen.add(ctx.from)`, `scores[ctx.sender] = …`,
`scores[ctx.sender].n++`) se marcan siempre; las lecturas
(`users.get/has(ctx.from)`, `scores[ctx.sender]`), solo si la misma variable
también se escribe o se reasigna dentro de una función. Una lista constante de
permitidos o bloqueados (`const ADMINS = new Set([...])`,
`if (blocked.has(ctx.from))`), aunque se rellene a nivel de módulo, no guarda
estado por usuario y no se marca. El estado por usuario se pierde al reiniciar,
crece sin límite y no se comparte entre réplicas. Usa
[`ctx.user`](/es/guide/datos-usuario)
(`await ctx.user.ns('feature').set(key, value)`) para los datos por usuario y
`c.state` para los datos de la conversación.

Los datos efímeros del proceso que no deben sobrevivir a un reinicio, como la
ventana de un rate limit, son una excepción deliberada: desactiva la regla en
esa línea (`// eslint-disable-next-line botmesh/prefer-ctx-user-over-global-state`).

Opción: `{ contextNames: string[] }`, los nombres del parámetro de contexto
del handler (por defecto `['ctx']`).

## API

```ts
import botmesh, { rules, configs, PLUGIN_NAMESPACE } from 'eslint-plugin-botmesh'

botmesh.meta      // { name: 'eslint-plugin-botmesh', version, namespace: 'botmesh' }
botmesh.rules     // las seis reglas, por nombre sin el prefijo 'botmesh/'
botmesh.configs   // { recommended, strict } (flat configs)
```

Los módulos de las reglas se alcanzan por `rules` (`rules['no-v1-api']`); no
son exports con nombre. El `meta.docs.url` de cada regla apunta a su sección
de la versión en inglés de esta página, así que el editor enlaza cada aviso con
su explicación.

## Ver también

- [Inspeccionar y validar flujos](/es/guide/inspeccion-flujos)
- [Testing](/es/guide/testing)
- [README de `eslint-plugin-botmesh`](https://github.com/andresayac/botmesh/tree/main/packages/eslint-plugin)
