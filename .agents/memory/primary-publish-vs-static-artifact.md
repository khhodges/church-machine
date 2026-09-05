---
name: Primary publish vs static artifact
description: How to recognize and prevent a nested static artifact from replacing the main IDE deployment.
---

In this multi-artifact project, the Introduction artifact must remain development-only. Its production build belongs in the root publish command, and Flask serves the result at `/ide-intro/`. If the nested artifact declares its own static production service, publishing enters artifact mode and ignores the root runnable service.

**Why:** Republishing repeatedly registered `artifact mode enabled runnable=0 static=1` and mounted the Introduction artifact's static output at `/`, even after the root autoscale command was restored. The custom domain returned HTTP 200 but appeared blank because it was no longer the Flask IDE deployment.

**How to apply:** Keep production settings out of the nested Introduction artifact manifest. Build the deck from the root deployment, run Gunicorn for `server.app:app`, and verify publish logs report a runnable service rather than a static artifact mounted at `/`.

The Introduction artifact's managed development server can also become the
shared `.replit.dev` router because its artifact path is `/`. Keep the deck at
`/ide-intro/`, and proxy every other development request to the primary Flask
server; otherwise `/simulator/` either serves the deck's Vite 404 or becomes a
502 when the deck workflow is stopped.

**Why:** The local Flask preview correctly showed the Dashboard Thread tab,
while the Replit development URL was reaching the Introduction Vite server
instead of Flask.

**How to apply:** When the shared development domain diverges from the main
workflow, check which managed artifact owns `/`; preserve that artifact's base
path and forward non-artifact routes to the primary service.