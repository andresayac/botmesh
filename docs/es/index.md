---
layout: home

hero:
  name: botmesh
  text: Un bot, todos los canales de chat
  tagline: Un framework en TypeScript para bots de mensajería. Escribe handlers y flujos de conversación una vez, ejecútalos en WhatsApp (Baileys o la Cloud API oficial) y Telegram, y pruébalos en tu terminal sin teléfono.
  actions:
    - theme: brand
      text: Empezar
      link: /es/guide/inicio
    - theme: alt
      text: Tu primer bot
      link: /es/guide/primer-bot
    - theme: alt
      text: Referencia de la API
      link: /api/

features:
  - title: Agnóstico de transporte
    details: |
      Un motor, muchos providers: @botmesh/baileys (WhatsApp Web),
      @botmesh/meta (Cloud API oficial de WhatsApp), @botmesh/telegram,
      @botmesh/messenger, @botmesh/instagram, Discord, Twilio, email y más. Cambiar de
      canal es cambiar una línea.
    icon: 🔌
    link: /es/guide/canales
    linkText: Canales
  - title: Flujos de conversación
    details: |
      flow('registro').ask().choose().say() compila a una conversación
      async real con validación, reintentos, ramas y timeouts. Los flujos
      persistentes sobreviven a un reinicio.
    icon: 🔀
    link: /es/guide/flujos
    linkText: Flujos
  - title: Pruébalo sin teléfono
    details: |
      npx botmesh dev bot.js chatea con tu bot en la terminal, con recarga
      en caliente y sin cuenta, número ni riesgo de baneo.
    icon: 💻
    link: /es/guide/simulador
    linkText: Simulador
  - title: Fácil de probar
    details: |
      createTestBot y MockProvider ejecutan tus flujos en tests unitarios
      sin red. Las transcripciones golden detectan regresiones en
      conversaciones completas.
    icon: ✅
    link: /es/guide/testing
    linkText: Testing
  - title: IA cuando la necesitas
    details: |
      @botmesh/ai responde con Anthropic, OpenAI, Gemini, Ollama o modelos
      compatibles con OpenAI, llama a tus herramientas con confirmación y
      recuerda a cada usuario.
    icon: 🤖
    link: /es/guide/ai
    linkText: Plugin de IA
  - title: Hooks y plugins
    details: |
      Middleware before / after / onError en cada mensaje y envío, y
      plugins reutilizables como los comandos slash integrados.
    icon: 🧩
    link: /es/guide/plugins
    linkText: Plugins
  - title: Stores intercambiables
    details: |
      MemoryStore por defecto; @botmesh/sqlite-store y @botmesh/redis-store
      para persistir, o tu propio IStore.
    icon: 📦
    link: /es/guide/store
    linkText: Stores
  - title: Listo para producción
    details: |
      Dedupe de entrada activo por defecto y un rate limiter anti-baneo en
      Baileys; procesamiento durable, varias réplicas, scheduler durable y
      trazas OpenTelemetry opcionales.
    icon: 🚀
    link: /es/guide/deploy
    linkText: Despliegue
  - title: Tipado de punta a punta
    details: |
      Paquetes ESM escritos en TypeScript: autocompletado y comprobación de
      tipos en cada handler, estado de flujo y plugin. También funciona con
      JavaScript.
    icon: 🔷
---

## Un bot en pocas líneas

```js
import { Bot, flow } from '@botmesh/core'
import { BaileysProvider } from '@botmesh/baileys'

const bot = new Bot({ provider: new BaileysProvider({ session: 'my-bot' }), lang: 'es' })

bot.when('hola', (ctx) => ctx.reply('👋 ¡Hola!'))

bot.use(
  flow('registro')
    .ask('¿Cómo te llamas?', 'name')
    .say((_ctx, c) => `¡Encantado, ${c.state.name}!`),
)

await bot.start() // escanea el QR en WhatsApp → Dispositivos vinculados
```

Cambia `BaileysProvider` por `TelegramProvider` o `CloudAPIProvider` y el resto
del código sigue igual.

## Empieza en cinco minutos

```bash
npm create botmesh my-bot
cd my-bot && npm install
npm run dev        # chatea con él en la terminal
npm start          # conecta WhatsApp o Telegram
```

botmesh está en prerelease y esta documentación describe la próxima versión:
durante la beta, añade el tag (`npm create botmesh@beta my-bot`). Las alphas
anteriores que hay hoy en npm difieren en algunos puntos.
[Inicio rápido](/es/guide/inicio) explica qué versión instalar y cada paso,
incluido montar el proyecto a mano.
