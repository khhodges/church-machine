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