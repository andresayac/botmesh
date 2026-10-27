# Solución de problemas

Los errores más frecuentes, qué significan y cómo resolverlos. Busca en esta página el mensaje exacto que ves (la mayoría de los errores de botmesh nombran la opción o el paquete implicado).

## Instalación

### `ERR_PNPM_IGNORED_BUILDS` o "native module was never built"

pnpm 10 y posteriores no ejecutan los scripts de instalación de las dependencias hasta que decides cuáles pueden correr. pnpm 11 detiene la instalación con `ERR_PNPM_IGNORED_BUILDS`; pnpm 10 instala sin ellos y el fallo aparece después.

Decide una vez en `pnpm-workspace.yaml` (o ejecuta `pnpm approve-builds`) y reinstala:

```yaml
allowBuilds:
  better-sqlite3: true # binario nativo de @botmesh/sqlite-store: debe ejecutarse
  '@whiskeysockets/baileys': false # solo comprueba la versión de Node.js
  protobufjs: false # solo muestra un aviso de versión
  ffmpeg-static: true # solo si lo instalaste para las notas de voz de Baileys
```

En pnpm 10 el equivalente es `onlyBuiltDependencies: [better-sqlite3]`. Si `better-sqlite3` se saltó su script, `SQLiteStore` lanza `better-sqlite3 is installed but its native module was never built`. npm ejecuta todos los scripts de instalación, así que no necesita nada de esto.

### El proceso aborta con `Assertion failed: (env) != nullptr`

