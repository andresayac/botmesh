---
"@botmesh/core": patch
---

`bot.plug(plugin, config)` types `config` with the plugin's own config type (`definePlugin<MyConfig>()`). A config declared with an interface (such as `NluPluginConfig`) is accepted as is, where it failed before with "Index signature for type 'string' is missing", and an unknown or mistyped option is now a compile error instead of passing silently.
