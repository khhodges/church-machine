---
name: Thread root-frame invariant
description: Poison-root rejection on ordinary CHANGE versus explicit boot CALL startup.
---

Ordinary CHANGE into a Thread with only a poison-root frame must fault with
STACK_UNDERFLOW. Never interpret NIA `0x7FFF` as permission to start code at PC 0.

**Why:** The user explicitly confirmed the initial CHANGE into Thread.2 should
fail and explained that Boot.Thread works because boot executes CALL CR0 after
CHANGE. That CALL is absent on ordinary Thread CHANGE. Earlier passing loop
evidence depended on the wrong implicit-start exception and is not authoritative.

**How to apply:** Keep boot setup and explicit direct-run activation separate
from instruction/manual Thread CHANGE. Ordinary switching needs a real suspended
continuation. Preserve the poison root as a guard, not an executable continuation;
do not change its Enter GT to disguise missing CALL/resume authority.

Initialize Thread.2 and Thread.3 with a genuine CapabilityTest entry continuation
above the poison root, rather than only the root or an implicit CALL.

**Why:** After identifying the missing CALL distinction, the user explicitly
chose initialization as a stack frame as the solution. Ordinary CHANGE can
restore that frame normally; the root remains available to detect an invalid
top-level RETURN.

**How to apply:** New prepared images use an initial NIA 0 continuation with
saved STO pointing to the retained root. Preserve Boot.Thread's explicit boot
CALL path. Do not mutate saved images or immutable selected LUMPs silently.

Preserve independently prepared entry identity only as exact, validated input,
never as proof that execution is valid. Do not copy arbitrary mutable private
Thread state during release regeneration.

**Why:** Keeping saved bytes and making those bytes safe to execute are separate
requirements. The user rejected making an invalid Thread startup pass merely
by selecting a different abstraction.

**How to apply:** Keep selected artifacts immutable, bind preparation to exact
artifact/provenance inputs, and report incompatible execution as a release
blocker. A corrected program/preparation needs explicit approval.
