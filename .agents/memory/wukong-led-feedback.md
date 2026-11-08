---
name: Wukong LED feedback
description: Two-bit CHANGE counter and overriding Hard Fault indication
---

The user selected a two-bit counter on the Wukong user LEDs and required
an indication of any Hard Fault.

**Why:** Provide physical execution feedback without using one of the two LEDs
exclusively for normal fault status.

**How to apply:** Count successful CHANGE completions modulo four. The documented
design uses a latched simultaneous blink to override the count for Hard Faults.
Keep this observation separate from execution/fault recovery and from approval
to build or flash hardware. The blink encoding is an implementation choice,
not a separately user-selected pattern.
