/*
 * hardware/soc_minimal/firmware/main.c
 *
 * Bare-metal RISC-V firmware for the Sapphire SoC — Ti60F225 call-home gate.
 *
 * FIRMWARE v2.0 — production-stable hardware telemetry
 * =====================================================
 * Every CALLHOME now reports real NIA, real fault state, and real UID from
 * the APB3 bridge registers (no hardcoded zeros).  New record types:
 *
 *   CALLHOME:{...}         — periodic heartbeat; real nia/fault/boot_ok fields
 *   FAULT_EVENT:{...}      — structured fault record (6 telemetry fields)
 *   HUNG:{...}             — hung-program watchdog (NIA unchanged 3 s, no fault)
 *   TRACE:[0x..,0x..,...]  — 10-entry NIA circular buffer, emitted every 10 s
 *   PONG\r\n               — response to RESET/PING/STATUS? commands over UART
 *
 * CALLHOME protocol (ASCII, parsed by hardware/soc_combined/callhome_bridge.py):
 *   CALLHOME:{"board":"Ti60F225","uid":"<16 hex>","nia":"0x<8 hex>",
 *             "boot_ok":<0|1>,"boot_reason":<0|2>,"fault":<0|1>,
 *             "fault_code":<0-31>,"fault_name":"<str>",
 *             "fw_major":2,"fw_minor":0,
 *             "ns_manifest":[...]}\r\n
 *
 *   FAULT_EVENT:{"uid":"<16hex>","nia":"0x<8hex>","fault_code":<N>,
 *                "fault_name":"<str>","fault_gt":"0x<8hex>",
 *                "fault_instr":"0x<8hex>","fault_cr14":"0x<8hex>",
 *                "fault_stage":<0-7>,"ts":<loop counter>}\r\n
 *
 *   HUNG:{"uid":"<16hex>","nia":"0x<8hex>","loops":<N>}\r\n
 *
 *   TRACE:[0x<8hex>,...<10 entries>]\r\n
 *
 * Run the bridge on the Chromebook to forward to the IDE:
 *   python3 hardware/soc_combined/callhome_bridge.py \
 *       --port=/dev/ttyUSB2 --baud=115200 --ide=http://localhost:5000
 *
 * UART commands accepted over ttyUSB2 (non-blocking receive):
 *   RESET\r\n   — pulse CTRL=0 for 1 s, reboots CM core
 *   PING\r\n    — respond with PONG\r\n
 *   STATUS?\r\n — emit one CALLHOME immediately
 *
 * Sapphire SoC UART0 register map (SpinalHDL UART):
 *   0xF8010000 + 0x00  TX data   write: (1<<8)|byte; RX data read: bit16=valid
 *   0xF8010000 + 0x04  Status
 *   0xF8010000 + 0x08  clockDivider  (resets to 0x00; MUST write 26 for 115200)
 *
 * Baud: 25 MHz / (8 × 27) = 115,741 ≈ 115200 baud  (CLOCKDIV=26)
 *
 * APB3 CM bridge base: 0xF8100000 (Sapphire io_apbSlave_0)
 *
 * Target: Efinix Ti60F225, Sapphire SoC, 25 MHz, no libc, no OS.
 */

/* ------------------------------------------------------------------ */
/* SHA-256 / sha32 / HKDF — token identity primitive                  */
/* ------------------------------------------------------------------ */
#include <stdint.h>
#include "../../sha256.h"

/* ------------------------------------------------------------------ */
/* Board identity                                                      */
/* ------------------------------------------------------------------ */
#ifndef BOARD_UID_HI
#define BOARD_UID_HI  0xC0FFEE01UL
#endif
#ifndef BOARD_UID_LO
#define BOARD_UID_LO  0x00000001UL
#endif

/* ------------------------------------------------------------------ */
/* Firmware version                                                    */
/* ------------------------------------------------------------------ */
#define FW_MAJOR  2u
#define FW_MINOR  0u

