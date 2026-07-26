---
name: LOAD hardware M-elevation — boot microcode rule
description: During boot (boot_state_reg != COMPLETE), all LOAD instructions are M-elevated in core.py; NUC_PROGRAM workaround was wrong and has been removed
---

## The Rule

**During boot microcode** (`boot_state_reg != BootState.COMPLETE`): all LOAD
instructions are M-elevated — boot microcode has full privilege, matching
`change.py`'s pattern.

**After boot completes** (programmer code): LOAD to/from CR > 11 requires
a passkey mechanism (future task) to get M-elevation.

## Hardware fix (core.py)

```python
u_shared_mload.sub_m_elevated.eq(
    u_load.mload_m_elevated | (boot_state_reg != BootState.COMPLETE)
)
```

This mirrors `change.py` line: `u_change.m_elevated.eq(boot_state_reg != BootState.COMPLETE)`.

## Simulator fix (simulator.js `_execLoad`)

```js
const check = this.mLoad(clistGT, (d.crSrc === 6 || !this.bootComplete) ? null : 'L', ...);
```

Bypasses L-perm check when `!this.bootComplete`.

## wukong_top.py

`BOOT_PROGRAM` is now correctly at ROM[0]. The old NUC_PROGRAM workaround
(using `cr_src=CR6` to sneak past PERM_L) was wrong and has been reverted.

## Why the old note was wrong

The old trap note claimed BOOT_PROGRAM[0] always faults on standalone FPGA.
It does — but the fix is to elevate boot-phase LOAD in hardware, not to
replace BOOT_PROGRAM with a workaround program.

**How to apply:** Never put NUC_PROGRAM at ROM[0] as a PERM_L workaround.
If BOOT_PROGRAM[0] faults, the hardware M-elevation gate needs fixing, not the ROM.
