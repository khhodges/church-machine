---
name: IDE browser write authorization
description: Authorization boundary for interactive IDE configuration writes
---

Interactive configuration writes initiated by the IDE may be authorized as
verified same-origin browser requests. Never copy or expose REPORT_TOKEN to
browser JavaScript. External scripts and cross-origin callers must continue to
use server bearer authorization.

**Why:** Requiring REPORT_TOKEN for an ordinary Namespace save blocked the
programmer because a browser cannot safely possess that server-only secret.

**How to apply:** Limit the browser path to IDE configuration operations and
require matching Origin plus Sec-Fetch-Site: same-origin. Keep hardware,
deployment, bridge, upload, and other privileged operations on their stronger
existing authorization paths.