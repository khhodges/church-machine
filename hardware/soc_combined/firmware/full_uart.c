/*
 * hardware/soc_combined/firmware/full_uart.c
 *
 * Minimal soc.hex-compatible firmware: outputs "CHURCH Ti60 SoC+CM v1.1"
 * continuously at 230400 baud on /dev/ttyUSB2.
 *
 * WHY THIS EXISTS (not main.c)
 * =============================
 * The stock soc.hex bootloader copies exactly USER_SOFTWARE_SIZE = 252 bytes
 * from SPI flash (offset 0x380000) into BRAM before jumping to 0xF9000000.
 * Firmware bytes beyond offset 252 are NOT copied — old BRAM content
 * (soc.hex demo code) remains.  If a standard C binary places string literals
 * beyond byte 252 (which happens with crt0 + uart functions ≈ 350+ bytes of
 * code before .rodata), uart_puts() reads garbage RISC-V opcodes.
 *
 * SOLUTION: immediate character writes via P() macro + register-only delay D().
 * No memory reads for string data. Binary stays well under 252 bytes.
 *
 * BAUD RATE
 * =========
 * Ti60F225 crystal: 50 MHz.  Sapphire SoC PLL: doubles to 100 MHz.
 * UART_CLOCKDIV register resets to 0x00 on power-up (not 0x35 — the comment
 * in sapphire.v is wrong).  Without the explicit write, UART runs at 12.5 Mbaud
 * and produces complete silence.
 *   CLOCKDIV = 53 → 100 MHz / (8 × 54) = 231,481 ≈ 230,400 baud (0.47% error)
 *
 * APB3 NOTE
 * =========
 * CM_APB_BASE (0xF8100000) is NOT mapped in the stock soc.hex design.
 * Any access bus-faults the CPU immediately.  Do not touch it here.
 * See main.c for the full firmware that requires the combined CM+SoC bitstream.
 *
 * FLASH COMMANDS (on Penguin)
 * ===========================
 *   T=~/efinity/efinity-riscv-ide-2025.2/toolchain/bin
 *   $T/riscv-none-embed-gcc -march=rv32i -mabi=ilp32 -O2 \
 *     -nostartfiles -nodefaultlibs -Ttext=0xF9000000 \
 *     -o full_uart.elf full_uart.c
 *   $T/riscv-none-embed-objcopy -O binary full_uart.elf full_uart.bin
 *   sudo /usr/bin/openFPGALoader -b titanium_ti60_f225_jtag \
 *     --external-flash -o 0x380000 full_uart.bin
 *   # Read: /dev/ttyUSB2 at 230400 baud
 */

#include <stdint.h>

/* Register-only delay: keeps loop counter in CPU register, no stack write. */
static inline void D(uint32_t n) {
    __asm__ volatile("1: addi %0,%0,-1\n bne %0,zero,1b\n" : "+r"(n));
}

void main(void) {
    volatile uint32_t *u = (volatile uint32_t *)0xF8010000;
    u[2] = 53;   /* UART_CLOCKDIV: 100 MHz / (8×54) ≈ 230400 baud */

    /* Each P(c) writes char as an immediate — zero memory reads for string data */
#define P(c) u[0] = (1u<<8)|(unsigned char)(c); D(3000)

    for (;;) {
        P('C'); P('H'); P('U'); P('R'); P('C'); P('H'); P(' ');
        P('T'); P('i'); P('6'); P('0'); P(' ');
        P('S'); P('o'); P('C'); P('+'); P('C'); P('M'); P(' ');
        P('v'); P('1'); P('.'); P('1'); P('\r'); P('\n');
    }
}
