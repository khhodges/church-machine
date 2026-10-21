---
name: Permanent LUMP history retention
description: User-approved age and minimum-history policy, with conservative reference protection.
---

For complete records, the user chose permanent deletion, not hiding, for history older than 30 days
AND outside the three newest versions per LUMP. Keep recent versions and the
newest three even when older; preserve ties rather than choosing arbitrarily.
Protect current and system-referenced artifacts.

Incomplete historical records instead expire after three days, even within
the newest three. Missing recorded dates may use the binary's last-modified
date as the fallback. Missing identity metadata also makes a record incomplete;
do not infer age from revision numbers. Project operational logs retain three
days, while frozen evidence, approvals and recovery journals stay protected.

**Why:** The user explicitly requested three-day cleanup for logs and incomplete
archives, and selected filesystem modification time for undated archives.

**How to apply:** Record the age basis with deletion evidence. Run authorized
recurring maintenance independently of GET requests. Complete records retain
the original 30-day/newest-three policy. Startup of that maintenance worker is
authorized; ordinary startup/read paths must not perform unguarded deletion.

**Why:** The user explicitly confirmed destructive archive cleanup while retaining
recent work and a minimum revision history. Reference protection must prevent
cleanup from invalidating current execution or frozen downstream artifacts.

**How to apply:** Prefer recorded revision timestamps; only incomplete records
without them use the explicitly approved filesystem fallback. Keep
approval evidence. Deletion is a protected write, never a side effect of a GET.
The approved policy also applies automatically after authorized successful
saves, never during planning or review. Retain the explicit History action for
retries. Cleanup failure must not undo or report failure for a committed save.

**Why:** Archive maintenance is independent of publishing a new approved
artifact; retrying a successful save because cleanup failed creates unintended
revisions. A crash after unlink must not erase the evidence explaining a gap.

**How to apply:** Persist deletion intent before unlink, and complete its
manifest/ledger evidence on the next authorized cleanup, never an ordinary GET.
If the archive still exists, recheck age, identity and current references instead
of replaying deletion blindly. Check frozen artifact stores as well as Namespace
references under the shared transition lock; retain approval evidence even after
the archive is gone.

Approval registries are audit evidence, not artifact-retention roots.

A pending save candidate's own output identity is not an input dependency.
Preserve its exact input filenames, hashes, editor-base and repair-destination
references, but do not let its proposed output token pin an unrelated old revision.

**Why:** Historical output-token reuse made old save plans falsely protect
otherwise-expired archives.

History selection and deletion must agree on the exact inspected
filename/revision pair, including artifacts retained across token changes.
Never infer membership solely from a newer artifact's stem or an older
manifest's revision number.

**Why:** Valid rows displayed by History were rejected by deletion as
“not part of this history,” stopping the entire expiration pass.

**How to apply:** Revalidate exact History membership under the transition
lock while retaining independent live-file, reference and filesystem guards.

The same distinction applies to retained archived-revision metadata, completed
save records/candidates, committed or expired image-refresh records, and derived
binding caches. Keep the evidence without letting it pin every old binary.
Unfinished work, current selections and frozen artifact inventories remain roots.

**Why:** Cleanup must not preserve an expired archive solely because retained
evidence records that the archive once existed or was used by a completed action.

**Why:** Hardware freezes retain the entire approval registry, including
unselected artifacts. Treating every approval digest as a reference would
permanently exempt otherwise-expired archives from the approved policy.

**How to apply:** Preserve approval files without using their contents as
reference roots. Frozen selections and retained artifact inventories still
protect the exact binaries they name.

The user explicitly requested: “remove all tests related to any approved deletion.”

**Why:** The user rejected maintaining deletion-related regression checks after
the approved archive cleanup. This supersedes the earlier plan to add
completed-deletion exceptions and their test coverage.

**How to apply:** Do not reintroduce approved-deletion/retention tests without
new authorization. Keep ordinary approval structure/hash-field checks.
Removing tests does not authorize changing runtime deletion protections,
migration validation, approval evidence, or live artifacts.

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
