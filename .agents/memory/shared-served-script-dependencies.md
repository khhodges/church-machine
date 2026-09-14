---
name: Shared served-script dependencies
description: How shared browser modules should be loaded and integration-tested when multiple UI surfaces depend on them.
---

Declare shared UI dependencies explicitly in the served script manifest before every consumer. Do not hide the dependency in `document.write` or another runtime injection path. A focused integration gate should derive and execute the relevant order from the served manifest rather than maintaining a separate hand-written order.

**Why:** A shared decoder had unit coverage but could silently disappear from the served IDE because source harnesses injected consumers in a different order. Runtime injection also made the actual dependency invisible to source-order checks and cache-version review.

**How to apply:** When extracting browser logic into a shared module used by multiple classic scripts, add it explicitly to the page manifest, retain the project’s cache-version convention, and make one focused integration test load the relevant scripts by parsing that manifest.