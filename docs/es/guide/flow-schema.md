# Esquema JSON de flujos

`@botmesh/flow-schema` define **documentos de flujo versionados y sin código**: JSON que puedes guardar, editar en una interfaz y reemplazar en caliente, que un gate de despliegues valida y que compila a un `CompiledFlow` del core.

```bash
pnpm add @botmesh/core @botmesh/flow-schema
```

Mientras los paquetes estén en prerelease, añade el dist-tag que indica
[Inicio](/es/guide/inicio). La entrada principal sigue semver; el motor de expresiones y los helpers de metadatos del compilador viven en `@botmesh/flow-schema/internal`, sin garantía semver.

Un documento es **solo datos**. Nunca lleva funciones, `eval`, imports ni expresiones arbitrarias: el único cálculo es un lenguaje de expresiones seguro y plantillas <code v-pre>{{ path }}</code>.

```ts
import { compileFlowDocument, validateFlowDocument } from '@botmesh/flow-schema'

const document = {
  version: 2 as const,
  id: 'checkout',
  trigger: { keywords: ['comprar', 'pedido'], match: 'contains' },
  timeout: '5m',
  steps: [
    { kind: 'ask' as const, text: '¿Tu nombre?', stateKey: 'name' },
    { kind: 'condition' as const, if: 'len(name) > 2', then: [{ kind: 'say' as const, text: 'Hola {{name}}' }] },
    { kind: 'handoff' as const, reason: 'checkout' },
  ],
}

if (validateFlowDocument(document).length === 0) bot.registerFlow(compileFlowDocument(document))
```

## Documento

| Campo | Notas |
| --- | --- |
| `version` | `2`. Un documento de la versión 1 se sigue aceptando y se migra al cargarlo (su `retries: N` pasa a `maxAttempts: N`); usa `migrateFlowDocument()` para formas antiguas. |
| `id` | `^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$`; es el nombre del flujo en el bot. |
| `trigger` | Una keyword, un array, o `{ keywords, match: 'equals' \| 'contains' \| 'startsWith' \| 'endsWith', scope: 'dm' \| 'group' \| 'all' }`. |
| `timeout` | Timeout del flujo (ms o `'30s'`, `'5m'`, `'1h'`; como máximo 7 días). |
| `persistent` | Sobrevive a un reinicio (requiere un store persistente). |
| `steps` | Al menos uno; como máximo 500 en total (anidados incluidos), 8 niveles de profundidad. |

## Pasos

| Tipo | Qué hace |
| --- | --- |
| `say` | Envía texto (admite plantillas). |
| `ask` | Envía texto, espera una respuesta y la guarda en `c.state[stateKey]`; admite `timeout`, `maxAttempts` (respuestas en total) o `retries` (después de la primera) y `validate: { expr, message }`: `$answer` es la respuesta cruda, y ahí solo existen `$answer`, `$body`, `$from`, `$sender` y `$isGroup` (`c.state` no; el validador marca cualquier otra variable). |
| `choose` | Menú numerado (`options: [{ key, label, steps? }]`), guarda la clave elegida. |
| `condition` | Expresión `if` con pasos anidados en `then`/`else`. |
| `delay` | Pausa (`'500ms'`… como máximo 5 minutos). |
| `goto` | Salta a otro flujo registrado. |
| `end` | Termina la conversación, con despedida opcional. |
| `media` | Envía `image`, `video`, `audio`, `voice`, `document`, `sticker` o `location`. Los archivos necesitan `source: { url }` (http/https) o `{ stateKey }` (una URL https absoluta guardada en el estado, como cadena o `{ url }`, con un host público); la ubicación necesita `latitude`/`longitude`. |
| `form` | Formulario nativo (o pregunta a pregunta) con campos tipados; ver [Formularios](./formularios.md). |
| `guard` | Expresión `if`; si es falsa envía `message` y termina, o `message` + `redirect` a otro flujo. |
| `subflow` | Ejecuta otro documento en línea (mismo estado), resuelto con `resolveSubflow`. |
| `http` | Petición HTTP declarativa a través de `@botmesh/http` (anti-SSRF, redirecciones, timeout y límites de tamaño). Guarda el cuerpo JSON/texto en `stateKey`. Los marcadores <code v-pre>{{ path }}</code> solo se permiten en la ruta, la query o el fragmento de la URL (nunca en el esquema, las credenciales, el host o el puerto); sus valores se codifican con percent-encoding y un valor `.` o `..` a secas se rechaza. Los valores de texto del `body` JSON también admiten marcadores (una cadena que es exactamente un <code v-pre>{{ path }}</code> envía el valor tal cual, `null` si falta). Una respuesta que no es 2xx hace fallar el paso, un valor de cabecera que se pinta con un salto de línea se rechaza y los errores muestran la plantilla de la URL sin su query. |
| `handoff` | Pasa el chat a una persona (`ctx.handoff`), con mensaje opcional. |
| `ai` | Un turno de IA con `ctx.tools.ai.replyInChat`, opcionalmente restringido a ids de herramientas (`tools: ['lookup']`); guarda la respuesta en `stateKey`. |

