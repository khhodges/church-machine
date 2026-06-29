---
name: Sapphire BRAM byte-store hang
description: BRAM dBus on Sapphire SoC does not support byte-enable writes; any sb instruction to 0xF9007xxx hangs the CPU permanently
---

## Rule
Any `sb` (byte store) instruction targeting the BRAM data region (0xF9007000–0xF9007FFF — stack and .bss) hangs the RISC-V CPU permanently on this Efinity Ti60 Sapphire SoC implementation. Only word stores (`sw`) and word loads (`lw`) are safe.

## Confirmed hang-triggering patterns
- `volatile uint32_t i` in a delay loop → GCC emits `sw`+`lw` to stack → hangs (fixed by using asm `"+r"` constraint)
- `char buf[N]` local array written with `buf[i] = x` → GCC emits `sb` → hangs
- `uint8_t buf[64]` struct field written via `_sha256_update` (ctx->buf[ctx->datalen++] = data[i]) → sb to stack → hangs
- `_sha256_memcpy` / `_sha256_memset` with byte pointers → sb → hangs
- `_rx_buf[_rx_len++] = c` — static char[] in .bss at 0xF9007xxx → sb → hangs (only triggered on UART RX command receipt)

## Observed symptom
Output always truncates at exactly the point where the first `sb` instruction executes. Four consecutive firmware builds all stopped at `"fault_code":` — because sha256.h was included and sha32()/hkdf() were reachable via the inlined function call graph, causing sb to appear in the CALLHOME code path.

## Fixes applied in firmware v2.4
1. **sha32 tokens precomputed** — `_NS_TOKENS[9]` table of `const uint32_t` replaces all `sha32(ogt)` calls; no sha256.h byte stores in CALLHOME path
2. **cm_derive_keys loop disabled** — hkdf_sha256 byte stores suppressed; keys stay zero until a byte-store-safe sha256 implementation is written
3. **Diagnostic uart_putc('X')** added before `uart_puthex32_lower(fault_code)` to distinguish call-site hang vs inside-function hang
4. **CALLHOME moved before 3-second delay** — tests whether a time-triggered AXI glitch was also a factor

## Why
The Efinix BRAM macro used for Sapphire ROM/RAM is configured without byte-enable outputs on the write port (or they are undriven). The SpinalHDL AXI→BRAM bridge emits a byte-write strobe that the BRAM ignores or that stalls PREADY on the data bus indefinitely.

## How to apply
- ANY local `uint8_t` array written to → must be replaced with `uint32_t` arrays with manual packing
- ANY `memcpy`/`memset` from/to byte arrays → must use word-aligned 4-byte copies
- ALL sha256.h functions (`sha256`, `hmac_sha256`, `hkdf_sha256`, `sha32`) → avoid at runtime; precompute or stub out
- `uart_putdec` was already rewritten to use only scalar `uint32_t` arithmetic (no char array)
- static `char` arrays written via `sb` (e.g. `_rx_buf`) → safe only when write path is never triggered
