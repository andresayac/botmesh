# Ejemplos

Bots completos que puedes copiar y ejecutar. Cada página tiene un archivo
ejecutable, una explicación paso a paso, una transcripción capturada de una
ejecución real y las guías de cada funcionalidad que muestra. La suite de
tests ejecuta todos los ejemplos, así que el código de estas páginas funciona
con la versión actual.

Arráncalos en el simulador de la terminal (`npx botmesh dev <archivo>`) y
conecta un canal real cuando te convenzan.

## Avanzado

| Ejemplo | Nivel | Etiquetas | Funcionalidades | Qué construyes |
| --- | --- | --- | --- | --- |
| [Servidor de webhooks para la Cloud API](./webhook-cloud-api) | Avanzado | WhatsApp, Cloud API, Webhooks, Seguridad | Webhooks de `@botmesh/meta`, firmas sobre el body crudo, ventana de 24 h, plantillas | Un servidor `node:http` para la Cloud API oficial, con plantilla de respaldo |
| [Bot listo para producción](./bot-produccion) | Avanzado | Producción, Docker, SQLite, Durabilidad | `SQLiteStore`, durabilidad, flujos persistentes, salud y métricas, apagado ordenado, logs | Un bot de soporte empaquetado como proyecto pequeño con Dockerfile |
| [Resumen diario programado](./resumen-diario) | Avanzado | Scheduler, Broadcast, Zonas horarias | Scheduler durable, zonas horarias, `bot.broadcast`, altas y bajas con `ctx.user` | Un resumen a las 08:00 en la zona del usuario, una vez al día aunque haya reinicios |
| [Probar tu bot](./probar-tu-bot) | Avanzado | Testing, Vitest, Transcripciones doradas | `createTestBot`, `expectReply`, transcripciones doradas, reproducción | Un archivo de Vitest completo que graba y reproduce una conversación |
| [Crear un plugin: FAQ con herramientas](./plugin-faq) | Avanzado | Plugins, Inyección de dependencias | `definePlugin`, `install`/`uninstall`, `ctx.onDispose`, `provide` | Un plugin de FAQ reutilizable que comparte sus contadores como herramienta |
