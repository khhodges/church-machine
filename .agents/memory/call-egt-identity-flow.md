---
name: CALL E-GT identity flow
description: How ordinary cross-domain CALL and RETURN preserve executable identity across transient CR6 and CR14 capability views.
---

Both CALL resolution phases consume E-GT identity directly: the source CR's
E-GT builds the callee CR6 view, and the latched callee E-GT builds CR14.
Neither phase may index through the resolved LUMP capability, because its base
points at the LUMP header rather than a c-list row.

ELOADCALL must accept CR6 as its ordinary source: CR6 is the architectural
c-list capability. A source-range gate ending at CR5 rejects canonical
`ELOADCALL CRd, CR6[row], method` instructions before resolution.

RETURN frames must store the caller identity normalized as a Church E-GT.
CR6's live word 0 is only a transient L-only c-list view, so copying it raw
creates a frame that cLoad cannot use to reconstruct the caller.

RETURN has no CR source operand. The encoded register fields are zero/reserved;
requiring E permission from CR0 (or any decoded CR) aborts before the frame and
violates the ISA. The saved Enter E-GT is the sole return authority.

RETURN must explicitly set CR6.M after rebuilding the caller's CR6. M is
boundary microcode state, not ordinary register state to restore from a frame.

**Explicit user decision (RETURN keep mask):** The user corrected the earlier
snapshot proposal: a set mask bit **prevents clearing**, not restores a caller
snapshot. In low instruction bits [11:0], bits 0–4 and 7–11 keep the current
descriptor when 1 and directly zero it when 0. Bits 5/6 are ignored. CR5 thread
descriptor words never change on CALL/RETURN; CR6 is reconstructed from saved
caller context regardless of mask. All M bits still reset, including CR5.M,
then CR6.M is rearmed. No CLEAR bit, extra saved snapshots, or stack/Thread ABI
extension. This is a user architectural choice, not an inference from code.
Old mask-ignored immutable artifacts are not automatically compatible.
Hardware lambda-fast RETURN now derives accepted CR14 Inform/X identity,
revalidates cLoad and code location before mask clearing, and reconstructs
CR6. Its legacy `lambda_pc` return-address state still differs from canonical
SZ=0 frames. Only the synthetic boot-ROM guard (`savedPC=3`, no active lambda)
still bypasses cLoad, lacking canonical namespace/c-list identity and guaranteed
CR6 reconstruction. This remains an unresolved implementation limit, not a
user-approved architectural exemption.

CR6 restoration must rebuild the caller's c-list view: `word1` is the caller
LUMP base plus `lumpSize - cc`, not the caller LUMP header base. CR14 uses the
header base; CR6 and CR14 must not be reconstructed with the same address.

**Why:** The boot CALL's direct-resolution path masked both mistakes; a normal
nested cross-domain CALL failed before entry, an L-only frame could not complete
the RETURN cLoad handoff, and restoring CR6 to the header made the caller read
instructions/data as GTs after a successful RETURN.

**How to apply:** For CALL/RETURN RTL or simulator changes, test at least two
nested ordinary domains after the boot window closes. Verify exact frame E-GTs,
cLoad commits, CR6.M=1 and the caller c-list base after RETURN, restored STO
values, return fetch settling, and the absence of extra retires.