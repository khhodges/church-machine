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
cd ~/church_project/SoC/church-machine && git pull
cp build/church_ti60_f225.v ~/church_project/SoC/church_ti60_f225.v
python3 hardware/soc_combined/patch_cm_bram.py ~/church_project/SoC/
```

`patch_cm_bram.py` converts the 32-bit wide `dmem` array to 4 × 8-bit
byte-lane arrays (`dmem_b0..dmem_b3`) — see "EFX_MAP BRAM width trap" below.

## EFX_MAP BRAM width trap — CONFIRMED ROOT CAUSE (2026-06-21)

**EFX_MAP silently ignores `initial begin` on 32-bit-wide inferred arrays.**
Neither `initial begin` NOR `initial $readmemh(...)` initialises the BRAM
when the source is `reg [31:0] dmem [N:0]`.  The synthesised BRAM comes out
all-zeros → NIA stuck at 0x000 → NULL_CAP fault on every boot.

**What DOES work:** byte-wide arrays (`reg [7:0] lane [0:N]`) with
`initial begin lane[i] = 8'hXX; end`.  This is exactly what Amaranth/SpinalHDL
generates for the Sapphire SoC firmware RAM — and why Sapphire initialises
correctly while the CM BRAM does not.

**The fix (implemented in `patch_cm_bram.py`):**
1. Replaces `reg [31:0] dmem [N:0]` with four `reg [7:0] dmem_b0..b3 [0:N]`
2. Replaces the single `initial begin` with byte-lane assignments (hex, sparse)
3. Replaces the write `always` block with 4-lane byte writes
4. Replaces the read `always` block with `{dmem_b3, dmem_b2, dmem_b1, dmem_b0}`

**Key diagnostic:** If `church_ti60_f225.v` still has `reg [31:0] dmem`,
patch_cm_bram.py has not been run (or the wrong version ran).

## NIA offset vs LUMP layout — CRITICAL

The NIA the APB3 bridge reports is a **byte offset from the LUMP base**.  The
LUMP base for Boot.Abstr is at `dmem[255]` = byte `0x3FC`.

**CONFIRMED (2026-06-15): church_ti60_f225.v in repo has NEW layout.**
Verified by reading `dmem[255] = 0xF8004400` = NUC_LUMP_HEADER with cw=17
(no embedded c-list). Code starts at dmem[256] = NIA=0x004.

**New layout (current church_ti60_f225.v in soc_combined repo):**

| Region         | dmem[]       | NIA offset |
|:---------------|:-------------|:-----------|
| LUMP header    | 255          | 0x000      |
| NUC code word 0 | 256         | 0x004      |
| NUC inner delay (word 11) | 267 | **0x030** |
| NUC last word (word 16)   | 272 | 0x044      |

**Old layout (pre-"Update embedded program" commit) — historical reference:**

| Region         | dmem[]       | NIA offset |
|:---------------|:-------------|:-----------|
| LUMP header    | 255          | 0x000      |
| Embedded c-list (89 words) | 256–344 | 0x004–0x164 |
| NUC code word 0 | 345         | 0x168      |
| NUC inner delay (word 11) | 356 | **0x194** |
| NUC last word (word 16)   | 361 | 0x1A8      |

**Why this matters for the firmware hung-watchdog:**
`NUC_CODE_START` / `NUC_CODE_END` in `main.c` must match the layout that is
actually synthesised.  Mismatch → HUNG fires during the delay loop → LED
blinks once then stops.

**Current correct values (firmware v2.3, new layout):**
```c
#define NUC_CODE_START   0x00000000u   /* floor: code starts at NIA=0x004 */
#define NUC_CODE_END     0x00000044u   /* ceiling: last instr at NIA=0x044 */
```

## Script targets — soc_combined, not SoC_minimal

All three synthesis scripts (`run_efx_map.sh`, `run_efx_pnr.sh`,
`run_efx_pgm.sh`) now default to `church_soc_cm.xml` in their own directory
(`hardware/soc_combined/`).  The Makefile `bitstream-flash` target also
derives PROJECT from its own directory.  Do NOT override to
`~/church_project/SoC_minimal/` — that is a stale GUI project.

## Diagnostic signature

If BRAM is stale or the NUC_CODE range is wrong, the firmware CALLHOME shows:
- `boot_ok:1` (CM hardware boot did complete)
- NIA stuck at one value for 3 consecutive 1-s samples (HUNG fires)
- If NIA=0x030: new-layout BRAM, fix is NUC_CODE_START=0x000/END=0x044 ✓
- If NIA=0x194: old-layout BRAM, fix is NUC_CODE_START=0x160/END=0x1B0

## Build script (scripts/build_ti60_bitstream.sh) fixes — 2026-06-21

- Step 1: now does `make -C firmware clean` before `make` — prevents stale
  .elf reuse across git pull cycles (was silently keeping old FW version)
- Step 2.5: now calls `patch_cm_bram.py` after deploying church_ti60_f225.v
  and BEFORE running synthesis — eliminates the 32-bit BRAM init failure
