# Baileys (WhatsApp Web)

WhatsApp Web a través de [Baileys](https://github.com/WhiskeySockets/Baileys).
Se vincula con un código QR (o un código de emparejamiento, `pairingPhoneNumber`) y guarda la sesión en
`sessionsDir` (`./sessions/<session>`): los arranques siguientes reconectan sin
QR. Depende de la versión exacta `7.0.0-rc14` de `@whiskeysockets/baileys`
(todavía no hay Baileys 7 estable); el README explica esa fijación y la
política de actualización.

## Instalación

```bash
pnpm add @botmesh/core @botmesh/baileys
```

## Uso

```ts
import { BaileysProvider } from '@botmesh/baileys'

const provider = new BaileysProvider({ session: 'my-bot' })
```

- Socket propio del provider, con reconexión y backoff
  (`reconnect: { maxAttempts, baseMs, capMs }` lo ajusta, `false` lo
  desactiva).
- Las formas LID y número de teléfono de un usuario se unen en un único
  `senderId` estable.
- Sin botones ni listas nativos (WhatsApp Web los retiró): usa menús
  `choose()` o `ctx.poll()`.
- El rate limiting anti-baneo de envíos está activado por defecto
  (`rateLimit`).
- Las reacciones y los borrados llegan como eventos, nunca como mensajes,
  así que un handler comodín o un `ask` abierto no los toman como texto.
  Una **edición de texto** llega como mensaje con el texto nuevo y el
  `ref.id` original, como en Telegram: `isEditedMessage(ctx)` (de
  `@botmesh/baileys`) la distingue y `editedMessages: 'ignore'` descarta las
  ediciones. Solo el autor de un mensaje que el proceso ha visto puede
  editarlo: la edición de un mensaje ajeno, de uno del bot o de un original
  que ya no está en caché se descarta.
- `ctx.voice()` y `ctx.sticker()` aceptan URLs y streams (descargados con los
  mismos controles anti-SSRF que el resto de la media); `ctx.poll()` necesita
  de 2 a 12 opciones distintas.

## Siguientes pasos

- [Canales](/es/guide/canales): elegir un canal, la matriz de capacidades y el contrato común de los canales.
- [Rate limiting (anti-ban)](/es/guide/rate-limiting): el ritmo de envío que viene activado por defecto.
- [Sub-APIs](/es/guide/sub-apis): grupos, perfil y privacidad a través del socket nativo.
- [README del paquete](https://github.com/andresayac/botmesh/tree/main/packages/baileys-provider)
