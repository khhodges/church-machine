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

The user authorized updating the factory initializer and verifying full-core
boot when strict CHANGE admission exposed its empty stack.
**Why:** A fail-closed correction must also have a compatible newly prepared
factory input; an old approval is not permission to bypass context validation.
**How to apply:** Keep this separate from historical artifact repair, new
Namespace approval, mapped-image approval, and any physical board operation.

**Why:** Keeping saved bytes and making those bytes safe to execute are separate
requirements. The user rejected making an invalid Thread startup pass merely
by selecting a different abstraction.

**How to apply:** Keep selected artifacts immutable, bind preparation to exact
artifact/provenance inputs, and report incompatible execution as a release
blocker. A corrected program/preparation needs explicit approval.

Distinguish root-frame content in the generic image from the memory actually
embedded by elaboration.

**Why:** Regenerating a root-bearing generic image reproduced the existing
bytes, while the retained RTL initializer replay showed an empty stack.
Calling this a missing generic-image root would repair the wrong input.

**How to apply:** Inspect the exact generic bytes, hardware projection, and
retained initializer separately. A fresh generation or image hash alone does
not prove that elaboration installed the same Thread context.

Preserve executable descriptor authority when reconciling boot admission with
prepared images; do not widen a saved limit merely to satisfy a factory fixture.

**Why:** Factory full-allocation descriptors and prepared public-body limits
coexist. The candidate's protected C-List is separately derived from its header,
so requiring the factory limit rejected an otherwise valid prepared image.

**How to apply:** Keep both exact supported layouts constrained, reject arbitrary
truncation, and compare the full restored CR0 triple to its original descriptor.
This is a compatibility decision; the instruction-set text does not explicitly
mandate both Namespace limit encodings.
