---
name: Dev server port collision (preview crash)
description: Why "Address already in use" on port 5000 crashed the main preview workflow, and the two-layer fix
---

Two independently-started workflows can both try to bind the same hardcoded
port at startup. Concretely: the main dev server workflow (`python3
server/app.py`, port 5000) and Playwright's `webServer` (which spawns its own
`python3 server/app.py` if nothing already answers on its target URL) both
defaulted to port 5000. `reuseExistingServer: true` only helps if the other
server is already up and *responding* — during a restart window it isn't,
so Playwright launches a second instance on the same port.

A single check-then-act guard (kill whoever holds the port, then bind) is not
enough to fully close this race: the killer and the survivor can both reach
that step within the same narrow window, so one of them still crashes with
`OSError: Address already in use`.

**Why:** app-level "free the port then bind" logic assumes no one else binds
between the check and the bind — untrue when two independent processes race
for the same port during overlapping startup.

**How to apply:** (1) Give secondary/test servers their own dedicated port
by default (never share the main app's port as a fallback value) so there's
no collision to race in the first place. (2) Wrap the primary server's bind
call in a retry loop (re-run the free-port kill + retry with short backoff)
so a lost race self-heals instead of taking down the whole workflow.
