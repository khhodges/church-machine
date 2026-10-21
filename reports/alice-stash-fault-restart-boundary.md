# Alice stash after a fault: restart boundary

## Result

**Post-restart Reveal is not verified.** The ascending actor experiment proves
Stash and Reveal before Mallory's `NO_CAPABILITY`, and intact Alice object
memory at the hard fault. It does not prove an execution restart.

No runtime semantics, saved designs, authority grants, hardware, or actor
sources were changed for this investigation. This is not power-loss
persistence, and pristine-image reload is not retained-memory recovery.

## Architectural authority versus current implementation

`docs/phase-1/01-isa/instruction-set.md`, “Namespace fault recovery,” approves
rebooting only the responsible Namespace through its trusted boot sequence,
without saving the faulted Thread as a resumable continuation or requiring its
M grant. First-fault evidence must survive. Recovery completes only when the
final boot `CALL CR0` succeeds; failure before that requires first Genesis.
Hardware must not change versions. Thus Namespace-local recovery is approved
in principle; the missing piece is not permission to resume Mallory.

The ascending execution implementation does not yet establish that transition:

- `simulator/namespace-runtime-core.js` `beginBoot()` rejects both live Thread
  ownership and halted execution. It is a fresh-image boot initializer, not a
  retained-memory recovery operation.
- `startEntryThread()` likewise rejects an owned or faulted runtime.
- `simulator/simulator.js` `fault()` records evidence and halts. It does not
  invoke Namespace recovery.
- The inherited `_returnToBoot()` is not an ascending recovery contract. It
  uses the legacy `BOOT_NS_SLOT_THREAD`, rewrites its root sentinel, clears
  registers and shared device state, and creates legacy boot progress. Calling
  it directly would not establish responsible-Namespace isolation or first
  Genesis escalation.
- Ordinary `_activateChangeThread()` restores validated saved homes and
  protected continuation frames. It is not authority to synthesize new homes,
  re-arm a faulted Thread, or choose a new continuation after a fault.

The fixture in `simulator/alice_mallory_ascending_lab.js` provisions its manager
and actor Threads **before boot**. The manager hands off to Alice and then
Mallory. Alice's saved continuation after her handoff does not provide a
post-restart Reveal-only routine. Re-priming CR1, changing that continuation,
resetting root frames, or copying pristine Thread bodies after the fault
would be host-side recovery policy, not execution of an established trusted
recovery program. Copying just the stash into a fresh image would be equally
invalid evidence.

## Reproducible evidence

Run:

```sh
node simulator/test_alice_mallory_ascending.js
```

For values `1`, `679` (`0x2A7`), and `4095`, this checks:

1. Alice Stash/Reveal returns the exact value before the attack.
2. Mallory's absent C-list row faults with `NO_CAPABILITY` before its data read.
3. Both current activation entry points reject restart.
4. Those rejections preserve all memory, CRs, DRs, PC, the halt, fault log,
   and instruction evidence. They neither restore authority nor suppress a fault.
5. Alice's retained data equals the stashed value; the same location in the
   pristine image contains the compiled inline WORD, not that value.

The explicit `BOUNDARY` output is not a successful restart assertion.

## What is needed before the requested positive test is valid

Implement the approved responsible-Namespace recovery transition, with an
explicit trusted boot-context and Thread initialization contract over retained
object memory, preserved first-fault evidence, and first-Genesis escalation.
Establish a trusted fixture boot program that selects a Reveal-only path after
recovery using architectural state and instructions, not post-fault host writes.
The positive test must then execute Stash once, observe Mallory's hard fault,
restart, and observe Alice's exact Reveal result without another Stash; it must
also show that Mallory still has no Alice authority. Until those boundaries
are established, removing `beginBoot()`'s guard is not a valid implementation.
