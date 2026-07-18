---
name: CM DMEM Thread.caps[0] boot fix
description: Which NS slot Thread.caps[0] must target for CM boot, and where the lazy-load stub lives
---

## The rule

`hardware/ti60_f225.py` must set these two words after building `dmem_init`:

```python
dmem_init[125] = 0x4A000006  # E-GT → NS slot 6 (SelfTest)
dmem_init[384] = 0xF8000000  # DMEM 0x0600: lazy-load stub (magic=0x1F, cw=0)
```

**Why:**
- `SELFTEST_NS_SLOT = 6` (from `hardware/hw_types.py`). The OLD value `0x4A000004` pointed at slot 4 = BTN_DEV MMIO — a leftover from when slot 4 was Salvation/NUC_PROGRAM. On first CALL after boot the CM read a lump header from an MMIO address and faulted immediately.
- NS slot 6 word0_location = 0x0600. The stub at word 384 has cw=0 → CODE_NOT_RESIDENT → lazy_load_irq → ChurchIRQDispatch checks Scheduler.IRQ (NS slot 8) → slot 8 zero in 8-slot BRAM namespace → null_base_fault → Sapphire callhome → IDE uploads real SelfTest lump via PATCH_LUMP → CM retries → SelfTest runs. Callhome IS the lazy-load fetch transport.

**Value breakdown:**
- `0x4A000006` = make_gt(GT_TYPE_INFORM, PERM_MASK_E, slot=SELFTEST_NS_SLOT=6, seq=0)
- `0xF8000000` = (0x1F << 27), magic field only, all other fields zero

## DMEM address geometry

- Thread lump base: DMEM byte `0x100` = DMEM word 64
- Thread.caps zone offset: byte +244 = word +61 from base → DMEM word **125**
- Lazy-load stub: DMEM byte `0x0600` = DMEM word **384** (= 0x600 / 4)
- `dmem_init` layout: `ns_init` (256 words) + `clist_init` (64 words) + zeros to 16384

## How to apply

Any time `SELFTEST_NS_SLOT` changes in `hw_types.py`:
```python
dmem_init[125] = make_gt(GT_TYPE_INFORM, PERM_MASK_E, SELFTEST_NS_SLOT, 0)
```
Any time NS slot 6 word0_location changes, update `dmem_init[384]` address accordingly.

Then regenerate both artifacts:
```bash
python3 -m hardware.gen_verilog --ti60               # → build/church_ti60_f225.v
python3 hardware/soc_combined/gen_cm_dmem_direct.py  # → ./cm_dmem_bram.v  (root, not soc_combined/)
```

Note: `cm_dmem_bram.v` lives at the **workspace root** (`./cm_dmem_bram.v`), not in `hardware/soc_combined/`.

## BRAM INIT verification

After regen, verify with:
```python
import re
inits = dict(re.findall(r'\.INIT_([0-9A-Fa-f]+)\s*\(256\'h([0-9A-Fa-f]+)\)', open('cm_dmem_bram.v').read()))
# Word 125 → INIT_F, position 5 from MSB
hex_str = inits['F'].zfill(64); assert int(hex_str[5*8:6*8], 16) == 0x4A000006
# Word 384 → INIT_30, position 0 from MSB  
hex_str = inits['30'].zfill(64); assert int(hex_str[0:8], 16) == 0xF8000000
```

## CM DMEM init mechanism

EFX_MAP silently ignores `initial begin` blocks on inferred arrays. The current
confirmed-working technique is `hardware/soc_combined/gen_cm_dmem_direct.py`,
which emits an explicit `cm_dmem_bram` module (EFX_RAM10 instantiation with
inline `INIT_N` params, no `$readmemb`). The old `patch_cm_bram.py` approach
is OBSOLETE.

`scripts/build_ti60_bitstream.sh` Step 2.5 runs `gen_cm_dmem_direct.py` BEFORE
`run_efx_map.sh`. Step 0b self-tests freshness (`scripts/check_cm_dmem_bram_fresh.sh`) —
it does not patch anything itself.

## Verification after flash

UART should show `CHURCH Ti60 SoC+CM v2.4` then a complete callhome JSON
ending with `"lump_done":"OK"` (not truncated at `"fault_code":`).
