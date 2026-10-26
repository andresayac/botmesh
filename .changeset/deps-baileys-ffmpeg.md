---
'@botmesh/baileys': minor
---

**Breaking: ffmpeg is no longer bundled.** Voice notes are transcoded by running an ffmpeg binary directly instead of through `fluent-ffmpeg` (deprecated upstream) and `@ffmpeg-installer/ffmpeg` (unmaintained, an old ffmpeg). The binary is `FFMPEG_PATH` when set, else the binary of the new optional peer dependency `ffmpeg-static` when it is installed and downloaded, else `ffmpeg` on the `PATH`. Without one, a voice note rejects with an `UnsupportedContentError` that explains how to install ffmpeg; every other send is unaffected. Migration: install ffmpeg in the image of a bot that sends voice notes (`apt install ffmpeg`), or add `ffmpeg-static`. See the migration guide.

- Dependencies: `sharp` `^0.35.5` (security fix), and the unused `follow-redirects` and `mime-types` are removed.
- Baileys stays on `@whiskeysockets/baileys@7.0.0-rc14`: it is still the newest release upstream (no stable 7.x exists; 6.x is the legacy line without LID addressing). The README explains the pin.