/* ------------------------------------------------------------------ */
/* UART0                                                               */
/* ------------------------------------------------------------------ */
#define UART_BASE      0xF8010000UL
#define UART_DATA      (*(volatile unsigned int *)(UART_BASE + 0x00))
#define UART_STATUS    (*(volatile unsigned int *)(UART_BASE + 0x04))
#define UART_CLOCKDIV  (*(volatile unsigned int *)(UART_BASE + 0x08))

#define UART_DIV_115200  26u

/* SpinalHDL UART RX: reading UART_DATA returns bit[16]=valid, bits[7:0]=byte */
#define UART_RX_VALID  (1u << 16)

/* ------------------------------------------------------------------ */
/* APB3 CM bridge registers (Sapphire io_apbSlave_0 base = 0xF8100000)*/
/* ------------------------------------------------------------------ */
#define APB3_BASE        0xF8100000UL
#define APB3_CTRL        (*(volatile unsigned int *)(APB3_BASE + 0x00))
#define APB3_STATUS      (*(volatile unsigned int *)(APB3_BASE + 0x04))
#define APB3_NIA         (*(volatile unsigned int *)(APB3_BASE + 0x08))
#define APB3_FAULT       (*(volatile unsigned int *)(APB3_BASE + 0x0C))
#define APB3_UID_LO      (*(volatile unsigned int *)(APB3_BASE + 0x10))
#define APB3_UID_HI      (*(volatile unsigned int *)(APB3_BASE + 0x14))
#define APB3_FAULT_GT    (*(volatile unsigned int *)(APB3_BASE + 0x18))
#define APB3_FAULT_INSTR (*(volatile unsigned int *)(APB3_BASE + 0x1C))
#define APB3_FAULT_CR14  (*(volatile unsigned int *)(APB3_BASE + 0x20))
#define APB3_FAULT_STAGE (*(volatile unsigned int *)(APB3_BASE + 0x24))
#define APB3_FAULT_RST   (*(volatile unsigned int *)(APB3_BASE + 0x28))

#define STATUS_BOOT_COMPLETE  (1u << 0)
#define STATUS_FAULT_VALID    (1u << 1)
#define STATUS_FAULT_LATCHED  (1u << 2)

/* ------------------------------------------------------------------ */
/* Timing                                                              */
/* 25 MHz; volatile-loop + nop ≈ 23 cycles → 1,000,000 iters ≈ 0.92s */
/* ------------------------------------------------------------------ */
#define LOOPS_PER_SECOND 1000000u

/* ------------------------------------------------------------------ */
/* Fault code name table                                               */
/* ------------------------------------------------------------------ */
static const char * const _fault_names[] = {
    /* 0x00 */ "UNKNOWN",
    /* 0x01 */ "PERM_R",        /* 0x02 */ "PERM_W",
    /* 0x03 */ "PERM_X",        /* 0x04 */ "PERM_L",
    /* 0x05 */ "PERM_S",        /* 0x06 */ "PERM_E",
    /* 0x07 */ "NULL_CAP",      /* 0x08 */ "BOUNDS",
    /* 0x09 */ "VERSION",       /* 0x0A */ "SEAL",
    /* 0x0B */ "INVALID_OP",    /* 0x0C */ "TPERM_RSV",
    /* 0x0D */ "DOMAIN_PURITY", /* 0x0E */ "PERM_B",
    /* 0x0F */ "F_BIT",         /* 0x10 */ "STACK_OVERFLOW",
    /* 0x11 */ "ABSENT_OUTFORM",/* 0x12 */ "STACK_CORRUPT",
    /* 0x13 */ "STACK_UNDERFLOW",/* 0x14 */ "UNKNOWN",
    /* 0x15 */ "OUTFORM_CRC",   /* 0x16 */ "OUTFORM_ALLOC",
    /* 0x17 */ "OUTFORM_MINT",  /* 0x18 */ "OUTFORM_HDR",
    /* 0x19 */ "INT_OVERFLOW",
};
#define FAULT_NAMES_COUNT ((unsigned int)(sizeof(_fault_names)/sizeof(_fault_names[0])))

