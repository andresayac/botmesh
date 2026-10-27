# Messenger

Facebook Messenger a través del Send API de Graph, con la misma verificación
de webhook que la Cloud API.

## Instalación

```bash
pnpm add @botmesh/core @botmesh/messenger
```

## Uso

```ts
import { MessengerProvider } from '@botmesh/messenger'

const provider = new MessengerProvider({
  accessToken: process.env.FB_PAGE_TOKEN!, // Page access token (pages_messaging)
  verifyToken: process.env.META_VERIFY_TOKEN!,
  appSecret: process.env.META_APP_SECRET!,
})
```

- Botones y listas nativos; las reacciones llegan pero no se pueden enviar
  (suscribe el webhook a `message_reactions`; `emoji` es el carácter y
  `removed` se marca con `unreact`).
- El texto se limita a 2000 caracteres (`maxTextLength`): el texto más largo
  se divide en varios mensajes, y los trozos de `ctx.stream()` caben en la
  Send API.
- Más de 3 botones (plantilla de botones) o de 10 filas de lista (plantilla
  genérica) rechazan con `UnsupportedContentError` en vez de descartar opciones.
- Cada llamada a la Send API vence tras `requestTimeoutMs` (60 s por defecto).
- No se corta texto: una lista envía su texto antes de la plantilla genérica
  (que no tiene encabezado), y el texto de botones que pasa de los 640
  caracteres de la plantilla sale antes como texto plano.
- Varios adjuntos en un mensaje llegan como un mensaje cada uno (`<mid>`,
  `<mid>#2`…). Un mensaje editado (suscribe `message_edits`) llega de nuevo
  con su id original; `isEditedMessage(ctx)` lo distingue.
- Etiquetas de mensaje: `bot.send(psid, texto, { platformData: { tag: 'HUMAN_AGENT' } })`
  envía fuera de la ventana de 24 horas (también acepta `messaging_type`,
  `notification_type` y `persona_id`).
- Con el bot parado, `ingest()` responde `503`, así que Meta reenvía el
  webhook tras el reinicio.

## Siguientes pasos

- [Canales](/es/guide/canales): elegir un canal, la matriz de capacidades y el contrato común de los canales.
- [Servidor de webhooks](/es/guide/servidor): monta el provider con `@botmesh/server`.
- [README del paquete](https://github.com/andresayac/botmesh/tree/main/packages/messenger-provider)
