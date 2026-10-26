# Bot de menú

Construye el bot de una pizzería guiado por menús numerados que funcionan
en todos los canales, con botones nativos donde el canal los tiene.

**Nivel:** Principiante · **Etiquetas:** WhatsApp, Telegram, Flujos, Botones

**Funciones que muestra:** [menús numerados con `flow().choose()`](/es/guide/flujos#metodos-del-dsl) ·
[sub-flujos con `then`](/es/guide/flujos#metodos-del-dsl) ·
[`c.state`](/es/guide/flujos#estado-tipado) ·
[`bot.conversation()`](/es/guide/flujos#mas-alla-del-dsl) ·
[botones por transporte](/es/guide/mensajes#botones-normalizados-degradados-por-transporte) ·
[matriz de capacidades](/es/guide/canales#matriz-de-capacidades)

## Requisitos previos

Node.js 22.12 o superior y una carpeta con `"type": "module"` (ver
[Inicio rápido](/es/guide/inicio#requisitos), que también explica las
etiquetas de prerelease). Después instala:

```bash
npm install @botmesh/core @botmesh/baileys
```

## El bot completo

```js
// bot.js
import { Bot, defineBot, flow, isMainModule } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

const PRECIOS = { pequena: 8, mediana: 10, grande: 12 }

const createBot = defineBot((provider) => {
  const bot = new Bot({ provider, lang: 'es' })

  // Un sub-flujo sin trigger propio: lo ejecuta el menú principal
  const pedido = flow([])
    .choose('¿Qué tamaño?', { pequena: 'Pequeña ($8)', mediana: 'Mediana ($10)', grande: 'Grande ($12)' }, 'tamano')
    .choose('¿Qué sabor?', { margarita: 'Margarita', pepperoni: 'Pepperoni', vegetal: 'Vegetal' }, 'sabor')
    .say((_ctx, c) => `✅ Una ${c.state.sabor} ${c.state.tamano}: $${PRECIOS[c.state.tamano]}. ¡Lista en 20 minutos!`)

  // Menú numerado: funciona en todas partes, también en WhatsApp con Baileys
  bot.use(
    flow('menu').choose('🍕 *Pizzería*: ¿qué te apetece?', {
      pedir: { label: 'Pedir una pizza', then: pedido },
      horario: { label: 'Horario', then: (_ctx, c) => c.say('🕘 Todos los días, de 12:00 a 23:00.') },
    }),
  )

  // Botones nativos donde el canal los muestra (Telegram, WhatsApp Cloud API),
  // y la misma pregunta como menú numerado en el resto
  bot.conversation('valorar', async (c, ctx) => {
    const opciones = { genial: '😋 Genial', bien: '🙂 Bien', meh: '😕 Regular' }
    let respuesta
    if (ctx.capabilities?.buttons) {
      await ctx.buttons('¿Qué tal tu pizza?', Object.entries(opciones).map(([id, title]) => ({ id, title })))
      respuesta = (await c.waitAny()).body // un toque llega como un mensaje cuyo texto es el id del botón
    } else {
      respuesta = await c.choose('¿Qué tal tu pizza?', opciones)
    }
    await ctx.reply(Object.hasOwn(opciones, respuesta) ? `¡Gracias por tu valoración: ${opciones[respuesta]}!` : '¡Gracias por tu opinión!')
  })

  bot.onMessage((ctx) => ctx.reply('Envía "menu" para pedir o "valorar" para valorarnos.'))

  return bot
})

export default createBot

// `node bot.js` conecta con WhatsApp; `npx botmesh dev bot.js` se salta este bloque
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'menu-bot' }))
  bot.on('ready', () => console.log('✅ Conectado. Escribe "menu" desde otro teléfono.'))
  await bot.start()
}
```

## Transcripción de ejemplo

Capturada con `npx botmesh dev bot.js`. El simulador muestra botones
nativos, así que `valorar` los enseña; `:click 1` toca el primero:

```text
user › menú
bot › 🍕 *Pizzería*: ¿qué te apetece?

      1) Pedir una pizza
      2) Horario
user › 1
bot › ¿Qué tamaño?

      1) Pequeña ($8)
      2) Mediana ($10)
      3) Grande ($12)
user › 7
bot › ¿Qué tamaño?

      1) Pequeña ($8)
      2) Mediana ($10)
      3) Grande ($12)
user › 2
bot › ¿Qué sabor?

      1) Margarita
      2) Pepperoni
      3) Vegetal
user › pepperoni
bot › ✅ Una pepperoni mediana: $10. ¡Lista en 20 minutos!
user › menu
bot › 🍕 *Pizzería*: ¿qué te apetece?

      1) Pedir una pizza
      2) Horario
user › 2
bot › 🕘 Todos los días, de 12:00 a 23:00.
user › valorar
bot › ¿Qué tal tu pizza?
        [1] 😋 Genial
        [2] 🙂 Bien
        [3] 😕 Regular
      (:click <n> to choose)
user › :click 1
• tapped "😋 Genial"
bot › ¡Gracias por tu valoración: 😋 Genial!
```

## Cómo funciona

- **`.choose(texto, opciones, clave)`** envía un menú numerado y espera. El
  usuario responde con el número, la clave o la etiqueta ("pepperoni");
  cualquier otra cosa reenvía el menú. La **clave** elegida queda en
  `c.state[clave]`.
- **`then`** corre cuando se elige esa opción: un flujo entero (`pedido`,
  que se ejecuta en línea y vuelve) o una función como
  `(_ctx, c) => c.say(...)`. `flow([])` no tiene trigger, así que solo corre
  desde el menú.
- **Botones.** WhatsApp Web dejó de soportar los botones nativos, así que en
  Baileys `ctx.buttons()` llegaría como una lista numerada que el usuario
  responde con un número. `ctx.capabilities?.buttons` indica si el canal los
  muestra; un toque llega como un mensaje `buttons` cuyo texto es el `id` del
  botón, por eso lo recibe `c.waitAny()` (`c.waitText()` solo acepta texto
  escrito, y el usuario aún puede escribir en vez de tocar). En el resto,
  `c.choose()` hace la misma pregunta como menú numerado.
- **Salida de emergencia.** Añade [`slashCommandsPlugin`](/es/guide/plugins#incluido-slashcommands)
  y `/cancel` sale de cualquier menú: los comandos siempre ganan a una
  conversación activa.

## Ejecutarlo en WhatsApp o Telegram

`node bot.js` muestra un QR: escanéalo en WhatsApp → Dispositivos
vinculados (los menús salen numerados). En Telegram, instala
`@botmesh/telegram` y cambia el provider como se muestra en
[O conectar Telegram](/es/guide/inicio#o-conectar-telegram): `valorar`
muestra entonces un teclado inline.

## Siguientes pasos

- [Flujo de compra](./flujo-compra): ramas con `goto` y una opción "volver al menú"
- [Bot de encuestas](./bot-encuesta): encuestas nativas en WhatsApp y Telegram
- [Flujos conversacionales](/es/guide/flujos): todo el DSL de flujos