Las URLs de media deben ser http(s). Rutas locales, buffers y streams **no** se pueden representar a propósito: un documento guardado no puede leer el sistema de archivos del servidor. Lo mismo vale en ejecución para las fuentes `{ stateKey }`: el valor del estado puede venir de la respuesta de un usuario final o de un paso `http`, así que todo lo que no sea una URL http(s) absoluta (`/etc/passwd`, `C:\…`, `file:`, `data:`) hace fallar el paso en vez de llegar al proveedor, que leería una cadena sin esquema como un archivo local. El proveedor, o un gateway autoalojado como Evolution o WPPConnect, descarga esa URL desde dentro de tu red, así que por defecto además debe ser `https:` y su host no puede ser (ni resolver a) una dirección privada, de loopback o link-local (`127.0.0.1`, `169.254.169.254`, `10.x`, `localhost`…). La opción de compilación `media` lo relaja a propósito: `compileFlowDocument(doc, { media: { allowHttp: true, allowPrivateHosts: true, resolver } })`. Las URLs escritas en el propio documento son del autor y no se comprueban.

El `pattern` de un campo de formulario se evalúa contra respuestas no confiables, así que el validador rechaza las referencias hacia atrás y los grupos repetidos cuyo cuerpo vuelve a repetirse o alternar (`(a+)+`, `(\w+\s?)*`, `(a|aa)+`: backtracking catastrófico). Escríbelos con una clase de caracteres (`[a-z0-9-]+`). Esa comprobación es solo un primer filtro: el campo compilado nunca ejecuta el patrón con el motor de backtracking de JavaScript. Compara la respuesta completa con un autómata de tiempo lineal (`O(longitud de la respuesta × tamaño del patrón)`), así que tampoco pueden congelar el proceso los cuantificadores seguidos (`.*.*.*x`) ni las cadenas largas de alternativas. La sintaxis admitida es el subconjunto regular: literales y escapes, clases de caracteres, `.`, grupos (de captura, `(?:…)` y con nombre), `|`, `* + ? {n} {n,} {n,m}` (también en su forma perezosa) y las anclas `^ $ \b \B`. Se rechazan los lookarounds (`(?=`, `(?!`, `(?<=`, `(?<!`), las referencias hacia atrás, los escapes octales y los patrones cuyas repeticiones acotadas se despliegan en más de 2000 estados. Un campo de texto con `pattern` y sin `maxLength` queda limitado a 500 caracteres, y su `maxLength` puede ser como mucho 1000 (`FLOW_DOCUMENT_LIMITS.maxPatternAnswerLength`): el autómata es lineal, pero su coste sigue creciendo con la longitud de la respuesta por el tamaño del patrón.

El validador también rechaza los campos que ninguna respuesta puede cumplir: `minLength` mayor que `maxLength`, `min` mayor que `max`, un límite de `date` que no es un día real (`2025-02-30`) o un `min` posterior a su `max`, y un `minSelected` mayor que el número de opciones o que `maxSelected`.

## Expresiones seguras

`condition.if`, `guard.if` y `ask.validate.expr` usan un lenguaje recursivo mínimo:

- literales (`1`, `'texto'`, `true`, `false`, `null`), rutas de estado (`user.city`), `== != < <= > >= && || ! + -` y paréntesis;
- funciones: `len`, `lower`, `upper`, `trim`, `number`, `string`, `contains`, `startsWith`, `endsWith`, `empty`, `oneOf`.

Sin `eval`, sin `Function`, sin regexes, sin índices, sin asignación y sin acceso al prototipo (`__proto__`, `prototype` y `constructor` se rechazan). Límites: 1000 caracteres, 256 tokens, 32 niveles.

Las plantillas (<code v-pre>{{ path }}</code>) solo leen propiedades propias de `c.state` más `$body`, `$from`, `$sender` y `$isGroup`; un valor ausente se pinta como cadena vacía. Un valor ya pintado nunca se vuelve a leer como plantilla.

