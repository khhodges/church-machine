/*
 * hardware/soc_minimal/firmware/main.c
 *
 * Bare-metal RISC-V firmware for the Sapphire SoC + call-home gate test.
 * On boot:  sends banner, then emits CALLHOME JSON + NIA every second.
 * On press: re-sends banner (debounced), allows repeat tests without reflash.
 *
 * Target: Efinix Ti60F225, Sapphire SoC, 25 MHz, 115200 baud
 * No libc, no OS.
 *
 * CALLHOME protocol (ASCII, parsed by hardware/soc_combined/callhome_bridge.py):
 *   CALLHOME:{"board":"Ti60F225","uid":"<16 hex>","nia":"0x00000000",
 *             "boot_ok":1,"boot_reason":0,"fault":0,"fault_code":0,
 *             "fault_name":"UNKNOWN","fw_major":1,"fw_minor":0}\r\n
 *
 * Run the bridge on the Chromebook to forward to the IDE:
 *   python3 hardware/soc_combined/callhome_bridge.py \
 *       --port=/dev/ttyUSB2 --baud=115200 --ide=http://localhost:5000
 *
 * Sapphire SoC UART0 register map (SpinalHDL UART):
 *   0xF8010000 + 0x00  TX/RX data    (bit 8 = write-valid flag, MUST be set)
 *   0xF8010000 + 0x04  Status
 *   0xF8010000 + 0x08  clockDivider  (resets to 0x00; MUST write 26 for 115200)
 *
 * Baud: 25 MHz / (8 × 27) = 115,741 ≈ 115200 baud  (CLOCKDIV=26)
 *
 * Sapphire SoC GPIO register map:
 *   0xF8020000 + 0x00  GPIO input (bit 6 = push button, active-low)
 */

/* ------------------------------------------------------------------ */
/* Board identity                                                      */
/* ------------------------------------------------------------------ */
#ifndef BOARD_UID_HI
#define BOARD_UID_HI  0xC0FFEE01UL
#endif
#ifndef BOARD_UID_LO
#define BOARD_UID_LO  0x00000001UL
#endif

#define FW_MAJOR  1u
#define FW_MINOR  0u
#define BOARD_TYPE_TI60  0x03u

/* ------------------------------------------------------------------ */
/* UART0                                                               */
/* ------------------------------------------------------------------ */
#define UART_BASE      0xF8010000UL
#define UART_DATA      (*(volatile unsigned int *)(UART_BASE + 0x00))
#define UART_STATUS    (*(volatile unsigned int *)(UART_BASE + 0x04))
#define UART_CLOCKDIV  (*(volatile unsigned int *)(UART_BASE + 0x08))

#define UART_DIV_115200  26u

/* ------------------------------------------------------------------ */
/* GPIO                                                                */
/* ------------------------------------------------------------------ */
#define GPIO_BASE      0xF8020000UL
#define GPIO_INPUT     (*(volatile unsigned int *)(GPIO_BASE + 0x00))

#define BUTTON_BIT     (1u << 6)
#define BUTTON_PRESSED (!(GPIO_INPUT & BUTTON_BIT))

/* ------------------------------------------------------------------ */
/* Timing                                                              */
/* 25 MHz; volatile-loop + nop ≈ 23 cycles → 1,000,000 iters ≈ 0.92s */
/* ------------------------------------------------------------------ */
#define DEBOUNCE_CYCLES  250000u
#define LOOPS_PER_SECOND 1000000u

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
static void uart_putc(char c)
{
    UART_DATA = (1u << 8) | (unsigned int)(unsigned char)c;
    for (volatile unsigned int i = 0; i < 3000u; i++)
        __asm__("nop");
}

static void uart_puts(const char *s)
{
    while (*s) uart_putc(*s++);
}

static void uart_puthex32_lower(unsigned int v)
{
    static const char hex[] = "0123456789abcdef";
    int i;
    for (i = 28; i >= 0; i -= 4)
        uart_putc(hex[(v >> i) & 0xFu]);
}

static void uart_putdec1(unsigned int v)
{
    /* emit up to 2 decimal digits (0–99) */
    if (v >= 10u) uart_putc((char)('0' + v / 10u));
    uart_putc((char)('0' + v % 10u));
}

static int debounce_pressed(void)
{
    unsigned int i;
    for (i = 0; i < DEBOUNCE_CYCLES; i++) {
        if (!BUTTON_PRESSED) return 0;
    }
    return 1;
}

static void wait_for_release(void)
{
    while (BUTTON_PRESSED) ;
}

static void delay_loops(unsigned int loops)
{
    volatile unsigned int i;
    for (i = 0; i < loops; i++) __asm__ volatile("nop");
}

/* ------------------------------------------------------------------ */
/* CALLHOME emitter                                                    */
/*                                                                     */
/* Emits one ASCII JSON line parsed by callhome_bridge.py.            */
/* NIA is fixed at 0 — no Church Machine core in this soc_minimal     */
/* build; this provides IDE registration and heartbeat only.          */
/* ------------------------------------------------------------------ */
static void uart_emit_callhome(unsigned int boot_reason)
{
    uart_puts("CALLHOME:{\"board\":\"Ti60F225\",\"uid\":\"");
    uart_puthex32_lower(BOARD_UID_HI);
    uart_puthex32_lower(BOARD_UID_LO);
    uart_puts("\",\"nia\":\"0x00000000\",\"boot_ok\":1,\"boot_reason\":");
    uart_putc((char)('0' + (boot_reason & 0xFu)));
    uart_puts(",\"fault\":0,\"fault_code\":0,\"fault_name\":\"UNKNOWN\"");
    uart_puts(",\"fw_major\":");
    uart_putdec1(FW_MAJOR);
    uart_puts(",\"fw_minor\":");
    uart_putdec1(FW_MINOR);
    uart_puts("}\r\n");
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */
int main(void)
{
    unsigned int boot_reason = 0u;   /* 0 = cold boot */
    unsigned int iter = 0u;

    /* Baud rate — MUST write before any uart_puts */
    UART_CLOCKDIV = UART_DIV_115200;

    /* Boot banner */
    uart_puts("CHURCH Ti60 v1.0\r\n");
    uart_puts("UID=");
    uart_puthex32_lower(BOARD_UID_HI);
    uart_puthex32_lower(BOARD_UID_LO);
    uart_puts("\r\n");

    /* Initial call-home */
    uart_emit_callhome(boot_reason);

    for (;;) {
        /* Periodic NIA heartbeat + call-home every ~1 second */
        delay_loops(LOOPS_PER_SECOND);
        iter++;

        uart_puts("NIA=0x00000000\r\n");
        uart_emit_callhome(boot_reason);

        /* Re-send banner every 20 seconds */
        if ((iter % 20u) == 0u)
            uart_puts("CHURCH Ti60 v1.0\r\n");

        /* Button: re-send banner on press */
        if (BUTTON_PRESSED && debounce_pressed()) {
            uart_puts("CHURCH Ti60 v1.0\r\n");
            uart_emit_callhome(1u);   /* boot_reason 1 = warm */
            boot_reason = 1u;
            wait_for_release();
        }
    }

    return 0;
}
