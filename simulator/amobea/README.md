# Additive Phase 1 IDE views

The IDE menu opens this workspace in a separate tab to preserve the current editor
and simulator. Both views stay mounted when switching within this workspace.
They intentionally retain the approved synthetic, in-memory behavior: no runtime,
capability grants, external delivery, or persistent user storage is implemented.

Source was graduated from the approved Amobea canvas prototype. The prototype is
independent and is not a runtime or build dependency. Navigation translation is
explicit in `scripts/build-amobea.mjs`.

Run `npm run build:amobea` after source edits. Commit the small compiled
`main.js`, `main.css`, and `index.html` assets, as with the IDE's other served
JavaScript. Flask serves them directly; no second server or deployment change is
required. Content-based query versions invalidate browser caches on rebuild.
