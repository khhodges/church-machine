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

Approval-to-binary consistency must recognize exact completed historical
deletions without treating the ledger as a general missing-file exemption.

**Why:** Retaining approvals after authorized archive deletion is intentional;
requiring every audit digest to retain physical bytes contradicts that policy.

**How to apply:** Require the approval's exact filename and SHA-256 in completed
deletion evidence. Pending intent is not completion, and neither historical
evidence nor a shared digest excuses loss of a live or selected artifact.
Keep approval structure and hash-field validation independent of this exception.

Explicit single-revision deletion is exempt from age and newest-version policy,
but never from reference, link, approval-evidence, or recovery protections.

**Why:** Selecting a particular archive authorizes deleting that revision, not
breaking a saved Namespace or frozen downstream artifact that still uses it.

**How to apply:** Keep the same transition lock and deletion-evidence protocol
for manual and policy cleanup. Recovery may finish an already missing archive's
bookkeeping; it must not replay an unlink of a surviving archive without fresh
reference validation.

Explicit removal of obsolete symlink aliases must account for incoming alias
chains, not just live Namespace selections.

**Why:** Deleting an intermediate historical name can break other retained
names even though the ultimate executable file remains untouched.

**How to apply:** Keep ordinary retention's linked-file rejection. For separately
authorized alias cleanup, preserve existing incoming aliases' exact resolved
bytes, record any route shortening in the deletion ledger, and verify all
remaining files' hashes. This does not authorize inventing new historical
aliases or changing their ultimate targets. Keep approvals and audit evidence.

Approval consistency audits must recognize exact completed historical deletions,
without requiring deleted bytes to be restored.

**Why:** Permanent deletion and permanent approval retention are both intentional;
requiring every retained approval to have a surviving binary contradicts them.

**How to apply:** Require matching filename and digest in completed deletion
evidence, no pending deletion or surviving path, and no live selection. Preserve
approval hash/structure checks and distinguish historical input inventories from
executable bindings. Never make a blanket exception for missing binaries.
