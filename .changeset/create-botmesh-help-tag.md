---
'create-botmesh': patch
---

`create-botmesh --help` names the dist-tag of the current release (`npm create botmesh@beta` during the beta, no tag once `@botmesh/core` is stable) instead of the stale `@alpha`. New `createCommand()` helper in the bin, derived from the `@botmesh/core` version stamped into projects.
