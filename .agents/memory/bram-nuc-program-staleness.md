---
name: BRAM NUC_PROGRAM staleness trap
description: church_ti60_f225.v BRAM becomes stale whenever boot_rom.py NUC_PROGRAM changes — requires a surgical patch or full Verilog regeneration.
---

## The rule

Any time `hardware/boot_rom.py` is edited (NUC_PROGRAM, BOOT_PROGRAM, or any
LUMP assembled into BRAM), `hardware/soc_combined/church_ti60_f225.v` **must**
be regenerated or its `initial begin` block must be patched.

**Why:** The Verilog BRAM `initial begin` block is generated at Amaranth
elaboration time. It does not auto-update when Python source changes.
Stale BRAM silently produces the wrong boot behavior on hardware.

**How to apply:**

*Option A — surgical patch (no Amaranth/Yosys toolchain needed):*
```python
# on Replit: run the inline patcher script (equivalent to what was done on
# 2026-06-15). It reads the correct BRAM words from boot_rom.py and updates
# only the changed dmem[] entries in the initial begin block.
python3 -c "
import sys, re
sys.path.insert(0, '.')
from hardware.boot_rom import _NUC_PADDED
# ... (see the full script from the 2026-06-15 session)
"
```

*Option B — full regeneration (requires Amaranth + Yosys):*
```bash
python hardware/gen_verilog.py --ti60
cp build/church_ti60_f225.v hardware/soc_combined/
```

*Always follow with — on the Chromebook before Efinity synthesis:*
```bash
python3 hardware/soc_combined/patch_cm_bram.py hardware/soc_combined
```
`patch_cm_bram.py` converts the `initial begin` block to `$readmemh`
(EFX_MAP ignores `initial begin` but correctly processes `$readmemh`).

## Diagnostic signature

If BRAM is stale, the firmware CALLHOME will show:
- `boot_ok:1` (CM hardware boot did complete)
- `fault:1` with `PERM_L` at some NIA, followed by `PERM_E` at NIA+4
- The faulting NIAs are code-relative within the NUC_LUMP (base at byte 0x3FC)
- NIA=0x8 → dmem[258], NIA=0xC → dmem[259] (in the NUC_PROGRAM region)

## NUC_LUMP layout (for reference)

- Header: dmem[255] = NUC_LUMP_HEADER (byte 0x3FC); cc=0 (no c-list)
- Code word 0: dmem[256] byte 0x400 → NIA=0x0
- Code word 2: dmem[258] byte 0x408 → NIA=0x8  ← faulting in stale build
- Code word 3: dmem[259] byte 0x40C → NIA=0xC  ← faulting in stale build
