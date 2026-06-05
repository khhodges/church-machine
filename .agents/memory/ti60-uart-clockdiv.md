---
name: Ti60 SoC UART clockDivider
description: Sapphire SoC UART baud config, clock architecture, and working firmware pattern for Ti60F225
---

## Clock Architecture (Ti60F225 Devkit) — CRITICAL

The Ti60F225 devkit has THREE oscillators (from devkit UG v2.6 Table 1):

| Oscillator | Pin | PLL |
|---|---|---|
| **25 MHz** | **GPIOL_P_18_PLLIN0** | **PLL_TL0** |
| 33.3333 MHz | GPIOL_P_00_PLLIN0 | PLL_BL0 |
| 74.25 MHz | GPIOT_P_17_PLLIN1 | PLL_TR0 |

**GPIOL_P_18 is a PLL INPUT pin — it CANNOT drive CLKMUX directly.**
Any attempt to route GPIOL_P_18 through CLKMUX_T, CLKMUX_L, or any CLKMUX
always produces PCR_*_EN=DISABLE. The Interface Designer silently ignores it
because it's not a clock-capable GPIO pin.

**The correct architecture:**
```
25 MHz → GPIOL_P_18_PLLIN0 → PLL_TL0 (×2) → 50 MHz → top.clk
→ Sapphire SoC internal PLL (×2) → 100 MHz CPU clock
```

**peri.xml must have `<efxpt:pll_info>` with PLL_TL0 configured** — not a GPIO
clock, not OSC_0. The `<efxpt:pll_info/>` (empty) peri.xml is the root cause of
all clock failures.

**Why:** GPIOL_P_18 is labeled `_PLLIN0` in the device architecture — it's wired
directly to PLL_TL0's reference input, not to the global clock multiplexer.

## UART CLOCKDIV rule

The Sapphire SoC UART `clockDivider` register resets to **0x00** on power-up.
Firmware **must** write `UART_CLOCKDIV = 53` before the first `uart_puts()` call.

```c
#define UART_CLOCKDIV  (*(volatile uint32_t *)(0xF8010000UL + 0x08))
```

Baud rate formula: `baudRate = ClkIn / (8 × (clockDivider + 1))`

CPU clock is 100 MHz (25 MHz → PLL_TL0 ×2 → 50 MHz → SoC internal PLL ×2 → 100 MHz):
```
clockDivider = (100_000_000 / (8 × 230_400)) − 1 = 53.25 → 53
actual baud  = 100_000_000 / (8 × 54) = 231_481  (0.47% error — fine)
```

**Without CLOCKDIV=53 write:** UART runs at 100 MHz / 8 = 12.5 Mbaud — silence.

## soc.hex SPI boot bootloader constraint: USER_SOFTWARE_SIZE = 252 bytes

The stock soc.hex bootloader copies exactly **252 bytes** from SPI data flash
(at offset 0x380000) into BRAM before jumping to 0xF9000000. Any firmware bytes
beyond offset 252 are **not copied** — old BRAM content remains.

**Symptom:** Firmware using string literals beyond byte 252 outputs garbled data.

## Working firmware pattern for soc.hex (no APB3)

Use immediate character writes with a register-only delay:

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

## BRAM layout (soc.hex design)

```
0xF9000000 — BRAM start (8 KB confirmed working)
0xF9002000 — BRAM end / stack top (_stack_top in link.ld)
0xF8010000 — UART_BASE (UART_DATA +0, UART_STATUS +4, UART_CLOCKDIV +8)
0xF8100000 — CM APB3 bridge (NOT in stock soc.hex — bus fault if accessed)
```

## How to flash (Penguin)

```bash
# Flash FPGA config
sudo /usr/bin/openFPGALoader -b titanium_ti60_f225_jtag -f outflow/church_soc_cm.hex

# UART check (port: /dev/ttyUSB2, baud: 230400)
stty -F /dev/ttyUSB2 230400 raw && timeout 10 cat /dev/ttyUSB2
```
