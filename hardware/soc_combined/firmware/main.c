/*
 * hardware/soc_combined/firmware/main.c
 *
 * Bare-metal RISC-V firmware for the combined Sapphire SoC + Church Machine
 * bitstream on the Ti60F225 devkit.
 *
 * On boot:
 *   1. Writes the compile-time board UID to the APB3 UID registers.
 *   2. Sends greeting over UART.
 *   3. Waits for the CM to complete its boot sequence (polls STATUS register).
 *   4. Triggers CM free-run by asserting push_button LOW for 1 second.
 *   5. Loops, printing the CM NIA every second via UART.
 *
 * UART:    Sapphire UART0 at 0xF0010000, 115200 baud, 25 MHz clock.
 * APB3:    Church Machine bridge at APB_SLAVE_0_BASE (0xF0040000).
 *
 * APB3 CM bridge register map:
 *   +0x00 CTRL   W/R  [0]=cm_pb (0=pressed, 1=released; default 1)
 *   +0x04 STATUS RO   [0]=boot_complete [1]=fault_valid [2]=fault_latched
 *   +0x08 NIA    RO   [31:0]=next instruction address
 *   +0x0C FAULT  RO   [4:0]=fault code
 *   +0x10 UID_LO R/W  [31:0]=lower 32 bits of 64-bit device UID
 *   +0x14 UID_HI R/W  [31:0]=upper 32 bits of 64-bit device UID
 *
 * Per-board UID configuration
 * ===========================
 * BOARD_UID_HI and BOARD_UID_LO are compile-time constants that form a
 * 64-bit device identity written into the APB3 bridge UID registers at
 * boot and echoed in every CALLHOME JSON packet.
 *
 * When programming multiple Ti60 boards for the same IDE server, recompile
 * the firmware with a distinct UID pair for each board so the IDE Dashboard
 * can track them as separate devices.  Any non-zero 64-bit value works;
 * a simple scheme is to increment BOARD_UID_LO by 1 per board while keeping
 * BOARD_UID_HI fixed (e.g. 0xC0FFEE00 as a site-specific prefix).
 *
 * Example for board #2:
 *   make CFLAGS="-DBOARD_UID_HI=0xC0FFEE00 -DBOARD_UID_LO=0x00000002"
 */

#include <stdint.h>

/* ── Per-board compile-time UID ────────────────────────────────────────────── */
#ifndef BOARD_UID_HI
#define BOARD_UID_HI  0xC0FFEE01UL   /* upper 32 bits — change per site/batch */
#endif
#ifndef BOARD_UID_LO
#define BOARD_UID_LO  0x00000001UL   /* lower 32 bits — change per board      */
#endif

/* ── Sapphire UART0 registers ─────────────────────────────────────────────── */
#define UART_BASE       0xF0010000UL
#define UART_DATA       (*(volatile uint32_t *)(UART_BASE + 0x00))
#define UART_STATUS     (*(volatile uint32_t *)(UART_BASE + 0x04))
#define UART_CLOCKDIV   (*(volatile uint32_t *)(UART_BASE + 0x08))
#define UART_TX_EMPTY   (1u << 0)   /* bit 0 of STATUS: TX FIFO has space */
/* UART_CLOCKDIV = clk_hz / baud - 1; for 115200 @ 25 MHz = 216 (0xD8) */
#define UART_CLOCKDIV_115200  216u

/* ── Church Machine APB3 bridge registers ─────────────────────────────────── */
#define CM_APB_BASE     0xF0040000UL
#define CM_CTRL         (*(volatile uint32_t *)(CM_APB_BASE + 0x00))
#define CM_STATUS       (*(volatile uint32_t *)(CM_APB_BASE + 0x04))
#define CM_NIA          (*(volatile uint32_t *)(CM_APB_BASE + 0x08))
#define CM_FAULT        (*(volatile uint32_t *)(CM_APB_BASE + 0x0C))
#define CM_UID_LO       (*(volatile uint32_t *)(CM_APB_BASE + 0x10))
#define CM_UID_HI       (*(volatile uint32_t *)(CM_APB_BASE + 0x14))

