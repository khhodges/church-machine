---
name: IDE configuration authorization
description: Authorization boundary between ordinary project configuration and privileged operations
---

Ordinary project-configuration writes such as Namespace policy saves must not
depend on REPORT_TOKEN. Never copy or expose REPORT_TOKEN to browser JavaScript.
Validate these configuration payloads at the endpoint. Keep hardware control,
artifact upload, deployment, and remote build operations on their stronger
authorization paths.

**Why:** Requiring REPORT_TOKEN for an ordinary Namespace save repeatedly
blocked the programmer because a browser cannot safely possess that server-only
secret. Proxy-origin checks also proved unreliable in the live IDE path.

**How to apply:** Do not add REPORT_TOKEN checks to ordinary IDE configuration
save endpoints. Keep hardware, deployment, bridge, upload, and other privileged
operations on their existing authorization paths.

Apply the same classification to nested review/preflight requests and saves
that include staged build configuration; those are still ordinary IDE saves.
**Why:** A secondary configuration branch retained privileged authorization
after the main save path was corrected, reproducing the failure only for
combined saves.
**How to apply:** Cover review and commit with and without staged configuration
while a reporting token is configured; never require that token in the browser.