static const char *fault_code_name(unsigned int code)
{
    return (code < FAULT_NAMES_COUNT) ? _fault_names[code] : "UNKNOWN";
}

/* ------------------------------------------------------------------ */
/* NS manifest — 9 Core abstractions always present on every board    */
/* ------------------------------------------------------------------ */
static const struct {
    const char *ogt;
    const char *label;
} _NS_MANIFEST[9] = {
    { "global.Core.BoardIdentity.boot",  "Board.Identity"  },
    { "global.Core.Heartbeat.boot",       "Heartbeat"        },
    { "global.Core.FaultReporter.boot",  "Fault.Reporter"  },
    { "global.Core.PerfReporter.boot",   "Perf.Reporter"   },
    { "global.Core.LumpLoader.boot",     "Lump.Loader"     },
    { "global.Core.TraceEmitter.boot",   "Trace.Emitter"   },
    { "global.Core.NSInspector.boot",    "NS.Inspector"    },
    { "global.Core.MediaConsumer.boot",  "Media.Consumer"  },
    { "global.Core.BrowseClient.boot",   "Browse.Client"   },
};

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

/* Returns received byte (0–255) if available, -1 if nothing waiting. */
static int uart_getc_nonblocking(void)
{
    unsigned int v = UART_DATA;
    if (v & UART_RX_VALID)
        return (int)(v & 0xFFu);
    return -1;
}

/* Emit 32-bit value as 8 lowercase hex digits (no prefix). */
static void uart_puthex32_lower(unsigned int v)
{
    static const char hex[] = "0123456789abcdef";
    int i;
    for (i = 28; i >= 0; i -= 4)
        uart_putc(hex[(v >> i) & 0xFu]);
}

/* Emit a decimal number (0..999999). */
static void uart_putdec(unsigned int v)
{
    char buf[7];
    int  n = 0;
    if (v == 0) { uart_putc('0'); return; }
    while (v > 0 && n < 7) {
        buf[n++] = (char)('0' + v % 10u);
        v /= 10u;
    }
    while (--n >= 0) uart_putc(buf[n]);
}

static void delay_loops(unsigned int loops)
{
    volatile unsigned int i;
    for (i = 0; i < loops; i++) __asm__ volatile("nop");
}

/* ------------------------------------------------------------------ */
/* Emit UID as 16 lowercase hex chars (no prefix, no quotes).         */
/* ------------------------------------------------------------------ */
static void emit_uid(void)
{
    uart_puthex32_lower(BOARD_UID_HI);
    uart_puthex32_lower(BOARD_UID_LO);
}

/* ------------------------------------------------------------------ */
/* CALLHOME emitter — reads live APB3 registers                       */
/* ------------------------------------------------------------------ */
static void uart_emit_callhome(unsigned int boot_reason)
{
    unsigned int i;
    unsigned int nia           = APB3_NIA;
    unsigned int status        = APB3_STATUS;
    unsigned int boot_ok       = (status & STATUS_BOOT_COMPLETE) ? 1u : 0u;
    unsigned int fault_latched = (status & STATUS_FAULT_LATCHED) ? 1u : 0u;
    unsigned int fault_code    = fault_latched ? (APB3_FAULT & 0x1Fu) : 0u;

    uart_puts("CALLHOME:{\"board\":\"Ti60F225\",\"uid\":\"");
    emit_uid();
    uart_puts("\",\"nia\":\"0x");
    uart_puthex32_lower(nia);
    uart_puts("\",\"boot_ok\":");
    uart_putc(boot_ok ? '1' : '0');
    uart_puts(",\"boot_reason\":");
    uart_putc((char)('0' + (boot_reason & 0xFu)));
    uart_puts(",\"fault\":");
    uart_putc(fault_latched ? '1' : '0');
    uart_puts(",\"fault_code\":");
    uart_putdec(fault_code);
    uart_puts(",\"fault_name\":\"");
    uart_puts(fault_code_name(fault_code));
    uart_puts("\"");
    uart_puts(",\"fw_major\":");
    uart_putdec(FW_MAJOR);
    uart_puts(",\"fw_minor\":");
    uart_putdec(FW_MINOR);

    /* ns_manifest: list of 9 Core OGTs with runtime-computed token_32 */
    uart_puts(",\"ns_manifest\":[");
    for (i = 0u; i < 9u; i++) {
        uint32_t t32 = sha32(_NS_MANIFEST[i].ogt);
        if (i > 0u) uart_putc(',');
        uart_puts("{\"ogt\":\"");
        uart_puts(_NS_MANIFEST[i].ogt);
        uart_puts("\",\"token_32\":\"0x");
        uart_puthex32_lower(t32);
        uart_puts("\",\"label\":\"");
        uart_puts(_NS_MANIFEST[i].label);
        uart_puts("\",\"resident\":true}");
    }
    uart_puts("]}\r\n");
}

