/*
 * hardware/soc_combined/firmware/main_diag.c
 *
 * DIAGNOSTIC FIRMWARE — swap in as main.c to isolate the 'C'-only hang.
 *
 * Three phases:
 *   Phase 1: Write 6 bytes with NO delay at all.
 *            If only 'A' comes through, the issue is NOT the delay —
 *            something about the second UART write itself hangs.
 *            If all of "ABCDEF" arrive, the delay is the culprit.
 *
 *   Phase 2: 5 bytes with a volatile uint32_t word-store delay.
 *            One byte every ~2 seconds so each char is clearly distinct.
 *            If this phase hangs, word-stores to RAM are broken.
 *
 *   Phase 3: 5 bytes with the asm register-only delay (same as main.c v2.4).
 *            If Phase 2 works but Phase 3 hangs, the asm delay is broken.
 *
 *   Heartbeat: '.' every ~2 seconds forever once all phases complete.
 *
 * USAGE (on the droplet):
 *   cd ~/church-machine/hardware/soc_combined/firmware
 *   cp main.c main.c.bak
 *   cp main_diag.c main.c
 *   make clean && make
 *   # run the OBBS or just patch sapphire.v manually
 *   cp main.c.bak main.c    # restore when done
 */

#include <stdint.h>

#define UART_BASE      0xF8010000UL
#define UART_DATA      (*(volatile uint32_t *)(UART_BASE + 0x00))
#define UART_CLOCKDIV  (*(volatile uint32_t *)(UART_BASE + 0x08))

#define CM_APB_BASE    0xF8100000UL
#define CM_CTRL        (*(volatile uint32_t *)(CM_APB_BASE + 0x00))
#define CM_UID_LO      (*(volatile uint32_t *)(CM_APB_BASE + 0x10))
#define CM_UID_HI      (*(volatile uint32_t *)(CM_APB_BASE + 0x14))

/* 25 MHz, asm loop ~3 cycles/iter.  500000 × 3 / 25000000 = 60 ms */
#define DELAY_ITERS  500000u

/* ------------------------------------------------------------------ */
/* Raw putc — NO delay, no frills.  Just writes to FIFO.              */
/* ------------------------------------------------------------------ */
static inline void raw_putc(char c)
{
    UART_DATA = (uint32_t)(unsigned char)c;
}

/* ------------------------------------------------------------------ */
/* Delay via volatile uint32_t (word-store to stack, should be safe). */
/* ------------------------------------------------------------------ */
static void volatile_delay(uint32_t iters)
{
    volatile uint32_t i;
    for (i = 0u; i < iters; i++) { /* spin */ }
}

/* ------------------------------------------------------------------ */
/* Delay via asm register-only (same as main.c uart_putc).            */
/* ------------------------------------------------------------------ */
static void asm_delay(uint32_t iters)
{
    __asm__ volatile("1: addi %0,%0,-1\n bne %0,zero,1b\n" : "+r"(iters));
}

/* ------------------------------------------------------------------ */
/* Send one char then one of the two delay variants.                  */
/* ------------------------------------------------------------------ */
static void volatile_putc(char c, uint32_t iters)
{
    UART_DATA = (uint32_t)(unsigned char)c;
    volatile_delay(iters);
}

static void asm_putc(char c, uint32_t iters)
{
    UART_DATA = (uint32_t)(unsigned char)c;
    asm_delay(iters);
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */
int main(void)
{
    /* Step 1: baud rate */
    UART_CLOCKDIV = 53u;   /* 25 MHz / (8×54) = 57,600 baud */

    /* Step 2: APB3 bridge housekeeping */
    CM_UID_LO = 0xDEAD0001UL;
    CM_UID_HI = 0xDEAD0002UL;
    CM_CTRL   = 1u;   /* released */

    /* -------------------------------------------------------------- */
    /* Phase 1: rapid-fire burst — NO delay between bytes.            */
    /* Expect terminal to show "123456" almost instantly.             */
    /* If only '1' arrives: something breaks on the 2nd UART write.  */
    /* If all 6 arrive: issue is specific to the delay loop.         */
    /* -------------------------------------------------------------- */
    raw_putc('1');
    raw_putc('2');
    raw_putc('3');
    raw_putc('4');
    raw_putc('5');
    raw_putc('6');
    raw_putc('\r');
    raw_putc('\n');

    /* 3-second gap so the phases are clearly separate on the terminal */
    volatile_delay(15u * DELAY_ITERS);   /* 15 × 60 ms = ~900 ms */

    /* -------------------------------------------------------------- */
    /* Phase 2: volatile uint32_t delay (word-stores to stack).       */
    /* One char every ~60 ms.  Expect "ABCDE" with visible spacing.  */
    /* If the board hangs after 'A': volatile word-stores break here. */
    /* -------------------------------------------------------------- */
    volatile_putc('A', DELAY_ITERS);
    volatile_putc('B', DELAY_ITERS);
    volatile_putc('C', DELAY_ITERS);
    volatile_putc('D', DELAY_ITERS);
    volatile_putc('E', DELAY_ITERS);
    raw_putc('\r');
    raw_putc('\n');

    volatile_delay(15u * DELAY_ITERS);

    /* -------------------------------------------------------------- */
    /* Phase 3: asm register-only delay (same loop as main.c v2.4).  */
    /* One char every ~60 ms.  Expect "abcde" with visible spacing.  */
    /* If 'A'-'E' worked but 'a' hangs: the asm delay is the bug.   */
    /* -------------------------------------------------------------- */
    asm_putc('a', DELAY_ITERS);
    asm_putc('b', DELAY_ITERS);
    asm_putc('c', DELAY_ITERS);
    asm_putc('d', DELAY_ITERS);
    asm_putc('e', DELAY_ITERS);
    raw_putc('\r');
    raw_putc('\n');

    volatile_delay(15u * DELAY_ITERS);

    /* -------------------------------------------------------------- */
    /* Heartbeat: '.' every ~1 s — shows firmware is alive.          */
    /* If we reach here, all three delay variants work correctly.     */
    /* -------------------------------------------------------------- */
    raw_putc('O');
    raw_putc('K');
    raw_putc('\r');
    raw_putc('\n');

    for (;;) {
        raw_putc('.');
        volatile_delay(15u * DELAY_ITERS);
    }

    return 0;
}
