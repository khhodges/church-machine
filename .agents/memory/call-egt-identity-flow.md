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

**Why:** The boot CALL's direct-resolution path masked both mistakes; a normal
nested cross-domain CALL failed before entry, and an L-only frame could not
complete the RETURN cLoad handoff.

**How to apply:** For CALL/RETURN RTL or simulator changes, test at least two
nested ordinary domains after the boot window closes. Verify exact frame E-GTs,
cLoad commits, CR6.M=1 after RETURN, restored STO values, return fetch settling,
and the absence of extra retires.