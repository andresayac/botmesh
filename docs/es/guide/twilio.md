# Twilio

Twilio Programmable Messaging: **WhatsApp y SMS/MMS** con una sola clase.
Webhooks verificados con `X-Twilio-Signature`, que cubre la URL pública
exacta.

## Instalación

```bash
pnpm add @botmesh/core @botmesh/twilio
```

## Uso

```ts
import { TwilioProvider } from '@botmesh/twilio'

const provider = new TwilioProvider({
  accountSid: process.env.TWILIO_SID!,
  authToken: process.env.TWILIO_TOKEN!,           // signs webhooks + REST auth
  whatsappFrom: 'whatsapp:+14155238886',
  smsFrom: '+15017122661',
  webhookUrl: 'https://bot.example.com/twilio/webhook', // EXACT URL set in Twilio
})
```

- `chatId` es el `From` de Twilio tal cual (`whatsapp:+57…` o `+57…`): la
  misma persona por WhatsApp y por SMS son dos chats.
- Texto de hasta 1600 caracteres; media solo desde URLs públicas; botones y
  listas pasan a texto numerado; `template` se traduce a `ContentSid` +
  `ContentVariables`.
- `ingestRequest({ url, body, headers })` para URLs que cambian por petición
  (multi-tenant). Con `webhookPath` (la URL se reconstruye con las cabeceras
  `Host` / `X-Forwarded-*`), pasa la ruta y la query de la petición como
  tercer argumento de `ingest()` (`@botmesh/server` ya lo hace): así la query
  con la que llamó Twilio entra en la URL firmada.
- El error 63016 se traduce a `OutsideSessionWindowError`.
- Un mensaje con varios adjuntos (`NumMedia` > 1, hasta 10) llega como **un
  mensaje por adjunto**, en orden: el primero conserva el `MessageSid` y el
  texto (`Body`); el adjunto `i` lleva el id `MessageSid:i` y cuerpo vacío
  (ids únicos y estables ante reintentos del webhook).

## Siguientes pasos

- [Canales](/es/guide/canales): elegir un canal, la matriz de capacidades y el contrato común de los canales.
- [Ventana de 24 h y costos](/es/guide/ventana-24h): plantillas fuera de la ventana de WhatsApp.
- [Servidor de webhooks](/es/guide/servidor): monta el provider con `@botmesh/server`.
- [README del paquete](https://github.com/andresayac/botmesh/tree/main/packages/twilio-provider)
