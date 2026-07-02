---
name: CM DMEM Thread.caps[0] boot fix
description: DMEM word 125 must be 0x4A000004 for CM to boot; how patch_cm_bram.py fits in the MAP flow
---

## The rule

`hardware/ti60_f225.py` must set `dmem_init[125] = 0x4A000004` after building `dmem_init`.

**Why:** DMEM word 125 = Thread.caps[0] = the capability the CM uses to call NUC_PROGRAM (Salvation) at boot. Without it the very first ELOADCALL faults with NULL_CAP and the firmware triggers a system reset, truncating the callhome JSON at `"fault_code":`.

**Value breakdown:** `0x4A000004` = E-GT (GT_TYPE_INFORM), permission mask E, NS slot 4 (Salvation/NUC_PROGRAM), seq 0.

**How to apply:** Any time `hardware/ti60_f225.py` or `hardware/boot_rom.py` is changed, verify this line is present:
```python
dmem_init[125] = 0x4A000004
```
Then regenerate Verilog: `python3 -m hardware.gen_verilog --ti60` and copy to `hardware/soc_combined/church_ti60_f225.v`.

## DMEM address geometry

- Thread lump base: DMEM byte `0x100` = DMEM word 64
- Thread.caps zone offset: byte +244 = word +61 from base → DMEM word **125**
- `dmem_init` layout: `ns_init` (256 words) + `clist_init` (64 words) + zeros to 16384
- DMEM word 511 = SlideRule lump header (already set)

## CM DMEM init — SUPERSEDED, now gen_cm_dmem_direct.py + cm_dmem_bram

EFX_MAP silently ignores `initial begin` blocks on inferred arrays, so the DMEM
init still has to be forced in some other way. The originally-documented fix
(`patch_cm_bram.py`, four byte-lane `$readmemb` arrays) is now OBSOLETE and
UNUSED — see `obbs-single-patch-location.md`. The current, confirmed-working
technique is `hardware/soc_combined/gen_cm_dmem_direct.py`, which emits an
explicit `cm_dmem_bram` module (EFX_RAM10 instantiation with inline `INIT_N`
params, no `$readmemb`).

`scripts/build_ti60_bitstream.sh` Step 2.5 runs `gen_cm_dmem_direct.py` and
deploys both the patched `church_ti60_f225.v` and `cm_dmem_bram.v` BEFORE
`run_efx_map.sh` is invoked. `run_efx_map.sh` Step 0b only self-tests that
this already happened (`scripts/check_cm_dmem_bram_fresh.sh`) — it does not
patch anything itself.

## Verification after flash

UART should show `CHURCH Ti60 SoC+CM v2.4` then a complete callhome JSON ending with `"lump_done":"OK"` (not truncated at `"fault_code":`).
