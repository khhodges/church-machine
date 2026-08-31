---
name: Immutable LUMP history transitions
description: Non-obvious rules for keeping save, WIP, and fork histories atomic across workers
---
Treat archive creation, current binary/sidecar replacement, and manifest replacement as one staged transaction held under both an in-process lock and a cross-process advisory lock. Reserve archive pathnames with `lexists`, not `exists`, and revalidate the expected manifest generation after acquiring the lock.

**Why:** A dangling archive symlink is still an occupied immutable pathname. Multiple server workers can otherwise reserve the same archive version, and a caller that read state before waiting for the lock can apply a stale fork/save decision after another transition commits.

**How to apply:** Every history-mutating endpoint must use the shared transition. Remember that a WIP current pair already has archive-style `_vN` names: when it becomes compiled or forked, retain that pair as version N instead of replacing it with a compatibility alias or rewriting its sidecar.