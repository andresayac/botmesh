# Discord

Gateway de Discord (WebSocket) para los eventos y REST para enviar.

## Instalación

```bash
pnpm add @botmesh/core @botmesh/discord
```

## Uso

```ts
import { DiscordProvider, GatewayIntents } from '@botmesh/discord'

const provider = new DiscordProvider({ token: process.env.DISCORD_TOKEN! })
// Default intents: Guilds | GuildMessages | MessageContent.
// Add GatewayIntents.DirectMessages to the `intents` bitmask to receive DMs.
```

- Botones, menús de selección, encuestas, reacciones y ediciones nativos;
  `ctx.stream()` edita un mensaje a medida que crece el texto.
- El bot mantiene una reacción por mensaje, como en WhatsApp/Telegram: un
  nuevo `ctx.react(emoji)` reemplaza la anterior y `ctx.react('')` la quita.
  Discord borra reacciones por emoji, así que el provider recuerda el que puso
  (en memoria, `reactionMemory`, 1000 mensajes por defecto); si no lo conoce
  (se puso antes de reiniciar o salió del LRU) rechaza con
  `UnsupportedContentError`.
- Las interacciones tienen un plazo estricto de confirmación
  (`interactionsRequireAck`), así que el core confirma cada una exactamente una
  vez por ti: una confirmación diferida antes del primer envío del handler,
  poco antes del plazo de ~3 s o al terminar el handler, lo que ocurra antes.
  Llama a `ctx.acknowledge('texto')` antes de responder para contestar con un
  texto inmediato; una vez enviada la confirmación automática,
  `ctx.acknowledge('texto')` envía `texto` como respuesta normal y
  `ctx.acknowledge()` no hace nada.
- `ctx.interaction.id` es el id de la interacción a secas: su token no sale
  del provider. Como red de seguridad, el provider también difiere cualquier
  interacción que siga sin respuesta tras `autoAcknowledgeMs` (2000 ms por
  defecto; `false` lo desactiva). Un `ctx.acknowledge('texto')`
  tardío, ya confirmada, sale como followup, con `appId` o, si falta, con el id
  de aplicación que Discord manda en READY y en cada interacción; si no se
  conoce ninguno, la llamada rechaza con `ProviderError` en vez de descartar el
  texto.
- Más de 25 botones (5 filas de 5), 25 opciones de menú o 10 respuestas de
  encuesta rechazan con `UnsupportedContentError` en vez de descartar opciones;
  el texto de más de 2000 caracteres se divide en varios mensajes.
- Cada llamada REST vence tras `requestTimeoutMs` (60 s por defecto); las
  subidas de archivos, tras `uploadTimeoutMs` (5 min).
- Los mensajes de sistema (entradas al servidor, fijados, boosts...) y los de
  bots no se enrutan. Un mensaje sin texto ni archivo llega como `sticker` (con
  la imagen del sticker como media) o `unknown` (solo embeds, o el intent Message
  Content desactivado), nunca como texto vacío.
- Todo mensaje que envía el provider lleva `allowed_mentions` (por defecto
  `{ parse: ['users'] }`, opción `allowedMentions`), así que un texto que el bot
  repite no puede mencionar a `@everyone`, `@here` ni a un rol;
  `SendOptions.mentions`, `platformData.allowed_mentions` y los payloads `native`
  lo sustituyen. Una respuesta citada sigue notificando al autor del mensaje
  citado (`replied_user: true`; `allowedMentions.replied_user: false` responde
  sin notificar).
- Los ids van en las URLs REST codificados, y un id vacío, `.` o `..` rechaza
  con `ProviderError`: un id manipulado nunca llega a otra ruta. Los votos de las
  encuestas nativas no llegan como eventos.
- Un mensaje reenviado trae el texto y la media reenviados (de su snapshot),
  no una respuesta citada; si no tiene nada legible llega como `unknown`. Una
  encuesta nativa llega como `type: 'poll'` con la pregunta como cuerpo.
- **Mensajes editados** (`MESSAGE_UPDATE` con `edited_timestamp`) llegan como
  mensajes con el texto nuevo y el `ref.id` original; `isEditedMessage(ctx)` de
  `@botmesh/discord` los distingue y `editedMessages: 'ignore'` los descarta. Las
  demás actualizaciones (previsualizaciones de enlaces, fijados, flags) no se
  enrutan: el provider entrega una edición una sola vez por `edited_timestamp`
  (recuerda el último de los 1000 mensajes editados más recientes), así que fijar
  un mensaje editado no lo vuelve a entregar.

## Siguientes pasos

- [Canales](/es/guide/canales): elegir un canal, la matriz de capacidades y el contrato común de los canales.
- [Respuestas en streaming](/es/guide/streaming): un mensaje editado a medida que crece el texto.
- [README del paquete](https://github.com/andresayac/botmesh/tree/main/packages/discord-provider)