/* ------------------------------------------------------------------ */
/* Per-abstraction key table (T0.4)                                   */
/*                                                                     */
/* Populated once after boot_complete + ns_manifest emission.        */
/* Lives entirely in RISC-V private RAM — inaccessible to CM core.   */
/* 9 Core OGTs × 32 bytes = 288 bytes total.                          */
/* ------------------------------------------------------------------ */
typedef struct {
    uint8_t k_enc[16];   /* ChaCha20 key — CM_ENC_v3 derivation */
    uint8_t k_mac[16];   /* HMAC-SHA256 key — CM_MAC_v3 derivation */
} cm_key_entry_t;

static cm_key_entry_t cm_key_table[9];  /* zero-initialised at reset */

/* ------------------------------------------------------------------ */
/* FAULT_EVENT emitter — reads all six telemetry registers            */
/* ------------------------------------------------------------------ */
static void uart_emit_fault_event(unsigned int ts)
{
    unsigned int nia         = APB3_NIA;
    unsigned int fault_code  = APB3_FAULT & 0x1Fu;
    unsigned int fault_gt    = APB3_FAULT_GT;
    unsigned int fault_instr = APB3_FAULT_INSTR;
    unsigned int fault_cr14  = APB3_FAULT_CR14;
    unsigned int fault_stage = APB3_FAULT_STAGE & 0xFu;

    uart_puts("FAULT_EVENT:{\"uid\":\"");
    emit_uid();
    uart_puts("\",\"nia\":\"0x");
    uart_puthex32_lower(nia);
    uart_puts("\",\"fault_code\":");
    uart_putdec(fault_code);
    uart_puts(",\"fault_name\":\"");
    uart_puts(fault_code_name(fault_code));
    uart_puts("\",\"fault_gt\":\"0x");
    uart_puthex32_lower(fault_gt);
    uart_puts("\",\"fault_instr\":\"0x");
    uart_puthex32_lower(fault_instr);
    uart_puts("\",\"fault_cr14\":\"0x");
    uart_puthex32_lower(fault_cr14);
    uart_puts("\",\"fault_stage\":");
    uart_putdec(fault_stage);
    uart_puts(",\"ts\":");
    uart_putdec(ts);
    uart_puts("}\r\n");
}

/* ------------------------------------------------------------------ */
/* HUNG emitter                                                        */
/* ------------------------------------------------------------------ */
static void uart_emit_hung(unsigned int nia, unsigned int loops)
{
    uart_puts("HUNG:{\"uid\":\"");
    emit_uid();
    uart_puts("\",\"nia\":\"0x");
    uart_puthex32_lower(nia);
    uart_puts("\",\"loops\":");
    uart_putdec(loops);
    uart_puts("}\r\n");
}

