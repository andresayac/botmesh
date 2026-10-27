# Instagram

DMs de una cuenta profesional de Instagram conectada a una Página de
Facebook (Messenger API for Instagram).

## Instalación

```bash
pnpm add @botmesh/core @botmesh/instagram
```

## Uso

```ts
import { InstagramProvider } from '@botmesh/instagram'

const provider = new InstagramProvider({
  accessToken: process.env.META_PAGE_TOKEN!, // token of the connected Page
  verifyToken: process.env.META_VERIFY_TOKEN!,
  appSecret: process.env.META_APP_SECRET!,
})
```

- Los botones salen como quick replies (como mucho 13, títulos cortados a 20
  caracteres, ids y títulos únicos, sobre un texto no vacío; lo demás rechaza
  con `UnsupportedContentError` en vez de descartar opciones); las listas se
  degradan a texto numerado. Cada petición a la Send API caduca tras
  `requestTimeoutMs` (60 s).
- Solo DMs (sin grupos); las reacciones llegan pero no se pueden enviar.
- El texto se limita a 1000 bytes UTF-8 (`maxTextBytes`, además de
  `maxTextLength` 1000), así que el texto no ASCII cabe menos: el texto más
  largo se divide en varios mensajes por bytes, y los trozos de `ctx.stream()`
  también caben.
- Los adjuntos no llevan pie de foto: el caption de un medio sale como un
  mensaje de texto justo después del adjunto, y la imagen de una tarjeta después
  de su texto (una tarjeta solo con imagen envía la imagen; una sin texto ni
  imagen se rechaza).
- Un DM con varias fotos llega como un mensaje por foto (ids `<mid>`,
  `<mid>#2`, `<mid>#3`…).
- Con el bot parado, `ingest()` responde `503`, así que Meta reenvía el
  webhook tras el reinicio.

## Siguientes pasos

- [Canales](/es/guide/canales): elegir un canal, la matriz de capacidades y el contrato común de los canales.
- [Servidor de webhooks](/es/guide/servidor): monta el provider con `@botmesh/server`.
- [README del paquete](https://github.com/andresayac/botmesh/tree/main/packages/instagram-provider)
