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
/* SHA-256 / sha32 / HKDF — token identity primitive                  */
/* ------------------------------------------------------------------  */
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

#define FW_MAJOR  1u
#define FW_MINOR  1u
#define BOARD_TYPE_TI60  0x03u

/* ------------------------------------------------------------------ */
/* UART0                                                               */
/* ------------------------------------------------------------------ */
#define UART_BASE      0xF8010000UL
#define UART_DATA      (*(volatile unsigned int *)(UART_BASE + 0x00))
#define UART_STATUS    (*(volatile unsigned int *)(UART_BASE + 0x04))
#define UART_CLOCKDIV  (*(volatile unsigned int *)(UART_BASE + 0x08))

#define UART_DIV_115200  26u

/* GPIO is not wired in soc_minimal — no button support */

/* ------------------------------------------------------------------ */
/* Timing                                                              */
/* 25 MHz; volatile-loop + nop ≈ 23 cycles → 1,000,000 iters ≈ 0.92s */
/* ------------------------------------------------------------------ */
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

static void delay_loops(unsigned int loops)
{
    volatile unsigned int i;
    for (i = 0; i < loops; i++) __asm__ volatile("nop");
}

/* ------------------------------------------------------------------ */
/* NS manifest — 9 Core abstractions always present on every board.   */
/*                                                                     */
/* token_32 = sha32(ogt) — computed at runtime via hardware/sha256.h. */
/* Parsed by callhome_bridge.py _handle_callhome_json() (fw v1.2+).  */
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
/* CALLHOME emitter                                                    */
/*                                                                     */
/* Emits one ASCII JSON line parsed by callhome_bridge.py.            */
/* NIA is fixed at 0 — no Church Machine core in this soc_minimal     */
/* build; this provides IDE registration and heartbeat only.          */
/*                                                                     */
/* ns_manifest: sha32() runs 9 SHA-256 computations at runtime,       */
/* taking ~10 ms total at 25 MHz rv32im.  One-shot on cold boot;      */
/* repeated each heartbeat (~1 s interval) for bridge re-sync.        */
/* ------------------------------------------------------------------ */
static void uart_emit_callhome(unsigned int boot_reason)
{
    unsigned int i;

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
/* Main                                                                */
/* ------------------------------------------------------------------ */
int main(void)
{
    unsigned int i;
    unsigned int boot_reason = 0u;   /* 0 = cold boot */

    /* Baud rate — MUST write before any uart_puts */
    UART_CLOCKDIV = UART_DIV_115200;

    /* Boot banner */
    uart_puts("CHURCH Ti60\r\n");
    uart_puts("UID=");
    uart_puthex32_lower(BOARD_UID_HI);
    uart_puthex32_lower(BOARD_UID_LO);
    uart_puts("\r\n");

    /* Initial call-home — emits ns_manifest with all 9 Core OGTs */
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

    for (;;) {
        /* Periodic NIA heartbeat + call-home every ~1 second */
        delay_loops(LOOPS_PER_SECOND);
        uart_puts("NIA=0x00000000\r\n");
        uart_emit_callhome(boot_reason);
    }

    return 0;
}
