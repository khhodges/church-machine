---
name: Persistent Thread strip
description: User requirement for Thread visibility across IDE views and execution states.
---

The configured Thread strip should show all the time, including CR12 inspection,
before boot and after Reset.

**Why:** The user saw three Threads disappear in the CR12 view and explicitly
stated, “it should show all the time.”

**How to apply:** Keep Thread visibility independent of register selection and
execution state. Distinguish configured context from live runtime values without
inventing running state or changing machine authority just to populate the UI.

For a hardware target, the strip must identify the faulted Thread from correlated
hardware evidence, independently of the simulator runtime. Show a fault state,
never a running highlight, and retain the other configured Threads.

**Why:** The user expected Thread.3 to be highlighted after the Mallory hardware
fault and explicitly approved fixing the simulator-only strip.

**How to apply:** Match the captured Thread slot and available bridge PetName,
respect board/session identity, and clear the highlight when the active fault
clears. Do not activate simulation or borrow its runtime values.
