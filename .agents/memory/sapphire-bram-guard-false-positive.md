---
name: Sapphire BRAM guard false-positive on stale firmware / all-FF placeholder
description: Two distinct RC=3 failure modes for check_bram_init_zero.sh — stale non-zero content (old firmware) vs all-FF MAP placeholder (Efinity 2026.1 normal). Only the first is a real problem.
---

## Mode 1: Genuine stale firmware (non-zero, wrong content)

After synthesis, verifying that the Sapphire SoC BRAM `INIT_0` is non-zero is **necessary but not sufficient**.  
The `check_bram_init_zero.sh` guard also performs a content spot-check: it compares the LSB (word-0 byte) of each lane's `INIT_0` against the corresponding compiled `symbol*.bin` file in `work_syn/`. A mismatch means synthesis embedded a stale firmware version and the guard exits 3.

**Why this matters:** Multiple full syntheses completed with non-zero BRAM guard, but the board still output 'C' (old firmware banner). The guard was finding the Sapphire `ram_symbol0..3` EFX_RAM10 instances, which were genuinely non-zero — but with OLD firmware bytes. The root cause was wrong `main.c` on the build machine.

**How to apply:**
- When the board outputs an unexpected banner after a rebuild, check `grep "KHURCH\|FW_MAJOR" hardware/soc_combined/firmware/main.c` on the BUILD machine (not Replit) before assuming synthesis or flash is broken.
- The build script passes `$SOC_DIR/work_syn` as the second argument to `check_bram_init_zero.sh`; if `work_syn/*.bin` are present, the content check runs automatically.
- Efinity 2026.1 stores `INIT_0` MSB-first: the LAST 2 hex chars of the 64-char `INIT_0` string = bits[7:0] of word 0 of that lane = first line of `symbol*.bin`.

## Mode 2: All-FF placeholder — Efinity 2026.1 normal (false positive)

**Confirmed 2026-07-15:** when Efinity 2026.1 MAP synthesises a design that uses `$readmemb` in sapphire.v, it does **NOT** inline the data into `INIT_0` in the output `map.v`. Instead it leaves INIT_0 = all-FF (`FFFF...FFFF`, 64 hex chars) as a placeholder. PNR reads the actual symbol bins at P&R time.

**Symptom:** `check_bram_init_zero.sh` RC=3 with `BRAM=0xff, compiled=0x17` (or similar) — but INIT_0 is 64 F's, not random non-zero content.

**Diagnosis:** if the full 64-char INIT_0 string is all-FF for ALL four symbol lanes, this is Mode 2 (false positive). If any lane has non-FF, non-zero content that doesn't match the symbol file, it's Mode 1 (genuine stale firmware).

**Resolution:** RC=3 is treated as a **warning** (not failure) in `build_ti60_bitstream.sh`. PNR will resolve `$readmemb` from symbol bins in `work_pnr/`, `$SOC_DIR/`, and `outflow/` (OBBS Step 3b deploys to all three). Flash and verify on board.

RC=1 (ALL lanes all-zero) remains a hard failure — that means the $readmemb path in sapphire.v is missing or broken and PNR will also get zeros.
