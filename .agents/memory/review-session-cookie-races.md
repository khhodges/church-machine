---
name: Review session cookie races
description: Initialize independent review nonce bindings before concurrent browser requests.
---
Flask signed-cookie sessions replace the whole session. Lazily adding approval,
confirmation, and diagnostic nonces in parallel requests can overwrite newer
bindings when an older response arrives late.

**Why:** The real programmer save browser journey reached approval successfully
but rejected its confirmed save as a changed browser session. Sequential HTTP
tests missed the race.

**How to apply:** Establish the independent bindings before serving the initial
IDE document, preserve them on later requests, and test delayed responses from
the original cookie. Never relax session-bound or one-use confirmation checks.