---
name: Immutable LUMP history transitions
description: Non-obvious rules for keeping save, WIP, and fork histories atomic across workers
---
Treat archive creation, current binary/sidecar replacement, and manifest replacement as one staged transaction held under both an in-process lock and a cross-process advisory lock. Reserve archive pathnames with `lexists`, not `exists`, and revalidate the expected manifest generation after acquiring the lock.

**Why:** A dangling archive symlink is still an occupied immutable pathname. Multiple server workers can otherwise reserve the same archive version, and a caller that read state before waiting for the lock can apply a stale fork/save decision after another transition commits.

**How to apply:** Every history-mutating endpoint must use the shared transition. Remember that a WIP current pair already has archive-style `_vN` names: when it becomes compiled or forked, retain that pair as version N instead of replacing it with a compatibility alias or rewriting its sidecar.

Historical and current manifest rows may share one immutable token when both rows name the exact same binary. Token resolution and canonical-integrity checks must accept that aliasing only when all matching rows have one identical filename; conflicting token-to-file mappings remain fail-closed.

**Why:** Archiving a current row without changing its immutable bytes can leave an archived record and a current record for the same token. Treating every duplicate as ambiguous made valid saved LUMPs unavailable to source navigation.

**How to apply:** Normalize matching manifest rows by filename before enforcing token uniqueness. One unique filename is safe; zero or multiple filenames is an integrity error.