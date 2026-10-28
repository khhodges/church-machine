---
name: CALL E-GT identity flow
description: How ordinary cross-domain CALL and RETURN preserve executable identity across transient CR6 and CR14 capability views.
---

Every CALL, including Boot, must use the target dispatch table. The user
explicitly requires one authoritative ISA CALL rule followed by compiler and
Boot; selector-zero direct entry is not an alternative architecture.
Public API index 0 maps to wire selector 1. Preserve historical artifacts;
do not silently repair operands or grant permissions.

**Why:** On 2026-10-28 unchanged-image replay showed Boot fetching Amoeba's
table word and a later CALL fetching CapabilityTest's table word. Conditional
decoding masked the first error and exposed the second as a misleading LOAD
permission fault. The user explicitly settled the dispatch-table requirement.

**How to apply:** Align compiler, Boot, simulator and RTL with the master CALL
contract. Keep specification approval distinct from implementation completion;
verify actual method-body entry and CR6.M, not merely absence of faults.

Both CALL resolution phases consume E-GT identity directly: the source CR's
E-GT builds the callee CR6 view, and the latched callee E-GT builds CR14.
Neither phase may index through the resolved LUMP capability, because its base
points at the LUMP header rather than a c-list row.

CR6 holds an E-only GT. Its register M-bit permits L access without changing
that GT. Do not describe CR6 as holding a transient L-only GT or justify access
by register number alone. ELOADCALL is retired; historical fused-instruction
behavior is not an active source requirement.

**Why:** Genesis explicitly corrected the LOAD explanation: CR6.M permits the
operation while the E-only GT stays unchanged. Earlier memory describing an
L-only CR6 token was stale and must not drive a new implementation.

**How to apply:** Preserve E identity and distinguish register M state from GT
permission bits in LOAD, CALL and RETURN work. Never fix ordinary non-CR6
L-only header access by rewriting CR6's GT or granting mixed R/L rights.
RETURN frames retain caller E authority, not a fabricated L-only identity.

Verify the E token and CR6.M together at actual CALL completion and subsequent
LOAD, rather than accepting a successful LOAD as sufficient evidence.

**Why:** An L-only token rewrite can conceal missing CR6.M and make an otherwise
incorrect CALL appear functional.

**How to apply:** Assert exact token preservation and the M boundary independently,
then observe an authored instruction's committed state change through real CALL.

Do not equate that retirement with delivery of its UART trace. The next
instruction can become active while the preceding packet's last byte is still
in flight.

**Why:** Full-top observation exposed a fault before the preceding LOAD trace
finished transmitting, which a core-only test ending at LOAD retirement missed.

**How to apply:** Distinguish committed state, queued trace data and fully
received frames. Report partial frames explicitly, and do not attribute a fault
to the current fetch word without checking latched issuer/subunit evidence.

Preserving E authority also means preserving its generation: never refresh a
saved or calling token from the current Namespace sequence when constructing
an Enter companion, including lump-only simulator adapters.

**Why:** A refreshed generation could make stale caller authority appear valid
and hide the difference between preserving an identity and minting a new one.

The E-only contract preserves the full E word, including B object-lock metadata.
Protected Thread frames may never convert an L/RX caller token to E; only
explicit lump-only legacy fixture adapters can support that historical input.

**Why:** M authorizes c-list LOAD, not new Enter authority. Re-encoding only E
can also silently discard B even when the slot and generation are unchanged.

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