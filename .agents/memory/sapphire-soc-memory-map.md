---
name: Sapphire SoC memory map for this Ti60F225 build
description: Correct ROM/RAM/peripheral addresses for the Efinix Sapphire VexRiscv SoC used in soc_minimal — NOT the standard defaults
---

The sapphire.v address decoder (from `grep "32'h[fF]"`) reveals:

| Region | Address | Mask | Size |
|---|---|---|---|
| ROM/SRAM (CPU boot) | 0xF9000000 | ~0x00007FFF | 32 KB |
| Peripheral bus | 0xF8000000 | ~0x00FFFFFF | 16 MB |

CPU reset vector: `IBusCachedPlugin_fetchPc_pcReg <= 32'hf9000000`

**Correct link.ld:**
- ROM ORIGIN = 0xF9000000, LENGTH = 16K
- RAM ORIGIN = 0xF9004000, LENGTH = 16K

**Correct firmware addresses:**
- UART_BASE = 0xF8010000
- GPIO_BASE  = 0xF8020000

**Why:** sapphire_define.vh in this Efinix 2026.1 build is empty (copyright only). All addresses must be confirmed by grepping sapphire.v for `32'h[fF]` literals. Standard defaults (0x00000000/0xF0010000) are WRONG for this IP version.

**How to apply:** Any new firmware for this SoC must use these addresses in link.ld and main.c. Confirm by checking `riscv-none-embed-objdump -f firmware.elf | grep "start address"` — must show `0xf9000000`.
