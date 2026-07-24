# M2 — Wukong `rst_n` Button Is Constrained But Unconnected

## Priority
**Medium** — The physical reset button (M6, active-low) does nothing. A fault-stuck
board must be re-flashed to recover rather than pressing the button. This degrades the
development experience significantly.

## Root Cause
`hardware/wukong_top.py`:
```python
self.rst_n = Signal(init=1)  # Active-low button (M6) — constrained, reserved
```
The signal is declared and constrained in the XDC but is never read in `elaborate()`.
The docstring says "constrained but not wired to soft reset."

## Why It Was Left Unconnected
`replit.md` documents the `reset_less=True` decision:
> "A soft rst_sr in the sync domain that drives `ResetSignal("sync")` self-deadlocks:
> under reset the register is reset to its init value (0xFF) every cycle, keeping reset
> asserted permanently."

So a naive `reset_less=False` approach with a shift-register POR causes the Artix-7
sync domain to dead-lock permanently. The Amaranth-level soft reset is documented as
broken for this target.

## Correct Fix: Asynchronous Clear via `rst_n`

Instead of driving `ResetSignal("sync")`, wire `rst_n` to an **asynchronous clear** on
the boot_triggered and fault_latched FFs only. This gives a partial reset: the boot
sequencer re-runs (re-initialises DMEM, re-pulses `boot_start`), but the sync domain
clock itself is not interrupted.

```python
# In elaborate(), after boot_triggered is declared:
with m.If(~self.rst_n):
    m.d.sync += [
        boot_triggered.eq(0),
        boot_delay.eq(0),
        hw_init_ctr.eq(0),
        fault_latched.eq(0),
        hb_ctr.eq(0),
        hb_blink.eq(0),
    ]
```

This is safe because:
- `reset_less=True` means these FFs have no synthesis-level reset input, so the
  async-clear logic is purely user-level combinatorial/sync logic, not a clock-domain
  reset signal — no Amaranth deadlock risk.
- The ChurchCore's own boot FSM is re-triggered by the new `boot_start` pulse from the
  re-run hw_init sequencer, causing the core to re-execute its own FAULT_RST→LOAD_NS→
  INIT_THRD→INIT_CLIST→LOAD_NUC sequence.
- DMEM is re-written correctly by the hw_init sequencer before `boot_start` fires.

**Important**: `boot_start` must be kept low until the entire hw_init write sequence
completes again (the existing gating already handles this since `boot_triggered` is
cleared to 0 by the button press, restarting Phase 1 + Phase 2 + Phase 3).

## Files to Change

| File | Change |
|------|--------|
| `hardware/wukong_top.py` | Add async-clear block gated on `~self.rst_n` for `boot_triggered`, `boot_delay`, `hw_init_ctr`, `fault_latched`, `hb_*` |
| `hardware/test_wukong_rst.py` | New: simulation test verifying that asserting `rst_n=0` for 2 cycles clears `boot_triggered` and causes the hw_init sequencer to restart |

## Acceptance Criteria
1. Simulation: asserting `rst_n = 0` clears `boot_triggered`; the hw_init sequencer
   restarts from Phase 1; `boot_start` is pulsed again after `N_INIT` cycles.
2. After `rst_n` is released (`rst_n = 1`), the boot sequence completes normally and
   `boot_triggered` re-latches.
3. `fault_latched` is cleared by the reset, so LED1 (fault indicator) returns to
   solid-ON (no fault) after button press.
4. No synthesis error: Vivado accepts the design with `rst_n` driving user logic only
   (not `ResetSignal`).

## Risks
- **ChurchCore internal state**: The core's own registers (capability registers,
  NIA, etc.) are NOT reset by `~rst_n` in this approach — only the top-level boot
  sequencer resets. The core's FAULT_RST state (inside `core.py`) handles its own
  register clearing when `boot_start` fires again. Verify `core.py` clears all
  architectural state in FAULT_RST before implementing.
- **Hold time**: `rst_n` is a mechanical button that may bounce. Consider a 2-cycle
  debounce filter (two-FF synchroniser + majority vote) to avoid false resets.
- **DMEM re-write latency**: The hw_init sequencer takes ~N_INIT ≈ 13 cycles to
  re-write DMEM. During this window the core is idle (boot_start not yet pulsed),
  which is correct. Confirm `core.boot_start` is not accidentally asserted during
  re-init.

## Depends On
Independent. Low risk. Should land before V2 tapeout to allow development recovery
without re-flashing.
