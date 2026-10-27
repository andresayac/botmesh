# Email

Email: **IMAP IDLE** para recibir y **SMTP** para responder. Cada hilo de
correo es un chat, así que los flujos con `ask()` continúan cuando el cliente
responde al email. `imapflow` y `nodemailer` son peer dependencies opcionales
que se cargan de forma lazy.

## Instalación

```bash
pnpm add @botmesh/core @botmesh/email
```

## Uso

```ts
import { EmailProvider } from '@botmesh/email'

const provider = new EmailProvider({
  address: 'support@acme.com',
  imap: { host: 'imap.example.com', user: 'support@acme.com', pass: process.env.IMAP_PASS! },
  smtp: { host: 'smtp.example.com', user: 'support@acme.com', pass: process.env.SMTP_PASS! },
})
```

- `threading: 'thread'` (por defecto, un chat por hilo) o `'sender'` (un chat
  por dirección); persiste los hilos con `threadStore: cursorThreadStore(store)`.
  Ese store guarda también el cursor de UID del buzón, así que tras un
  reinicio el bot sigue después del último mensaje que procesó y no vuelve a
  entregar correo (ni siquiera con `markSeen: false`).
- Protección contra bucles de respuestas automáticas y listas de correo,
  gestión de rebotes (eventos `status: 'failed'`, supresión de direcciones con
  rebote permanente).
- El email no autentica `From` por sí mismo: usa
  `requireAuthentication: { authservId }` para aceptar solo correo que tu MTA
  haya autenticado. Las cabeceras hostiles quedan contenidas: se descartan las
  direcciones con caracteres de control, se ignoran los Message-ID enormes y
  se acota la cadena de `References`.
- `secure` es TLS implícito (por defecto salvo en el puerto IMAP 143, y solo
  en el puerto SMTP 465); contra un puerto en texto plano o con STARTTLS,
  `start()`/`send()` rechazan con un mensaje `TLS handshake failed` que dice
  qué opción cambiar.
- Sin IMAP, `ingest(rawMime)` acepta el MIME crudo de un webhook de correo
  entrante y resuelve `{ status, accepted, reason? }`.
- El transporte creado desde `smtp` se cierra en `stop()` y se reconstruye
  en el siguiente envío (también con pool); un `smtpTransport` inyectado es
  tuyo y `stop()` nunca lo cierra.

## Siguientes pasos

- [Canales](/es/guide/canales): elegir un canal, la matriz de capacidades y el contrato común de los canales.
- [Store persistente](/es/guide/store): conserva hilos y el cursor del buzón entre reinicios.
- [README del paquete](https://github.com/andresayac/botmesh/tree/main/packages/email-provider)
