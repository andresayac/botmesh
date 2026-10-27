# WhatsApp Cloud API

La API oficial. Funciona por webhook: handshake GET con `verifyChallenge()`
y eventos POST con `ingest()` (ver el ejemplo de servidor
en el [resumen de canales](/es/guide/canales#socket-polling-o-webhook)).

## Instalación

```bash
pnpm add @botmesh/core @botmesh/meta
```

## Uso

Configuración en Meta: crea una app con el producto **WhatsApp** en
developers.facebook.com, genera un **token de usuario del sistema** permanente
con `whatsapp_business_messaging`, copia el **phone number id** del número
emisor y, en WhatsApp → Configuración, pon la URL del webhook y un verify token
que elijas, y suscríbelo al campo **`messages`** (trae tanto los mensajes como
los estados de entrega).

```ts
import { CloudAPIProvider } from '@botmesh/meta'

const provider = new CloudAPIProvider({
  accessToken: process.env.META_TOKEN!,        // system-user token
  phoneNumberId: process.env.META_PHONE_ID!,
  verifyToken: process.env.META_VERIFY_TOKEN!, // the one you set in Meta
  appSecret: process.env.META_APP_SECRET!,     // verifies X-Hub-Signature-256
})
```

- Botones de respuesta nativos (máximo 3: con más rechaza con
  `UnsupportedContentError`, envía una lista), listas, plantillas y
  formularios con WhatsApp Flows. Un botón con `url` sale como botón de
  enlace `cta_url` (uno por mensaje: varios enlaces, o un enlace mezclado
  con botones de respuesta, rechazan). Una `card` conserva su imagen (como
  media o como cabecera del mensaje interactivo) y sus botones. Los límites
  de Graph se comprueban antes de enviar: sin botones, ids o títulos de
  botón repetidos (comparados tras el corte a 20 caracteres), una lista sin
  filas, con más de 10 filas en total o con ids de fila repetidos rechazan
  con `UnsupportedContentError`. Las etiquetas se cortan por grafemas, así
  que un emoji se conserva entero o se quita, nunca se parte.
- Si falta `accessToken`, `phoneNumberId` o `verifyToken`, el constructor
  falla con un error que nombra el campo (`phoneNumberId` también puede ser
  un entero seguro). Cada petición a Graph tiene un límite de tiempo
  (`requestTimeoutMs`, 60 s por defecto); las subidas de media tienen el
  suyo (`uploadTimeoutMs`, 5 min por defecto).
- Una respuesta interactiva que no es la pulsación de un botón o una lista
  (por ejemplo `call_permission_reply`) llega como mensaje `unknown`, con el
  payload crudo en `ctx.ref.native`.
- **Versión de la Graph API:** `apiVersion` toma por defecto
  `DEFAULT_GRAPH_API_VERSION` de `@botmesh/graph-core` (`v26.0`, publicada el
  29-07-2026; Messenger e Instagram usan el mismo valor). Meta retira cada
  versión unos dos años después de publicarla, así que el valor por defecto
  sigue a la actual y cambia en una versión menor, tras revisar los payloads
  contra el changelog de Meta. Fija `apiVersion` (por ejemplo `'v24.0'`) para
  quedarte en una versión hasta migrar. Un estado `played` (se escuchó una
  nota de voz) llega como `read` con `platformData.played: true`.
- Los usuarios con username de WhatsApp pueden llegar con un BSUID en lugar
  del teléfono; el provider mantiene un id estable por persona
  (`identityMap`).
- Fuera de la ventana de 24 h los envíos libres rechazan con
  `OutsideSessionWindowError`. El gestor opcional `sessionWindow` reabre el
  chat con una plantilla y reintenta: ver
  [Ventana de 24 h y costos](/es/guide/ventana-24h).
- La API no tiene grupos, indicador de escritura ni encuestas, ni borrado para
  todos: el provider no tiene `typing()` ni `deleteMessage()`, así que
  `ctx.typing()` y `ctx.delete()` no hacen nada (ver el
  [contrato común de los canales](/es/guide/canales#contrato-comun-de-los-canales)).
- El core divide en varios mensajes el texto de más de 4096 caracteres.
- Con el bot parado, `ingest()` responde `503`, así que Meta reenvía el
  webhook tras el reinicio.
- `publishForm()` fija en el Flow la etiqueta de envío por defecto de un
  formulario en el `lang` del provider (por defecto `'en'`; ponle el
  `BotConfig.lang` de tu bot), o en `publishForm(def, { lang })` para un Flow.
  El `submitLabel` del propio formulario siempre gana.

## Siguientes pasos

- [Canales](/es/guide/canales): elegir un canal, la matriz de capacidades y el contrato común de los canales.
- [Ventana de 24 h y costos](/es/guide/ventana-24h): reabre un chat con una plantilla y sigue el uso.
- [Formularios](/es/guide/formularios): WhatsApp Flows nativos.
- [Servidor de webhooks](/es/guide/servidor): monta el provider con `@botmesh/server`.
- [README del paquete](https://github.com/andresayac/botmesh/tree/main/packages/meta-provider)
