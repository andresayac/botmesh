# HighLevel (GoHighLevel)

HighLevel (GoHighLevel / LeadConnector) Conversations API. Entrada por el
webhook `InboundMessage` (Ed25519, `X-GHL-Signature`), salida con
`POST /conversations/messages` por el último canal que usó el contacto.

## Instalación

```bash
pnpm add @botmesh/core @botmesh/gohighlevel
```

## Uso

```ts
import { GoHighLevelProvider } from '@botmesh/gohighlevel'

const provider = new GoHighLevelProvider({
  accessToken: process.env.GHL_TOKEN!,         // Private Integration Token
  locationId: process.env.GHL_LOCATION_ID!,
  // defaultChannel: 'SMS',                    // until the contact writes
})
```

- `chatId` = `contactId` de HighLevel: un chat por contacto en todos los
  canales; el canal de cada mensaje está en `ctx.chat.platformData.channel`.
- La clave pública de HighLevel viene incluida (`GHL_WEBHOOK_PUBLIC_KEY`),
  así que no hace falta secreto de webhook. `ingest()` necesita el body
  **crudo**.
- Media solo desde URLs públicas; `template` se traduce a `templateId`.
- El cuerpo HTML de un Email llega como texto plano en `ctx.body`;
  `ctx.raw.body` conserva el HTML y `ctx.chat.platformData.subject` el asunto.

## Siguientes pasos

- [Canales](/es/guide/canales): elegir un canal, la matriz de capacidades y el contrato común de los canales.
- [Servidor de webhooks](/es/guide/servidor): monta el provider con `@botmesh/server`.
- [README del paquete](https://github.com/andresayac/botmesh/tree/main/packages/gohighlevel-provider)