Una clave de estado puede llevar puntos: tras un `ask` con `stateKey: 'user.name'`, tanto <code v-pre>{{ user.name }}</code> como `len(user.name)` leen `c.state['user.name']` (si también existe un objeto anidado `c.state.user.name`, gana el anidado). Las claves con `-` o `:` son ids válidos pero no se pueden leer (`first-name` es una resta), así que usa letras, dígitos, `_` y `.` en las claves que vayas a leer. Una variable `$` desconocida, o `$answer` fuera de `ask.validate.expr`, es un error de validación.

## Errores de validación

`validateFlowDocument()` devuelve rutas tipo JSON Pointer:

```ts
validateFlowDocument({ version: 2, id: 'x', trigger: 'x', steps: [{ kind: 'ask', text: '', stateKey: 'bad key' }] })
// [{ path: '/steps/0/text', message: '...' }, { path: '/steps/0/stateKey', message: '...' }]
```

`compileFlowDocument()` lanza `FlowDocumentError` con los mismos problemas. El JSON Schema (`FLOW_DOCUMENT_SCHEMA`, draft 2020-12) lo sirve el manager en `GET /v1/flows/schema` para editores y generación de código.

## Subflujos

```ts
bot.registerFlow(compileFlowDocument(parent, {
  resolveSubflow: (id) => documents.get(id),
}))
```

Los pasos del subflujo corren en línea (mismo `c.state`, sin un segundo trigger). Un documento que falta o un ciclo (`a → b → a`) es un error de compilación. Como un subflujo se inserta de nuevo en cada referencia, un flujo puede llegar como mucho a `FLOW_DOCUMENT_LIMITS.maxInlinedSteps` (5000) pasos con todos sus subflujos expandidos; una cadena de flujos que llaman varias veces al siguiente crece de forma exponencial y se rechaza al compilar (en `@botmesh/manager`, `createBot`/`updateBot`/`addFlow` responden `INVALID`).

## Migraciones

```ts
import { migrateFlowDocument } from '@botmesh/flow-schema'

const { document, from, applied } = migrateFlowDocument(storedDraft)
```

La versión 0 (sin `version`, la forma anterior a la versionada) pasa a la 1. La versión 1 pasa a la 2: en v1 `retries` de los pasos `ask`/`form` eran las respuestas en total, así que `retries: N` se reescribe como `maxAttempts: N` (un `retries: 0`, como `maxAttempts: 1`) y el flujo conserva su comportamiento; en v2 `retries` cuenta las respuestas después de la primera, como en el core. `validateFlowDocument`, `compileFlowDocument` y `flowFromArtifact` aplican esa migración a los documentos v1 al cargarlos; `isFlowDocument` solo acepta la versión 2. Una versión más nueva que el paquete se rechaza; las migraciones se pueden ampliar y encadenar (`migrateFlowDocument(input, migrations, target)`).

## Exportación inversa

```ts
import { exportFlowDocument } from '@botmesh/flow-schema'

const document = exportFlowDocument(compiledFlow)
```

Los flujos compilados desde un documento hacen round-trip exacto (el JSON original se guarda como metadato del paso). Los flujos escritos con el DSL exportan sus pasos declarativos (`say`, `ask`, `choose`, `goto`, `delay`, `media`, `form`, `use`); un `do` opaco o un guard con función lanzan `FlowExportError` con las rutas de los pasos en vez de descartarlos en silencio. Lo mismo pasa con un resultado que `validateFlowDocument` rechazaría (un `.delay()` del DSL de más de 5 minutos, un id con espacios): una exportación siempre se vuelve a cargar. El documento devuelto es una copia; cambiarlo no toca el flujo compilado.

## Borradores y despliegues

```ts
import { diffFlowDocuments, flowDigest, publishFlow } from '@botmesh/flow-schema'

const changes = diffFlowDocuments(draft, published)   // metadatos, pasos añadidos/quitados/cambiados con rutas
const digest = flowDigest(draft)                      // sha256 del JSON canónico, estable ante el orden de claves
await publishFlow(registry, 'acme', 'support', draft) // gate de DeploymentRegistry + gate run auditado
```

`publishFlow()` usa el JSON del documento como artefacto y un `flowDocumentGate()` que parsea, valida y compila el candidato; `options.gate` puede encadenar otro gate (p. ej. transcripciones doradas). El almacenamiento es de `@botmesh/deployments`; este paquete solo aporta los helpers puros.

## REST del manager

Los endpoints de flujos del manager (`POST`/`PUT`) aceptan exactamente estos documentos. `GET /v1/flows/schema` sirve el JSON Schema y `GET/PUT/DELETE /v1/bots/{botId}/flows/{flowId}` los guardan y reemplazan en caliente sin cambiar el contrato REST. Los pasos `subflow` se resuelven contra los demás flujos guardados del bot.
