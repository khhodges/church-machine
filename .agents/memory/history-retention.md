---
name: Permanent LUMP history retention
description: User-approved age and minimum-history policy, with conservative reference protection.
---

The user chose permanent deletion, not hiding, for history older than 30 days
AND outside the three newest versions per LUMP. Keep recent versions and the
newest three even when older; preserve ties rather than choosing arbitrarily.
Protect current and system-referenced artifacts. Unknown dates are not proof of age.

**Why:** The user explicitly confirmed destructive archive cleanup while retaining
recent work and a minimum revision history. Reference protection must prevent
cleanup from invalidating current execution or frozen downstream artifacts.

**How to apply:** Use recorded revision timestamps, not filesystem mtime; keep
approval evidence. Deletion is a protected write, never a side effect of a GET.
The user subsequently approved automatic cleanup after successful approved
saves; retain the explicit History action for retries. Cleanup failure must
never invalidate or report failure for an already committed save.

**Why:** Retention is maintenance, not a condition for preserving new work.
Interrupted deletion must leave durable evidence rather than unexplained gaps.

**How to apply:** Record pending deletion before unlinking; reconcile an
interrupted cleanup only during an authorized write, never startup or GET.
Surviving files need fresh age, reference and integrity checks before deletion.