Usas Node.js 24.19 o posterior con `better-sqlite3` 11 o 12. Una regresión de Node.js ([nodejs/node#65446](https://github.com/nodejs/node/issues/65446)) puede abortar el proceso en `RemoveEnvironmentCleanupHook` cuando el recolector libera una sentencia preparada. Instala `better-sqlite3` 13, que usa N-API y no está afectado:

```bash
pnpm add better-sqlite3@^13
```

### "built for another Node.js version" / `NODE_MODULE_VERSION`

Un módulo nativo (casi siempre `better-sqlite3`) se compiló para el Node.js que tenías antes de actualizar. Recompílalo con el Node.js que ejecuta el bot:

```bash
pnpm rebuild better-sqlite3
```

### `ERR_REQUIRE_ESM` o `require is not defined`

botmesh es solo ESM. Usa `import` y añade `"type": "module"` a tu `package.json` (o usa archivos `.mjs`). Con TypeScript, configura `"module": "nodenext"`.

### `pnpm add @botmesh/core` instala una build anterior

Justo después de una publicación, una instalación sin tag puede seguir obteniendo la beta anterior hasta que se mueve `latest`, y un proyecto que mezcla builds puede fallar por exports que faltan o rangos de peers. Revisa los tags con `pnpm view @botmesh/core dist-tags` e instala la beta más reciente con el tag, por ejemplo `pnpm add @botmesh/core@beta @botmesh/baileys@beta`. Mira [Paquetes y versiones](./paquetes#dist-tags-de-npm).

## WhatsApp Web (Baileys)

### La conexión se cierra con `428` antes de que aparezca el QR

WhatsApp cierra con `428 Connection Terminated` las conexiones que usan un handshake antiguo. Revisa dos cosas:

1. Que `@whiskeysockets/baileys` resuelva a `7.0.0-rc14` o posterior en tu lockfile (`pnpm why @whiskeysockets/baileys`). `@botmesh/baileys` fija una versión que funciona; un override o un lockfile viejo pueden traer otra anterior.
2. Que no pases una tupla `browser` propia. Deja `browser` sin definir (o usa un preset como `'macOS'`): las identidades no estándar pueden recibir `428`.

El provider también necesita llegar a `wss://web.whatsapp.com` y, al arrancar, a `raw.githubusercontent.com` (para leer la versión actual de WhatsApp Web).

### El QR no aparece

Imprímelo en la terminal o guárdalo como PNG, o maneja tú el evento `qr`:

```ts
const provider = new BaileysProvider({ session: 'mi-bot', qr: { terminal: true, file: './qr.png' } })
bot.on('qr', (artifact) => console.log('Escanea o escribe esto:', artifact)) // un QR o un código de emparejamiento
```

Para vincular sin QR, pasa `pairingPhoneNumber: '+57300…'` y escribe el código que llega en el evento `qr` en WhatsApp → Dispositivos vinculados.

### El bot pide un QR nuevo o deja de reconectar

El provider informa el motivo en el evento `connection`:

| `reason` | Qué pasó | Qué hacer |
| --- | --- | --- |
| `sessionInvalid` | Desvinculaste el dispositivo desde el teléfono o los archivos de sesión están dañados. El provider borra la carpeta de esa sesión. | Escanea el QR nuevo. |
| `sessionTakenOver` | Otro proceso usa la misma sesión, o WhatsApp lo prohibió. El provider **no** reconecta, para proteger el número. | Detén la otra instancia (un deploy viejo, otra terminal) y arranca de nuevo. |
| `transient` | Una caída de red. El provider reintenta con backoff (hasta 10 intentos por defecto). | Nada; ajusta `reconnect: { maxAttempts, baseMs, capMs }` si hace falta. |

### La misma persona aparece con dos ids, o un flujo deja de esperar la respuesta

WhatsApp identifica a las personas por número de teléfono (**PN**, `…@s.whatsapp.net`) y por un id opaco (**LID**, `…@lid`), y la forma puede cambiar entre mensajes. `@botmesh/baileys` lo resuelve antes de que el bot vea el mensaje: `ctx.sender` y `ctx.from` usan el PN cuando se conoce y, si no, el LID; los valores crudos están en `ctx.senderInfo.platformData` (`phoneNumber`, `lid`).

- **Nunca guardes datos con claves de `ctx.raw`** (el `remoteJid` crudo): usa `ctx.sender` / `ctx.from`.
- **Una persona que solo tiene LID** (usuarios con nombre de usuario de WhatsApp) conserva un id LID estable; `platformData.phoneNumber` es `undefined`. No supongas que `ctx.sender` es un teléfono.
- **Si el PN se aprende a mitad de una conversación**, la persona pasa al id PN y una conversación iniciada con el LID deja de recibir sus mensajes. Ponle `.timeout()` a los flujos (o `timeout` a `c.ask`) para que se cierre sola, y guarda `platformData.phoneNumber` y `platformData.lid` si mantienes registros por persona.
- **Las listas de acceso comparan ids exactos**: añade el id completo (`573001234567@s.whatsapp.net`, o el id `@lid`), no un número suelto. Construye ids con `toJid('+57 300 123 4567')`.

### Los envíos fallan por rate limit o las respuestas tardan

El provider de Baileys encola los envíos en un token bucket (5 por chat cada 10 s y 50 en total por minuto por defecto) para reducir el riesgo de baneo. Un envío que espera más de `rateLimit.maxWait` (30 s) se rechaza con `RateLimitedError`. Reparte los envíos masivos con `bot.broadcast()` (lotes, pausas, reintentos) en lugar de un bucle de `bot.send()`. Mira [Rate limiting](./rate-limiting).

## WhatsApp Cloud API, Messenger e Instagram

### La firma del webhook no coincide (403)

Si todos los webhooks reciben `403`, falló la comprobación de `X-Hub-Signature-256`. Meta firma exactamente los bytes que envía, así que:

- Pasa el **body crudo** a `provider.ingest(body, headers)`: `express.raw({ type: 'application/json' })`, el `Buffer` que juntas con `node:http` o el body crudo de tu framework. Un body parseado por `express.json()` y vuelto a serializar nunca coincide (con `appSecret`, un objeto ya parseado recibe `400`).
- Usa el **App Secret** de la app dueña del webhook (Configuración de la app → Básica), no el access token ni el verify token.
- No pongas delante del endpoint un proxy que reescriba el body (compresión, JSON reformateado).

Solo para pruebas locales, `allowUnsignedWebhooks: true` desactiva la comprobación.

### Meta no puede verificar la URL del webhook

El handshake `GET` compara `hub.verify_token` con el `verifyToken` del provider. Responde con `provider.verifyChallenge(req.query)` y con `403` cuando devuelve `null`. La URL debe ser HTTPS pública (usa un túnel como `cloudflared` o `ngrok` en desarrollo).

### `OutsideSessionWindowError`

Pasaron más de 24 horas desde el último mensaje del usuario y Meta solo acepta plantillas aprobadas. Envía un `{ kind: 'template', … }` o deja que el `sessionWindow` del provider reabra la conversación por ti. Mira [Ventana de 24 h de WhatsApp](./ventana-24h).

### `RecipientUnreachableError` con un número de prueba

Un número de prueba solo puede escribir a los números de la lista "Para" de la configuración de la API en el panel de Meta (código Graph `131030`). Añade ahí el destinatario.

### "the access token is invalid or expired" / "check the configured phone number id"

El código Graph `190` es un access token inválido o caducado: usa un token permanente de usuario del sistema con `whatsapp_business_messaging`. El código `100`/`33` indica que el `phoneNumberId` no existe o que el token no tiene acceso: copia el **id del número de teléfono** de la configuración de la API (no es el número).

### Rate limits (`130429`, `131056`, `80007`…)

Llegan como `RateLimitedError` con `retryAfterMs`. Una espera corta en un envío de `ctx` se reintenta una vez (`BotConfig.rateLimitRetry`), y `bot.broadcast()` reintenta por chat (`retries`, 3 por defecto). Para tráfico masivo, baja `concurrency` y añade `delayBetween`.

## Telegram

### `409 Conflict` y el bot deja de recibir updates

Dos procesos hacen polling con el mismo token (o hay un webhook configurado mientras haces polling). El provider se detiene a propósito (`sessionTakenOver`). Detén la otra instancia, o borra el webhook con `deleteWebhook` antes de usar long polling.

### "check the bot token and baseUrl" (404)

El token está mal formado (cópialo de nuevo desde @BotFather) o `baseUrl` apunta a una ruta equivocada.

### El webhook responde `401`

La cabecera `X-Telegram-Bot-Api-Secret-Token` no coincide con `webhookSecret`. Pasa el mismo valor como `secret_token` a `setWebhook`.

## El bot

### `BotNotRunningError: bot is not running`

Enviaste, editaste o borraste un mensaje antes de `await bot.start()` o después de `bot.stop()`. Programa los envíos proactivos desde `bot.on('ready', …)` o después de que `start()` resuelva.

### `ConfigValidationError: Invalid config.<opción>`

Una opción de `new Bot()` tiene un tipo incorrecto o una duración inválida. El mensaje nombra la opción (`err.field`); las duraciones aceptan un string (`'30s'`, `'5m'`) o milisegundos.

### `Plugin "<nombre>" is already plugged on this bot`

Cada nombre de plugin se puede enchufar una vez. Desenchúfalo primero con la función que devolvió `bot.plug()`, o pon `multiple: true` en el spec de cada instancia.

### `bot.when('hola')` no coincide con "hola a todos"

Los triggers de texto comparan por **igualdad normalizada** (se ignoran mayúsculas, tildes y espacios de más), no por "contiene". Usa `{ pattern: 'hola', match: 'contains' }` o una `RegExp`. Mira [Triggers especiales](./triggers).

### El bot no responde en grupos

Revisa `groupMode` (`'mentions'` y `'commands'` limitan lo que el bot responde en grupos) y el `scope` del trigger. En grupos, las conversaciones son por participante por defecto.

### Los textos integrados salen en inglés

Los textos de timeouts, reintentos, comandos slash y formularios están en inglés por defecto. Usa `new Bot({ lang: 'es' })` para tenerlos en español, o registra los tuyos con `bot.locale()`. Mira [Internacionalización](./i18n).

### Un flujo `.persistent()` olvida dónde estaba tras reiniciar

El `MemoryStore` por defecto vive en RAM. Usa un store durable (`@botmesh/sqlite-store`, `@botmesh/redis-store` o `new MemoryStore({ file })`). Mira [Store persistente](./store).

## ¿Sigues atascado?

- Activa los logs de depuración: `new Bot({ provider, logger: pino({ level: 'debug' }) })`. Los ids de chat y remitente salen hasheados en los logs del bot por defecto (`logIds`).
- Revisa las [preguntas frecuentes](./faq) y el README del paquete de tu canal.
- [Abre un issue](https://github.com/andresayac/botmesh/issues) con el mensaje de error, las versiones de los paquetes (`pnpm ls @botmesh/*`) y tu versión de Node.js. Nunca pegues tokens ni archivos de sesión.
