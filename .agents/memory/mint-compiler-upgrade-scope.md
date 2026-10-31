---
name: Mint compiler upgrade scope
description: Focused baseline rather than broad legacy-suite repair before ABI work
---

The user selected the existing four public Mint methods for the scaffold:
CREATE, DESTROY, MakeOutform, MakeInform, not four separate creation methods.

Keep same-identity compiler fixtures outside the normal IDE source catalog.

**Why:** Placing the isolated stub beside the real Mint source caused Open File
to group both as ide.Mint, obscuring the distinction between prototype and stub.

**How to apply:** Test-only sources belong under tests, not in the catalog's
simulator scan tree. Never fix this by renaming a saved identity or replacing
the user's owned editor draft.
UNSUPPORTED_OPERATION is software status 5 with NULL CR1, not a new hardware
fault or a successful operation. Stubs deny every call without validating
PassKeys; do not claim this as an authorization implementation.

**Why:** Explicit method-set selection and unsupported-status confirmation.

The user explicitly requires reuse/review of the actual CREATE RW-GT prototype
and inclusion of PkVerify, not substitution of the four denial stubs for it.

**Why:** The stub-only test excluded the allocator and verification paths the
user intended to test. Passing stub dispatch is not evidence for actual Mint.

For the v4 integrated draft, the user explicitly selected retaining CREATE
and DESTROY and including the newer editable DESTROY implementation rather
than saved v3's unfinished DESTROY.

**Why:** The saved revision and working-tree lifecycle implementations differ;
the user approved the newer DESTROY only after that distinction was explained.
Do not replace these methods with the proposed denial stubs. Conversion stubs
remain separate from lifecycle implementation and new-ABI acceptance.

The user subsequently approved a bounded full integration: use the newer
paired Cleaner-managed CREATE/DESTROY implementation, the approved public
ABI, typed imports through ordinary save/reopen, and isolated verification.

**Why:** Mixing v3 allocation with newer DESTROY is not a coherent lifecycle.
The approval preserves v3 history and does not authorize live publication,
Namespace activation, or FPGA changes. Do not treat compilation or a saved
source round-trip as successful allocation/destruction evidence.

The v4 verifier must not resolve by the older CR2-proof verifier's name alone.
The isolated companion uses a distinct declared identity until exact-revision
dependency selection can establish the matching helper.

**Why:** A new CR1-proof caller bound to the old verifier could have the wrong
register tested as proof. Keeping both source files does not prevent this
cross-version binding; the declared dependency must distinguish them.

**How to apply:** Port the real CREATE and verification path together; preserve
proof before clearing CR1 and distinguish old success=1 from new success=0.
An exhausted-allocator authorization test does not prove successful creation.

**How to apply:** Keep the scaffold isolated and uninstalled. Generate its ABI
from the typed source; normal publication must not silently downgrade it to
the old format. Preserve the original operational source during this test.
Use focused current-ISA/Mint compiler checks for the ABI upgrade. Keep unrelated
Lambda, EventRouter, and historical-fixture failures visible, but do not require
their cleanup before proceeding.

**Why:** The user approved this narrower scope after reviewing which failing
items matter. A passing baseline is not acceptance of the new ABI.

**How to apply:** Preserve mandatory PassKey semantics and distinguish compiler
checks from service and physical acceptance. The existing BIT stays fixed;
RTL runs, builds, board changes, and historical LUMP replacement require
separate approval. Continue step-by-step review of unresolved ABI choices.

The user approved the conventions in
`docs/phase-1/compact-mint-abi-proposal.md` on 2026-10-31: once-per-abstraction
PassKey declaration, metadata codes 0–5, software status codes 0–5, and NULL CR1
on normal error or successful no-capability-result returns.

**Why:** This was explicit approval of conventions, not the future serialized
layout, compiler implementation, conversion behavior, or hardware work.

**How to apply:** Do not reopen settled convention choices; distinguish approved
design from current executable behavior.

The user also approved the layout and signature syntax in
`docs/phase-1/compact-mint-abi-layout-proposal.md`, including scalar results in
DR2 and the initial limit of one capability input in CR2.

**Why:** This was a separate explicit layout approval, not approval of concrete
Mint argument types or new initializer/conversion behavior.

**How to apply:** Match concrete Mint signatures to the selected implementation
before implementation. Do not carry historical slot-number arguments, CR2
PassKey placement or success=1 into the new approved convention.

The user chose zero-initialized DATA first for CREATE on 2026-10-31.
Use its existing allocation/permission scalar meanings in DR2/DR3 and return
Inform RW; no initializer input in this slice, so CR2 is ignored.

**Why:** This isolates the compiler ABI upgrade from adding initializer
semantics. The choice does not authorize conversion implementation or broader
object-type grants.

**How to apply:** Follow the settled CREATE contract in
`docs/phase-1/mint-abi-signature-review.md`; do not retain the old unused-input
NULL checks or clear CR1 before preserving/verifying the incoming PassKey.
