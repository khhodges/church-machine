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

Keep offline startup suppression private to the loaded backend, not a
process-wide environment switch or a changed authentication policy.

**Why:** Offline compilation may coexist with a serving application; disabling
startup globally could silently disable services for unrelated imports. Reusing
the same compiler implementation avoids a second, weaker signing/source path.

**How to apply:** Exercise fresh-process offline loading with service-start and
file-write traps, as well as digest comparisons. Review/consent stores can open
databases during route installation even when primary database setup is disabled.
