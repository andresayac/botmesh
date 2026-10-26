---
'@botmesh/meta': minor
---

**Breaking:** `toFlowJson()` and `publishForm()` default the WhatsApp Flow submit label to the core default locale, English (`'Submit'`); it was Spanish (`'Enviar'`) while the core already defaulted to English. The fallbacks of `toFlowMessage()` for a bare definition sent without a bot context follow (`'Open form'`, `'Fill in the form.'`). Pass `lang: 'es'` (`toFlowJson(def, { lang: 'es' })`, `publishForm(def, { flowJson: { lang: 'es' } })`) or set `submitLabel` to keep the Spanish label. See the "Migrating to 2.0" guide.
