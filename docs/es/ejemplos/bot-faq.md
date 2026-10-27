# Bot de FAQ

Construye un bot que responde preguntas frecuentes a partir de palabras
clave, sin importar mayúsculas ni tildes, y lo dice cuando no sabe algo.

**Nivel:** Principiante · **Etiquetas:** WhatsApp, Telegram, Triggers

**Funciones que muestra:** [triggers de texto con coincidencia normalizada](/es/guide/conceptos#when-respuestas-simples) ·
[listas de palabras clave](/es/guide/conceptos#when-respuestas-simples) ·
[coincidencia `contains`](/es/guide/conceptos#when-respuestas-simples) ·
[triggers regex](/es/guide/conceptos#when-respuestas-simples) ·
[precedencia de triggers](/es/guide/triggers#precedencia) ·
[catch-all](/es/guide/conceptos#el-evento-message-vs-onmessage)

## Requisitos previos

Node.js 22.12 o superior y una carpeta con `"type": "module"` (ver
[Inicio rápido](/es/guide/inicio#requisitos)). Después instala:

```bash
npm install @botmesh/core @botmesh/baileys
```

## El bot completo

```js
// bot.js
import { Bot, defineBot, isMainModule } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

// Cada respuesta con las frases que llevan a ella
const FAQ = [
  { ask: ['horario', 'horarios', 'a que hora abren'], answer: '🕘 De lunes a sábado, de 9:00 a 19:00.' },
  { ask: ['direccion', 'donde estan', 'ubicacion'], answer: '📍 Calle Mayor 42, en el centro.' },
  { ask: ['precios', 'precio', 'cuanto cuesta'], answer: '💲 Café $2 · Pastel $4 · Combo $5' },
]

const createBot = defineBot((provider) => {
  const bot = new Bot({ provider, lang: 'es' })

  // Mensaje completo, normalizado: "HORARIO", "Horario " y "hórario" coinciden con 'horario'
  for (const { ask, answer } of FAQ) bot.when(ask, (ctx) => ctx.reply(answer))

  bot.when(['ayuda', 'faq', 'menu'], (ctx) =>
    ctx.reply('❓ Pregúntame por: horario · dirección · precios · domicilio\nO envía un número de pedido como #1234.'),
  )

  // `contains`: la palabra en cualquier parte del mensaje
  bot.when({ pattern: 'domicilio', match: 'contains' }, (ctx) =>
    ctx.reply('🛵 Llevamos a domicilio a 3 km a la redonda. Gratis en pedidos de más de $10.'),
  )

  // Una regex: un número de pedido como #1234
  bot.when(/#\d{4,}/, (ctx) => ctx.reply(`📦 El pedido ${/#\d{4,}/.exec(ctx.body)[0]} va en camino.`))

  // Solo corre si ningún trigger de arriba coincidió
  bot.onMessage((ctx) => ctx.reply('🤷 Eso todavía no lo sé. Envía "ayuda" para ver los temas.'))

  return bot
})

export default createBot

// `node bot.js` conecta con WhatsApp; `npx botmesh dev bot.js` se salta este bloque
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'faq-bot' }))
  bot.on('ready', () => console.log('✅ Conectado. Escribe "ayuda" desde otro teléfono.'))
  await bot.start()
}
```

## Transcripción de ejemplo

Capturada con `npx botmesh dev bot.js`:

```text
user › ayuda
bot › ❓ Pregúntame por: horario · dirección · precios · domicilio
      O envía un número de pedido como #1234.
user › HORÁRIO
bot › 🕘 De lunes a sábado, de 9:00 a 19:00.
user › dónde están
bot › 📍 Calle Mayor 42, en el centro.
user › ¿Dónde están?
bot › 🤷 Eso todavía no lo sé. Envía "ayuda" para ver los temas.
user › tienen domicilio a mi barrio
bot › 🛵 Llevamos a domicilio a 3 km a la redonda. Gratis en pedidos de más de $10.
user › ¿qué pasa con el #20931?
bot › 📦 El pedido #20931 va en camino.
user › horario por favor
bot › 🤷 Eso todavía no lo sé. Envía "ayuda" para ver los temas.
```

## Cómo funciona

- **Igualdad normalizada.** Un trigger de texto coincide con el mensaje
  **completo** tras pasarlo a minúsculas, quitar tildes y colapsar
  espacios, así que "HORÁRIO" coincide con `horario` (y "dónde están" con
  `donde estan`), pero "horario por favor" no: cae en el catch-all. Así las
  palabras cortas no se disparan dentro de frases que no tienen que ver.
- **La puntuación cuenta.** "¿Dónde están?" no es "donde estan", así que lo
  responde el catch-all. Añade la variante a la lista (`'¿donde estan?'`) o
  usa una regex como `/^¿?d[oó]nde est[aá]n\??$/i` si tus usuarios la escriben.
- **Listas.** `bot.when(['horario', 'horarios'], ...)` coincide con
  cualquier entrada; el bucle registra un handler por entrada de la FAQ.
- **`contains`.** `{ pattern: 'domicilio', match: 'contains' }` coincide con
  la palabra en cualquier parte; también existen `startsWith` y `endsWith`.
- **Regex.** `/#\d{4,}/` encuentra un número de pedido en cualquier frase.
- **Precedencia.** Si varios triggers coinciden, gana el más específico:
  texto exacto, después `startsWith`, `endsWith`, regex, `contains` y, al
  final, el catch-all.

## Ejecutarlo en WhatsApp o Telegram

`node bot.js` muestra un QR: escanéalo en WhatsApp → Dispositivos
vinculados. Para Telegram, instala `@botmesh/telegram` y cambia el provider
como se muestra en [O conectar Telegram](/es/guide/inicio#o-conectar-telegram);
la factory no cambia.

## Siguientes pasos

- [Bot de menú](./bot-menu): guía al usuario con un menú numerado en vez de palabras clave
- [Triggers especiales](/es/guide/triggers): reacciona a imágenes, ubicaciones o llamadas
- [Plugin de IA](/es/guide/ai): responde preguntas libres con un modelo
