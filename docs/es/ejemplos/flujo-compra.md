# Flujo de compra

Construye una tienda pequeña: elige producto y cantidad en menús
numerados, confirma, escribe la dirección en un sub-flujo reutilizable, o
vuelve atrás y empieza de nuevo.

**Nivel:** Intermedio · **Etiquetas:** WhatsApp, Telegram, Flujos

**Funciones que muestra:** [menús `.choose()`](/es/guide/flujos#metodos-del-dsl) ·
[sub-flujos con `then`](/es/guide/flujos#metodos-del-dsl) ·
[`goto`](/es/guide/flujos#metodos-del-dsl) ·
[`c.state`](/es/guide/flujos#estado-tipado) ·
[`.timeout()` y `timeoutMessage`](/es/guide/flujos#metodos-del-dsl) ·
[`bot.lint()`](/es/guide/inspeccion-flujos)

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
import { Bot, defineBot, flow, isMainModule, slashCommandsPlugin } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

const PRODUCTOS = {
  movil: { label: '📱 Móvil ($599)', price: 599 },
  camisa: { label: '👕 Camisa ($25)', price: 25 },
  lampara: { label: '🏠 Lámpara ($35)', price: 35 },
}

const createBot = defineBot((provider) => {
  const bot = new Bot({
    provider,
    lang: 'es',
    // Se envía cuando vence una espera del flujo
    conversation: { timeoutMessage: '⏰ Tu carrito caducó. Envía "comprar" para empezar de nuevo.' },
  })
  bot.plug(slashCommandsPlugin)

  // Un sub-flujo reutilizable: corre en línea desde la confirmación y vuelve
  const direccion = flow([]).ask('🏠 ¿Calle y número?', 'street').ask('🏙️ ¿Ciudad?', 'city')

  bot.use(
    flow('comprar')
      .timeout('2m')
      .choose('🛒 *¿Qué quieres comprar?*', {
        movil: PRODUCTOS.movil.label,
        camisa: PRODUCTOS.camisa.label,
        lampara: PRODUCTOS.lampara.label,
      }, 'product')
      .choose('¿Cuántas unidades?', { una: '1 unidad', dos: '2 unidades', tres: '3 unidades' }, 'qty')
      .say((_ctx, c) => {
        const cantidad = { una: 1, dos: 2, tres: 3 }[c.state.qty]
        const producto = PRODUCTOS[c.state.product]
        c.state.total = cantidad * producto.price
        return `🧾 ${cantidad} × ${producto.label} = $${c.state.total}`
      })
      .choose('¿Confirmas el pedido?', {
        si: { label: 'Sí ✅', then: direccion },
        cambiar: { label: '⬅️ Elegir otro producto', goto: 'comprar' },
      })
      .say((_ctx, c) => `📦 Pedido hecho: $${c.state.total}, envío a ${c.state.street}, ${c.state.city}.`),
  )

  bot.onMessage((ctx) => ctx.reply('Envía "comprar" para empezar.'))

  return bot
})

export default createBot

// `node bot.js` conecta con WhatsApp; `npx botmesh dev bot.js` se salta este bloque
if (isMainModule(import.meta)) {
  const bot = await createBot(new BaileysProvider({ session: 'shop-bot' }))
  bot.on('ready', () => console.log('✅ Conectado. Escribe "comprar" desde otro teléfono.'))
  await bot.start()
}
```

## Transcripción de ejemplo

Capturada con `npx botmesh dev bot.js`:

```text
user › comprar
bot › 🛒 *¿Qué quieres comprar?*

      1) 📱 Móvil ($599)
      2) 👕 Camisa ($25)
      3) 🏠 Lámpara ($35)
user › 1
bot › ¿Cuántas unidades?

      1) 1 unidad
      2) 2 unidades
      3) 3 unidades
user › 2
bot › 🧾 2 × 📱 Móvil ($599) = $1198
bot › ¿Confirmas el pedido?

      1) Sí ✅
      2) ⬅️ Elegir otro producto
user › 2
bot › 🛒 *¿Qué quieres comprar?*

      1) 📱 Móvil ($599)
      2) 👕 Camisa ($25)
      3) 🏠 Lámpara ($35)
user › 2
bot › ¿Cuántas unidades?

      1) 1 unidad
      2) 2 unidades
      3) 3 unidades
user › 3
bot › 🧾 3 × 👕 Camisa ($25) = $75
bot › ¿Confirmas el pedido?

      1) Sí ✅
      2) ⬅️ Elegir otro producto
user › 1
bot › 🏠 ¿Calle y número?
user › Calle Falsa 123
bot › 🏙️ ¿Ciudad?
user › Springfield
bot › 📦 Pedido hecho: $75, envío a Calle Falsa 123, Springfield.
```

## Cómo funciona

- **`.choose(texto, opciones, clave)`** envía un menú numerado, acepta el
  número, la clave o la etiqueta, y guarda la **clave** elegida en
  `c.state[clave]`. Sin clave va a `c.state.choice`.
- **`then: direccion`** ejecuta el flujo `direccion` en línea al elegir
  "Sí"; comparte `c.state`, así que el último `.say()` lee `street` y
  `city`. `flow([])` no tiene trigger: solo corre desde aquí.
- **`goto: 'comprar'`** sale del flujo actual y arranca el indicado (aquí,
  la misma tienda desde el principio). `bot.lint()` marca como error
  (`goto-target-missing`) un `goto` a un flujo que no está registrado.
- **Un `.say()` con función** puede calcular y guardar valores
  (`c.state.total`) para los pasos siguientes.
- **`.timeout('2m')`** se aplica a cada espera del flujo; cuando vence, el
  bot envía `conversation.timeoutMessage`. Un sub-flujo `then` usa su propio
  `.timeout()` (o el valor por defecto del bot).

## Ejecutarlo en WhatsApp o Telegram

`node bot.js` muestra un QR: escanéalo en WhatsApp → Dispositivos
vinculados. Para Telegram, instala `@botmesh/telegram` y cambia el provider
como se muestra en [O conectar Telegram](/es/guide/inicio#o-conectar-telegram);
la factory no cambia.

## Siguientes pasos

- [Soporte con timeout](./flujo-soporte): `bot.conversation()` con control total
- [Bot de menú](./bot-menu): botones nativos donde el canal los tiene
- [Inspeccionar y validar flujos](/es/guide/inspeccion-flujos): revisa los flujos antes de ejecutarlos
