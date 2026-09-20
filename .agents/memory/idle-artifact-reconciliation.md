---
name: Idle artifact reconciliation is IDE-owned
description: Newer unpinned assigned executables may be prepared automatically only through the atomic Prepare/Run validator while execution is idle.
---

The IDE may reconcile newer admissible saved artifacts without starting a run when the simulator control plane is stopped and idle. It must call the same digest-bound, approval-validating, Namespace-CAS transaction used by Prepare/Run, commit the Namespace selection and generated boot image together, and project only the accepted response. It must never rewrite immutable LUMPs, touch hardware, or replace a live running/walking image. Exact pins remain authoritative.

**Why:** Requiring a programmer to repair ordinary stale internal artifact metadata leaves a persistent warning after the IDE has already produced valid newer bytes. Bypassing the validator would be unsafe, while reusing it with no execution makes ownership and security boundaries explicit.

**How to apply:** Deduplicate automatic attempts by Namespace fingerprint plus candidate identity (slot, token, filename, revision, and authoritative binary SHA-256 when supplied) and use one shared in-flight guard. Content hashes, not timestamps, bind both the retry key and executable admission. Hide the informational stale banner while reconciliation is queued or succeeds, but keep assigned-stale row labels until commit. On a bounded failure, preserve the previous image and show the rejecting reason as an IDE preparation failure; do not instruct programmers to edit IDE-owned metadata. If execution is active, do not poll or retry—queue implicitly for the next explicit Run boundary.

Namespace state may arrive before later control-plane scripts expose their idle
predicate. The control plane must re-offer the already-fetched state once at
startup readiness; relying only on the fetch callback can leave a hidden stale
warning with no transaction ever attempted.

The fingerprint returned by a Namespace GET must hash the persisted rows before
response-only policy projection. A hash of enriched/projected rows can never
match the mutation endpoint's authoritative raw-row hash, making every otherwise
valid automatic CAS fail with 409.