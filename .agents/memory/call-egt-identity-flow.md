---
name: CALL E-GT identity flow
description: How ordinary cross-domain CALL and RETURN preserve executable identity across transient CR6 and CR14 capability views.
---

Both CALL resolution phases consume E-GT identity directly: the source CR's
E-GT builds the callee CR6 view, and the latched callee E-GT builds CR14.
Neither phase may index through the resolved LUMP capability, because its base
points at the LUMP header rather than a c-list row.

RETURN frames must store the caller identity normalized as a Church E-GT.
CR6's live word 0 is only a transient L-only c-list view, so copying it raw
creates a frame that cLoad cannot use to reconstruct the caller.

**Why:** The boot CALL's direct-resolution path masked both mistakes; a normal
nested cross-domain CALL failed before entry, and an L-only frame could not
complete the RETURN cLoad handoff.

**How to apply:** For CALL/RETURN RTL changes, test at least two nested ordinary
domains after the boot window closes. Verify exact frame E-GTs, cLoad commits,
restored STO values, return fetch settling, and the absence of extra retires.