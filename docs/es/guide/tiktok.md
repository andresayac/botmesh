# TikTok

::: warning Experimental: paquete privado
`@botmesh/tiktok` es privado (`"private": true`): no está en npm y su API puede cambiar. Úsalo desde un clon del monorepo (`"workspace:*"`). Ver [Paquetes y versiones](/es/guide/paquetes).
:::

TikTok API for Business (v1.3): **comentarios** en los videos propios de la
cuenta y **mensajes directos** (Business Messaging API, requiere aprobación).
Webhooks verificados con `TikTok-Signature`.

## Instalación

No está en npm: decláralo desde un paquete dentro del monorepo.

```json
{ "dependencies": { "@botmesh/core": "workspace:*", "@botmesh/tiktok": "workspace:*" } }
```

## Uso

```ts
import { TikTokProvider } from '@botmesh/tiktok'

const provider = new TikTokProvider({
  accessToken: process.env.TIKTOK_TOKEN!,             // or an async refresh function
  businessId: process.env.TIKTOK_BUSINESS_ID!,        // open_id of the account
  appSecret: process.env.TIKTOK_APP_SECRET!,          // verifies TikTok-Signature
  selfUniqueIdentifier: process.env.TIKTOK_SELF_UID!, // required to receive comments
})
```

- Chats: `dm:<conversation_id>` (DM), `comment:<video_id>:<comment_id>`
  (hilo de un comentario, un chat de grupo) y `hic:<comment_id>` (comentario
  de alta intención). `ctx.chat.platformData.surface` los distingue.
- DMs: texto (hasta 6000 caracteres), imágenes, tarjetas Q&A para los
  botones (de 1 a 3); comentarios: respuestas de texto de hasta 150
  caracteres. Los botones o listas que no caben en una tarjeta Q&A (más de 3
  opciones, botones con URL, títulos de más de 40 caracteres) y los menús
  enviados a un hilo de comentarios se degradan a un menú de texto numerado,
  como en Baileys.
- El bot no puede iniciar una conversación y TikTok limita los mensajes por
  ventana de 48 h (`OutsideSessionWindowError`).

## Siguientes pasos

- [Canales](/es/guide/canales): elegir un canal, la matriz de capacidades y el contrato común de los canales.
- [Servidor de webhooks](/es/guide/servidor): monta el provider con `@botmesh/server`.
- [README del paquete](https://github.com/andresayac/botmesh/tree/main/packages/tiktok-provider)
