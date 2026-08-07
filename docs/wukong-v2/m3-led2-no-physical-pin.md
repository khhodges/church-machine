# M3 — MMIO reg 2 (LED2_RGB) Has No Physical Pin on Wukong

## Priority
**Medium** — Silent failure: DWRITE to MMIO reg 2 updates an internal register with
no physical effect. A CLOOMC program that queries LED2 via DREAD gets the register
value back, creating the illusion that the write succeeded. No fault is raised.

## Root Cause
`hardware/wukong_top.py`, MMIO decode section:
```python
# MMIO register 2:
with m.Case(2):
    m.d.sync += mmio_led_reg[2].eq(core.dmem_wr_data[:3])
```
Comment: `# LED2_RGB (no physical pin on this minimal build)`

The Wukong V3 has exactly 2 user LEDs (G21, G20). The MMIO register map includes
LED2_RGB for backward compatibility (the previous platform has 3 user LEDs), but there is no physical
connection for pin 2 on the Wukong.

## Options

### Option A — Read-back returns WRITES_IGNORED sentinel (recommended)
Return a known constant (e.g. `0xFFFFFFFF` or bit 3 set) on DREAD of reg 2, so a
program can detect that LED2 is not present and skip the write:

```python
with m.Case(2):
    m.d.comb += mmio_rd_data.eq(0x00000008)  # bit 3 = "no physical LED"
```
Add documentation: "bit 3 of LED_RGB read-back = 1 means no physical LED present."
This allows portable CLOOMC programs to query capability before use.

### Option B — Raise an INVALID_OP fault on write to reg 2
Change the DWRITE handler for reg 2 to assert `core.fault_valid` with
`FaultType.INVALID_OP`. This is more aggressive (breaks any program that
writes all 3 LEDs unconditionally) and not recommended.

### Option C — Document the no-op (simplest)
Add a comment and a constant `WUKONG_LED_COUNT = 2` in `hardware/hw_types.py`.
CLOOMC programs targeting Wukong know to skip writes to reg 2. No hardware change.

Option C is appropriate for V2 since the LED2 absent state is already implicitly
correct (no misbehaviour, just a silent no-op).

## Files to Change

| File | Change |
|------|--------|
| `hardware/wukong_top.py` | Add comment `# LED2_RGB: no physical pin; writes are no-ops; reads return 0x08 (absent-LED sentinel)` |
| `hardware/hw_types.py` | Add `WUKONG_LED_COUNT = 2` constant |
| `docs/HARDWARE.md` | Add Wukong LED section noting only 2 physical LEDs; LED2 MMIO is absent-sentinel |

## Acceptance Criteria
1. (Option A) Simulation: DREAD of MMIO reg 2 returns `0x08` (absent-sentinel).
2. (Option C) `WUKONG_LED_COUNT = 2` constant exists in `hw_types.py`.
3. `docs/HARDWARE.md` documents the 2-LED limitation for Wukong.
4. No existing test is broken (no test asserts on LED2 state for Wukong).

## Risks
- **LED count difference**: The previous platform has 3 LEDs. Programs compiled for it that write
  all 3 LEDs will behave differently on Wukong (reg 2 is a no-op). This is inherent to
  the hardware difference. Document clearly; do not attempt to unify the behaviour.

## Depends On
Independent. Very low risk. Documentation change + one constant.