#define CM_STATUS_BOOT_COMPLETE  (1u << 0)
#define CM_STATUS_FAULT_VALID    (1u << 1)
#define CM_STATUS_FAULT_LATCHED  (1u << 2)

#define CM_CTRL_RELEASED  1u   /* push_button idle (active-low, so 1=released) */
#define CM_CTRL_PRESSED   0u   /* push_button asserted */

/* ── Timing ──────────────────────────────────────────────────────────────────
 * Clock: 25 MHz.  One NOP loop iteration ≈ 4 cycles (addi + bne overhead).
 * LOOPS_PER_SECOND is a conservative estimate; adjust if timing is critical.
 */
#define CLK_HZ          25000000UL
#define LOOPS_PER_SECOND (CLK_HZ / 4)

/* ── Helpers ─────────────────────────────────────────────────────────────── */

static void uart_putc(char c)
{
    while (!(UART_STATUS & UART_TX_EMPTY))
        ;
    UART_DATA = (uint32_t)(unsigned char)c;
}

static void uart_puts(const char *s)
{
    while (*s)
        uart_putc(*s++);
}

static void uart_puthex32(uint32_t v)
{
    static const char hex[] = "0123456789ABCDEF";
    uart_puts("0x");
    for (int i = 28; i >= 0; i -= 4)
        uart_putc(hex[(v >> i) & 0xF]);
}

/*
 * Emit a 16-char lowercase hex string for a 64-bit value (hi:lo).
 * No "0x" prefix — used inline inside JSON string values.
 */
static void uart_puthex64_raw(uint32_t hi, uint32_t lo)
{
    static const char hex[] = "0123456789abcdef";
    uint32_t words[2] = {hi, lo};
    for (int w = 0; w < 2; w++) {
        uint32_t v = words[w];
        for (int i = 28; i >= 0; i -= 4)
            uart_putc(hex[(v >> i) & 0xF]);
    }
}

static void delay_loops(uint32_t loops)
{
    volatile uint32_t i;
    for (i = 0; i < loops; i++)
        __asm__ volatile("nop");
}

/* ── Firmware version ─────────────────────────────────────────────────────── */
#define FW_MAJOR 1
#define FW_MINOR 0

/*
 * Emit a machine-parseable CALLHOME JSON line:
 *   CALLHOME:{"board":"Ti60F225","uid":"HHHHHHHHHHHHHHHH","nia":"0xNNNNNNNN","boot_ok":1,"fault":F,"fault_code":C,"fw_major":1,"fw_minor":0}\r\n
 *
 * Fields:
 *   board      — fixed "Ti60F225"
 *   uid        — 16 lowercase hex digits from the APB3 UID registers
 *   nia        — current CM next-instruction address as 0x hex string
 *   boot_ok    — 1 (always 1 in monitor loop; we only reach here after boot_complete)
 *   fault      — 1 if fault_latched sticky bit is set, 0 otherwise
 *   fault_code — fault code (0..31); valid when fault==1
 *   fw_major   — firmware major version (FW_MAJOR)
 *   fw_minor   — firmware minor version (FW_MINOR)
 */
static void uart_emit_callhome(uint32_t nia, uint32_t status,
                               uint32_t uid_hi, uint32_t uid_lo)
{
    uint32_t fault_latched = (status & CM_STATUS_FAULT_LATCHED) ? 1u : 0u;
    uint32_t fault_code    = fault_latched ? (CM_FAULT & 0x1Fu) : 0u;

    uart_puts("CALLHOME:{\"board\":\"Ti60F225\",\"uid\":\"");
    uart_puthex64_raw(uid_hi, uid_lo);
    uart_puts("\",\"nia\":\"");
    uart_puthex32(nia);
    uart_puts("\",\"boot_ok\":1,\"fault\":");
    uart_putc(fault_latched ? '1' : '0');
    uart_puts(",\"fault_code\":");
    /* emit fault_code as decimal (0-31, at most 2 digits) */
    if (fault_code >= 10u) {
        uart_putc('0' + (char)(fault_code / 10u));
    }
    uart_putc('0' + (char)(fault_code % 10u));
    uart_puts(",\"fw_major\":");
    uart_putc('0' + FW_MAJOR);
    uart_puts(",\"fw_minor\":");
    uart_putc('0' + FW_MINOR);
    uart_puts("}\r\n");
}

