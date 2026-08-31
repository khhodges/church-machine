---
name: Wukong focused production simulation
description: How to keep production RTL behavioral tests bounded when Amaranth PySim cannot prepare the complete Wukong top promptly
---

Amaranth's Python simulator can spend minutes preparing the complete Wukong
top before cycle zero, even when large-design elaboration caches are installed
and the 16K-word simulated DMEM initializer is omitted. Cycle deadlines cannot
bound work that happens before the simulator starts.

**Why:** Upload watchdog regressions previously appeared to hang indefinitely.
Reducing simulated cycles did not help because `Simulator(full_top)` itself was
the blocking operation.

**How to apply:** For focused production behavioral tests, use a simulation-only
top profile that calls the same shared FSM builder as normal hardware
elaboration. Never duplicate the RTL in a test-only model. Keep normal hardware
defaults unchanged, add an explicit cycle deadline, and dump the shared FSM's
state and counters when that deadline is reached.