---
name: Ti60 SoC UART clockDivider
description: Sapphire SoC UART baud config, soc.hex SPI boot constraints, and working firmware pattern for Ti60F225
---

## The Rule

The Sapphire SoC UART `clockDivider` register resets to **0x00** on power-up.
Firmware **must** write `UART_CLOCKDIV = 53` before the first `uart_puts()` / `uart_putc()` call.

## Register address

```c
#define UART_CLOCKDIV  (*(volatile uint32_t *)(0xF8010000UL + 0x08))
```

Offset +0x08 from UART_BASE (0xF8010000).

## Baud rate formula

```
baudRate = ClkIn / (8 × (clockDivider + 1))
```

Ti60F225 crystal is **50 MHz**; the Sapphire SoC PLL doubles it to **100 MHz**.
For 230400 baud at 100 MHz:
```
clockDivider = (100_000_000 / (8 × 230_400)) − 1 = 53.25 → 53
actual baud  = 100_000_000 / (8 × 54) = 231_481  (0.47% error — fine)
```

**Why:** The Sapphire SoC IP generator comment in sapphire.v was misread as
"clockDivider resets to 0x35" but the Verilog RTL default for the register is 0x00.
Always set explicitly. Without this write, UART runs at 100 MHz / 8 = 12.5 Mbaud —
complete silence on any standard terminal.

## soc.hex SPI boot bootloader constraint: USER_SOFTWARE_SIZE = 252 bytes

The stock soc.hex bootloader copies exactly **252 bytes** from SPI data flash
(at offset 0x380000) into BRAM before jumping to 0xF9000000. Any firmware bytes
beyond offset 252 are **not copied** — old BRAM content (soc.hex demo code,
i.e. RISC-V opcodes) remains at those addresses.

**Symptom:** Firmware that uses string literals placed beyond byte 252 reads
old BRAM content and outputs garbled RISC-V opcodes over UART (e.g.
`C\xf0\x9f\xef\x13\x05\x80\x03\xef...` instead of "CHURCH…"). The first
char 'C' is often correct because it gets hardcoded as an immediate by the
compiler.

**Key diagnostics:**
- `baud_test.bin` (172 bytes, no memory reads): works ✓
- `asm_uart.bin` (480 bytes, immediate chars only): works ✓
- `main_soc.bin` (420 bytes, string at byte 356): FAILS — 356 > 252

**Root cause confirmed by objdump:** `.text` section showed strings at
`0xF9000164` (byte offset 356) — beyond the 252-byte copy window.

## Working firmware pattern for soc.hex (no APB3)

Use immediate character writes with a register-only delay. No strings in
memory, no stack usage for the output loop:

```c
#include <stdint.h>
static inline void D(uint32_t n) {
    __asm__ volatile("1: addi %0,%0,-1\n bne %0,zero,1b\n" : "+r"(n));
}
void main(void) {
    volatile uint32_t *u = (volatile uint32_t *)0xF8010000;
    u[2] = 53;   /* UART_CLOCKDIV: 100 MHz / (8×54) = 230400 baud */
#define P(c) u[0] = (1u<<8)|(unsigned char)(c); D(3000)
    for (;;) {
        P('C'); P('H'); P('U'); P('R'); P('C'); P('H'); P(' ');
        P('T'); P('i'); P('6'); P('0'); P(' ');
        P('S'); P('o'); P('C'); P('+'); P('C'); P('M'); P(' ');
        P('v'); P('1'); P('.'); P('1'); P('\r'); P('\n');
    }
}
```

Saved as `hardware/soc_combined/firmware/full_uart.c` on Penguin.

**Why P() works:** Each character is an immediate constant in the instruction
stream — no memory read for string data. `D()` uses `"+r"` register constraint
so the counter stays in a CPU register (no stack write). Binary fits well
within 252 bytes.

## For full main.c (with APB3 / CM boot)

The full `main.c` requires a **combined bitstream** (CM + Sapphire SoC APB3
bridge). The soc.hex stock design does NOT map CM_APB_BASE (0xF8100000) — any
access immediately bus-faults the CPU. The full firmware also exceeds 252 bytes.

When the combined bitstream is ready:
- Use a larger USER_SOFTWARE_SIZE (re-synthesise soc.hex with bigger value), OR
- Embed firmware in BRAM init files (the synth9 approach documented in efx-map-readmemb.md)

## BRAM layout (soc.hex design)

```
0xF9000000 — BRAM start (8 KB confirmed working)
0xF9002000 — BRAM end / stack top (_stack_top in link.ld)
0xF8010000 — UART_BASE (UART_DATA +0, UART_STATUS +4, UART_CLOCKDIV +8)
0xF8100000 — CM APB3 bridge (NOT in stock soc.hex — bus fault if accessed)
```

## How to flash (Penguin)

```bash
# Compile
T=~/efinity/efinity-riscv-ide-2025.2/toolchain/bin
$T/riscv-none-embed-gcc -march=rv32i -mabi=ilp32 -O2 \
  -nostartfiles -nodefaultlibs -Ttext=0xF9000000 \
  -o full_uart.elf full_uart.c
$T/riscv-none-embed-objcopy -O binary full_uart.elf full_uart.bin

# Flash FPGA config (soc.hex)
sudo /usr/bin/openFPGALoader -b titanium_ti60_f225_jtag -f soc.hex

# Flash firmware at SPI data offset
sudo /usr/bin/openFPGALoader -b titanium_ti60_f225_jtag \
  --external-flash -o 0x380000 full_uart.bin

# Read UART output
# Port: /dev/ttyUSB2, baud: 230400
```