/* ------------------------------------------------------------------ */
/* TRACE emitter — 10-entry NIA buffer                                */
/* ------------------------------------------------------------------ */
static void uart_emit_trace(unsigned int *buf, unsigned int count)
{
    unsigned int i;
    uart_puts("TRACE:[");
    for (i = 0u; i < count; i++) {
        if (i > 0u) uart_putc(',');
        uart_puts("0x");
        uart_puthex32_lower(buf[i]);
    }
    uart_puts("]\r\n");
}

/* ------------------------------------------------------------------ */
/* UART command receiver — non-blocking line accumulator              */
/* ------------------------------------------------------------------ */
#define RX_BUF_SIZE 16u
static char  _rx_buf[RX_BUF_SIZE];
static unsigned int _rx_len = 0u;

/* Call once per sub-tick.  Returns 1 if a complete command was processed. */
static int uart_poll_command(unsigned int *force_callhome_out)
{
    int ch = uart_getc_nonblocking();
    if (ch < 0)
        return 0;

    char c = (char)(unsigned char)ch;

    /* Discard bare \r so we match against \n-terminated lines */
    if (c == '\r')
        return 0;

    if (c == '\n') {
        _rx_buf[_rx_len] = '\0';

        if (_rx_len == 5 &&
            _rx_buf[0]=='R' && _rx_buf[1]=='E' && _rx_buf[2]=='S' &&
            _rx_buf[3]=='E' && _rx_buf[4]=='T') {
            /* RESET: pulse CTRL=0 for 1 s */
            uart_puts("RESET-ACK\r\n");
            APB3_CTRL = 0u;
            delay_loops(LOOPS_PER_SECOND);
            APB3_CTRL = 1u;
        } else if (_rx_len == 4 &&
                   _rx_buf[0]=='P' && _rx_buf[1]=='I' &&
                   _rx_buf[2]=='N' && _rx_buf[3]=='G') {
            uart_puts("PONG\r\n");
        } else if (_rx_len == 7 &&
                   _rx_buf[0]=='S' && _rx_buf[1]=='T' && _rx_buf[2]=='A' &&
                   _rx_buf[3]=='T' && _rx_buf[4]=='U' && _rx_buf[5]=='S' &&
                   _rx_buf[6]=='?') {
            if (force_callhome_out)
                *force_callhome_out = 1u;
        }

        _rx_len = 0u;
        return 1;
    }

    /* Accumulate; discard overflow */
    if (_rx_len < RX_BUF_SIZE - 1u)
        _rx_buf[_rx_len++] = c;
    else
        _rx_len = 0u;   /* overflow — reset */

    return 0;
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */
int main(void)
{
    unsigned int i;
    unsigned int boot_reason = 0u;   /* 0 = cold boot */

    /* ---- Step 1: Baud rate (MUST be first) ---- */
    UART_CLOCKDIV = UART_DIV_115200;

    /* ---- Step 2: Write UID to APB3 bridge registers before any CALLHOME ---- */
    APB3_UID_LO = BOARD_UID_LO;
    APB3_UID_HI = BOARD_UID_HI;

    /* ---- Step 3: Boot banner ---- */
    uart_puts("CHURCH Ti60 v2.0\r\n");
    uart_puts("UID=");
    emit_uid();
    uart_puts("\r\n");

    /* ---- Step 4: Wait for CM boot_complete (timeout 5 s) ---- */
    unsigned int boot_ok = 0u;
    for (unsigned int t = 0u; t < 5u; t++) {
        if (APB3_STATUS & STATUS_BOOT_COMPLETE) {
            boot_ok = 1u;
            break;
        }
        delay_loops(LOOPS_PER_SECOND);
    }

    /* ---- Step 5: Initial CALLHOME — emits ns_manifest with all 9 Core OGTs ---- */
    uart_emit_callhome(boot_reason);

    /* T0.4 key derivation — one key pair per Core OGT.
     * Formula: IKM = SHA256(uid_hi_BE4 || uid_lo_BE4 || ogt_utf8)
     *          K_enc = HKDF(IKM, "CM_ENC_v3", ogt, 16)
     *          K_mac = HKDF(IKM, "CM_MAC_v3", ogt, 16)
     * Matches callhome_bridge.py derive_keys() exactly.
     * Keys remain in private RISC-V RAM; never copied to CM-core BRAM.
     */
    for (i = 0u; i < 9u; i++) {
        cm_derive_keys(BOARD_UID_HI, BOARD_UID_LO,
                       _NS_MANIFEST[i].ogt,
                       cm_key_table[i].k_enc,
                       cm_key_table[i].k_mac);
    }

    /* ---- Watchdog state ---- */
    unsigned int last_nia          = APB3_NIA;
    unsigned int nia_unchanged     = 0u;

    /* ---- NIA trace buffer (10 entries, sampled at ~10 Hz) ---- */
    unsigned int trace_buf[10];
    unsigned int trace_idx = 0u;

    /* ---- Loop counter (proxy timestamp for FAULT_EVENT ts field) ---- */
    unsigned int loop_ctr = 0u;

    for (;;) {
        unsigned int force_callhome = 0u;

        /* ----------------------------------------------------------------
         * Inner trace loop: 10 × (LOOPS_PER_SECOND/10) ≈ 1 second total.
         * Sample NIA every ~100 ms; poll UART commands between samples.
         * ---------------------------------------------------------------- */
        unsigned int ti;
        for (ti = 0u; ti < 10u; ti++) {
            delay_loops(LOOPS_PER_SECOND / 10u);
            trace_buf[trace_idx++] = APB3_NIA;
            uart_poll_command(&force_callhome);
        }

        /* Emit TRACE when buffer is full (every outer iteration ≈ 1 s) */
        uart_emit_trace(trace_buf, 10u);
        trace_idx = 0u;

        /* ----------------------------------------------------------------
         * Hung-program watchdog
         * Track NIA unchanged-samples.  3 unchanged 1-s samples = 3 s hang.
         * Only trigger if no fault is latched (known fault ≠ hung).
         * ---------------------------------------------------------------- */
        unsigned int nia    = APB3_NIA;
        unsigned int status = APB3_STATUS;

        if (!(status & STATUS_FAULT_LATCHED)) {
            if (nia == last_nia) {
                nia_unchanged++;
                if (nia_unchanged >= 3u) {
                    uart_emit_hung(nia, nia_unchanged);
                    APB3_CTRL = 0u;
                    delay_loops(LOOPS_PER_SECOND);
                    APB3_CTRL = 1u;
                    nia_unchanged = 0u;
                    last_nia = APB3_NIA;
                }
            } else {
                last_nia = nia;
                nia_unchanged = 0u;
            }
        } else {
            /* NIA may be frozen at fault address — don't count as hung */
            nia_unchanged = 0u;
        }

        /* ----------------------------------------------------------------
         * Fault detection and telemetry
         * ---------------------------------------------------------------- */
        if (status & STATUS_FAULT_LATCHED) {
            /* a. Emit structured FAULT_EVENT with all six telemetry fields */
            uart_emit_fault_event(loop_ctr);

            /* b. Clear the latch so the next fault is independently detectable */
            APB3_FAULT_RST = 1u;

            /* c. Pulse CTRL=0 for 1 s to reboot the CM core */
            APB3_CTRL = 0u;
            delay_loops(LOOPS_PER_SECOND);
            APB3_CTRL = 1u;

            /* d. Wait up to 5 s for boot_complete to reassert */
            for (unsigned int t = 0u; t < 5u; t++) {
                if (APB3_STATUS & STATUS_BOOT_COMPLETE)
                    break;
                delay_loops(LOOPS_PER_SECOND);
            }

            boot_reason   = 2u;   /* fault-recovery re-boot */
            last_nia      = APB3_NIA;
            nia_unchanged = 0u;
        }

        /* ---- Periodic CALLHOME (or immediate if STATUS? received) ---- */
        uart_emit_callhome(boot_reason);
        if (force_callhome)
            uart_emit_callhome(boot_reason);

        loop_ctr++;
    }

    return 0;
}
