# Gupshup

Gupshup WhatsApp API: endpoints de envío v1 y callbacks v2. Gupshup no firma
los callbacks, así que se autentican con un token compartido en la URL del
callback (o en una cabecera).

## Instalación

```bash
pnpm add @botmesh/core @botmesh/gupshup
```

## Uso

```ts
import { GupshupProvider } from '@botmesh/gupshup'

const provider = new GupshupProvider({
  apiKey: process.env.GUPSHUP_API_KEY!,
  appName: 'MyBotApp',
  source: '917834811114',                          // the app's number
  webhookToken: process.env.GUPSHUP_WEBHOOK_TOKEN!, // callback: …/gupshup?token=<it>
})
// POST /gupshup → res.sendStatus(provider.ingestRequest({ url: req.originalUrl, body, headers }))
```

- Los botones salen como quick replies (hasta 3), después como lista (hasta
  10) y después como texto numerado; las listas son nativas hasta 10 filas. El
  botón de la lista de los botones degradados usa `listButtonText` (por defecto
  `'Options'`, máximo 20 caracteres; `'Opciones'` para un bot en español).
  Las etiquetas más largas se recortan a los límites de WhatsApp (títulos de
  20/24 caracteres) en vez de ser rechazadas.
- Con `@botmesh/server`, monta el provider como una ruta: el ingress pasa la
  URL de la petición a `ingest()`, así que el callback con `?token=` funciona
  tal cual.
- Usa un `webhookToken` seguro para URL (`openssl rand -hex 32`). Un secreto
  base64 pegado tal cual en `?token=` también coincide (un `+` literal no se
  lee como espacio), igual que su forma codificada con `%`.
- `chatId` = los dígitos del teléfono del remitente (sin `+`), justo lo que
  espera la API de envío.
- Media solo desde URLs públicas. Gupshup también documenta restringir por
  IP: haz ambas cosas en producción.

## Siguientes pasos

- [Canales](/es/guide/canales): elegir un canal, la matriz de capacidades y el contrato común de los canales.
- [Ventana de 24 h y costos](/es/guide/ventana-24h): plantillas fuera de la ventana de WhatsApp.
- [Servidor de webhooks](/es/guide/servidor): monta el provider con `@botmesh/server`.
- [README del paquete](https://github.com/andresayac/botmesh/tree/main/packages/gupshup-provider)
