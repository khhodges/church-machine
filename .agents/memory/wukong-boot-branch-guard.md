---
name: Wukong boot ROM BRANCH -1 guard
description: Missing BRANCH -1 at ROM word 3 causes fault-on-RETURN loop with NULL GTs and fault LED
---

# Wukong boot ROM BRANCH -1 guard (fixed in v12)

## The rule
`_WUKONG_ROM` in `wukong_top.py` must have a `BRANCH -1` at word index 3 (NIA=0x0000000C).

## Why
BOOT_PROGRAM[:3] = [LOAD, CHANGE, CALL]. CALL is at NIA=0x00000008.
SelfTest's return address = NIA+4 = 0x0000000C. Without a guard there, word 3 is
0x00000000 (zero-encoded instruction). Executing a zero word triggers a CM fault,
fault recovery wipes all CRs (NULL GTs), machine loops from NIA=0x00000000 with dead
registers — the fault LED lights and the machine can never receive an IRQ to load a
program. The gap between RETURN and the next Boot.0 with NULL GTs was ~42 seconds
(fault recovery timeout).

## How to apply
```python
_BRANCH_MINUS_1 = encode_turing(TuringOpcode.BRANCH, CondCode.AL, imm=(-1) & 0x7FFF)
_WUKONG_ROM = list(BOOT_PROGRAM[:3]) + [_BRANCH_MINUS_1] + [0] * (1024 - 4)
```
`encode_turing` must be imported from `.boot_rom` (not in `hw_types`).

## Symptom in trace
```
RETURN pop → depth=0
[~42s gap]
Boot.0 LOAD.shadow GT=0x00000000 (NULL GT)   ← dead register, fault LED on
Boot.0 LOAD.new   GT=0x00000000 (NULL GT)
```

## Diagnostic signal
Fault LED ON after boot = first thing to check is ROM word 3.
