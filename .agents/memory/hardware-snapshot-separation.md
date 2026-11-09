---
name: Hardware snapshot separation
description: Physical Wukong snapshots update displayed architectural state without taking over simulator execution state.
---

Hardware NIA is a physical instruction address, so applying a validated snapshot must update the simulator’s hardware cursor and displayed registers without replacing logical simulator PC or breakpoint collections. Live CR12 and the suspended thread’s stored CR12-related words are separate contexts and should remain visibly separate.

**Why:** The physical board and simulator can be stopped at the same instruction while having different address/continuation representations; conflating them would make later simulator execution misleading.

**How to apply:** Keep complete stored-thread fields under the hardware snapshot object and render them as read-only hardware context. Never call `step()` or mutate simulator breakpoint state while applying a snapshot.

## Comparing RTL assertions with UART evidence

Compare condition flags by their named meanings, not raw packed integers across internal RTL and UART representations.

**Why:** A handoff review initially quoted the internal packed flag value as the expected UART value. The physical snapshot used a different packing order but represented the same Z-only state; treating those integers as equivalent would have falsely diagnosed a hardware failure.

**How to apply:** Inspect the exact candidate's flag layout and snapshot serializer before declaring a mismatch. State any correction to previously supplied expectations explicitly.

## Isolated RTL imports

Run isolated candidate tests from their source root and restrict pytest's
ancestor configuration discovery; PYTHONPATH alone is not sufficient.

**Why:** Running an external test from the main workspace loaded the production
hardware package instead of the candidate despite a candidate PYTHONPATH,
producing a misleading unsupported-constructor error.

**How to apply:** Verify the imported module's origin when comparing candidate
behavior with production. Do not modify candidate RTL to fix import failures.

## Retirement-triggered diagnostic stops

Latch a retirement-triggered stop at the clock edge; do not feed its
combinational result back into fetch validity or halt inputs.

**Why:** A private resume/retry diagnostic initially stalled simulation because
retirement itself depended on those inputs. The existing pre-acceptance
handoff-stop gating cannot be reused unchanged for a retirement-triggered stop.

**How to apply:** Distinguish pre-instruction stops from post-retirement stops,
and prove that the next instruction is not accepted after the latch takes effect.

## Diagnostic evidence classification

Keep successful instruction counts separate from fault-event observations.

**Why:** A missing-permission diagnostic correctly hard-faulted, but counting
every trace event as a successful instruction falsely reported that the
faulting access had committed. Trace labels alone are not architectural proof.

**How to apply:** Check fault state alongside trace events, verify the faulting
address explicitly, and use actual memory writes and terminal state to support
claims about publication or execution.