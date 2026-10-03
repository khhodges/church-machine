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
The approved policy also applies automatically after authorized successful
saves, never during planning or review. Retain the explicit History action for
retries. Cleanup failure must not undo or report failure for a committed save.

**Why:** Archive maintenance is independent of publishing a new approved
artifact; retrying a successful save because cleanup failed creates unintended
revisions. A crash after unlink must not erase the evidence explaining a gap.

**How to apply:** Persist deletion intent before unlink, and complete its
manifest/ledger evidence on the next authorized cleanup, never startup or GET.
If the archive still exists, recheck age, identity and current references instead
of replaying deletion blindly. Check frozen artifact stores as well as Namespace
references under the shared transition lock; retain approval evidence even after
the archive is gone.

Approval registries are audit evidence, not artifact-retention roots.

**Why:** Hardware freezes retain the entire approval registry, including
unselected artifacts. Treating every approval digest as a reference would
permanently exempt otherwise-expired archives from the approved policy.

**How to apply:** Preserve approval files without using their contents as
reference roots. Frozen selections and retained artifact inventories still
protect the exact binaries they name.