# WPPConnect

[WPPConnect Server](https://github.com/wppconnect-team/wppconnect-server), un
gateway self-hosted sobre WhatsApp Web (WA-JS). REST con token Bearer;
webhooks autenticados con un token en la URL del webhook.

## Instalación

```bash
pnpm add @botmesh/core @botmesh/wppconnect
```

## Uso

```ts
import { WPPConnectProvider } from '@botmesh/wppconnect'

const provider = new WPPConnectProvider({
  baseUrl: 'http://localhost:21465',
  session: 'my-bot',
  secretKey: process.env.WPP_SECRET_KEY!,       // or token: '<generated bearer>'
  webhookToken: process.env.WPP_WEBHOOK_TOKEN!, // webhook URL: …/webhooks/wpp?token=<it>
})
// POST /webhooks/wpp → res.sendStatus(await provider.ingest(body, headers, req.originalUrl))
```

- `ingest()` es **asíncrono** y recibe la URL de la petición como tercer
  argumento, porque wppconnect-server no puede añadir cabeceras: el token
  viaja en la query string.
- Los LID desconocidos se resuelven a número de teléfono (`contact/pn-lid`)
  antes de emitir.
- `markRead` marca el chat entero como leído; botones y listas se degradan a
  texto numerado.
- La conexión sigue los webhooks `status-find` del servidor: `isLogged` /
  `qrReadSuccess` → `ready`, `notLogged` y `qrcode` → `authenticating`, y
  desvincular el dispositivo desde el teléfono (`disconnectedMobile`) →
  `closed` con `sessionInvalid`. `bot.stop()` no cierra la sesión en el
  servidor.

## Siguientes pasos

- [Canales](/es/guide/canales): elegir un canal, la matriz de capacidades y el contrato común de los canales.
- [Evolution API](/es/guide/evolution): el otro gateway self-hosted, que comparte `@botmesh/wa-gateway-kit`.
- [Servidor de webhooks](/es/guide/servidor): monta el provider con `@botmesh/server`.
- [README del paquete](https://github.com/andresayac/botmesh/tree/main/packages/wppconnect-provider)