/* ── Entry point ──────────────────────────────────────────────────────────── */

void main(void)
{
    /*
     * Step 1 — Set UART baud rate.
     * sapphire.v resets the clockDivider to 0x35 (≈ 463 kbaud).
     * Override it to 216 (= 25 MHz / 115200 - 1) before any UART use.
     */
    UART_CLOCKDIV = UART_CLOCKDIV_115200;

    /*
     * Step 2 — Greeting (uses compile-time UID constants so APB3 is not
     * touched yet; this line appears even if the APB3 address is wrong).
     */
    uart_puts("CHURCH Ti60 SoC+CM v1.1\r\n");
    uart_puts("UID=");
    uart_puthex64_raw(BOARD_UID_HI, BOARD_UID_LO);
    uart_puts("\r\n");

    /*
     * Step 3 — Write compile-time board UID into the APB3 bridge.
     * Done after the greeting so the greeting is visible even if the
     * APB3 peripheral address causes a RISC-V bus exception.
     */
    CM_UID_LO = BOARD_UID_LO;
    CM_UID_HI = BOARD_UID_HI;

    /* Read back for subsequent CALLHOME packets */
    uint32_t uid_lo = CM_UID_LO;
    uint32_t uid_hi = CM_UID_HI;

    /* Ensure CM push_button starts released */
    CM_CTRL = CM_CTRL_RELEASED;

    /* Wait for CM boot_complete */
    uart_puts("Waiting for CM boot...\r\n");
    while (!(CM_STATUS & CM_STATUS_BOOT_COMPLETE))
        ;
    uart_puts("CM boot_complete: 1\r\n");

    /* Check for immediate fault */
    if (CM_STATUS & CM_STATUS_FAULT_LATCHED) {
        uart_puts("CM fault at boot! code=");
        uart_puthex32(CM_FAULT & 0x1F);
        uart_puts("\r\n");
    }

    /*
     * Trigger CM free-run by asserting push_button LOW for ≥ 1 s.
     * ChurchTi60F225 btn_hold_done fires when the button is held for
     * clk_freq cycles (25 000 000 @ 25 MHz).  We hold for 26 000 000
     * loop iterations (≈ 1.04 s with NOP padding) to ensure it triggers.
     */
    uart_puts("Asserting CM free-run kick...\r\n");
    CM_CTRL = CM_CTRL_PRESSED;
    delay_loops((uint32_t)(CLK_HZ + CLK_HZ / 25)); /* ~1.04 s */
    CM_CTRL = CM_CTRL_RELEASED;
    uart_puts("CM free-run kick released.\r\n");

    /* Monitor loop: print CM NIA every second */
    uart_puts("Monitoring CM NIA (Ctrl+C to stop host terminal):\r\n");
    for (;;) {
        uint32_t nia    = CM_NIA;
        uint32_t status = CM_STATUS;

        /* Human-readable NIA line (ttyUSB2 terminal) */
        uart_puts("NIA=");
        uart_puthex32(nia);

        if (status & CM_STATUS_FAULT_LATCHED) {
            uart_puts(" FAULT=");
            uart_puthex32(CM_FAULT & 0x1F);
        }
        uart_puts("\r\n");

        /* Machine-parseable call-home line for local_bridge.py */
        uart_emit_callhome(nia, status, uid_hi, uid_lo);

        delay_loops(LOOPS_PER_SECOND);
    }
}
