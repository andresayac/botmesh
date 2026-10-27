# Evolution API

[Evolution API](https://github.com/EvolutionAPI/evolution-api) v2, un
gateway REST de WhatsApp self-hosted construido sobre Baileys. Salida: REST
con la cabecera `apikey`. Entrada: el webhook de la instancia, autenticado con
un secreto compartido en cabecera o con el `jwt_key` de Evolution (JWT HS256).

## Instalación

```bash
pnpm add @botmesh/core @botmesh/evolution
```

## Uso

```ts
import { EvolutionProvider } from '@botmesh/evolution'

const provider = new EvolutionProvider({
  baseUrl: 'http://localhost:8080',
  apiKey: process.env.EVOLUTION_API_KEY!,
  instance: 'my-instance',
  webhookSecret: process.env.EVOLUTION_WEBHOOK_SECRET!, // or webhookJwtKey
})
// POST /webhook/evolution → res.sendStatus(provider.ingest(body, headers))
```

- `start()` comprueba la instancia; si no está vinculada, el QR o el código
  de emparejamiento llega en la actualización `connection` (`authPayload`).
- Los gemelos LID/PN que envía Evolution se enlazan antes de emitir; pasa
  `identityPersistence` para mantener los ids estables entre reinicios.
- Encuestas, reacciones, edición (texto), escribiendo y confirmaciones de
  lectura; botones, listas y cards se degradan a texto numerado; `template`
  se rechaza, igual que una encuesta que WhatsApp no puede llevar (menos de 2
  o más de 12 opciones, vacías o repetidas).
- Si Evolution deja de ofrecer códigos QR antes de vincular el número
  (`QRCODE_LIMIT`), la actualización `connection` llega como `closed` con
  motivo `sessionInvalid`: llama otra vez a `start()` para obtener un QR nuevo.
- Deja desactivado `webhookByEvents` en el webhook de la instancia: con él,
  Evolution añade el nombre del evento a la URL y una ruta de path exacto
  responde 404.

## Siguientes pasos

- [Canales](/es/guide/canales): elegir un canal, la matriz de capacidades y el contrato común de los canales.
- [WPPConnect](/es/guide/wppconnect): el otro gateway self-hosted, que comparte `@botmesh/wa-gateway-kit`.
- [Servidor de webhooks](/es/guide/servidor): monta el provider con `@botmesh/server`.
- [README del paquete](https://github.com/andresayac/botmesh/tree/main/packages/evolution-provider)
