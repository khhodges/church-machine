---
name: Offline backend isolation
description: Avoid live service startup side effects when retaining offline compiler evidence.
---
Offline preparation must use a side-effect-free compiler/backend interface,
not import the live server entrypoint merely to reuse its helpers.

**Why:** An offline retention process imported the application and triggered
normal database initialization, scheduling and UDP-listener startup before
compilation. Unchanged image/design hashes proved preservation of those files,
not absence of unrelated service initialization.

**How to apply:** Separate the minimal trusted compiler functions from service
startup, or use an explicitly isolated process with startup disabled. Do not
claim whole-environment immutability from a few file-hash comparisons. Never
retain startup logs containing credential fragments as downloadable evidence.
