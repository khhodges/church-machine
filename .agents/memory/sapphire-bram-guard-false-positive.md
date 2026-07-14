---
name: Sapphire BRAM guard false-positive on stale firmware
description: Non-zero INIT_0 in map.v only proves the BRAM is populated; it does NOT prove the CURRENT firmware was embedded. A content spot-check is required.
---

## The rule

After synthesis, verifying that the Sapphire SoC BRAM `INIT_0` is non-zero is **necessary but not sufficient**.  
The `check_bram_init_zero.sh` guard now also performs a content spot-check: it compares the LSB (word-0 byte) of each lane's `INIT_0` against the corresponding compiled `symbol*.bin` file in `work_syn/`. A mismatch means synthesis embedded a stale firmware version and the guard exits 3 (treated as fatal by the build script).

**Why:** Multiple full syntheses completed with non-zero BRAM guard, but the board still output 'C' (old firmware banner). The guard was finding the Sapphire `ram_symbol0..3` EFX_RAM10 instances, which were genuinely non-zero — but with OLD firmware bytes. The root cause was wrong `main.c` on the build machine; the guard had no way to detect this without comparing against the compiled output.

**How to apply:**
- When the board outputs an unexpected banner after a rebuild, check `grep "KHURCH\|FW_MAJOR" hardware/soc_combined/firmware/main.c` on the BUILD machine (not Replit) before assuming the synthesis or flash step is broken.  
- The build script passes `$SOC_DIR/work_syn` as the second argument to `check_bram_init_zero.sh`; if `work_syn/*.bin` are present, the content check runs automatically.
- Efinity 2026.1 stores `INIT_0` MSB-first: the LAST 2 hex chars of the 64-char `INIT_0` string = bits[7:0] of word 0 of that lane = first line of `symbol*.bin`.
