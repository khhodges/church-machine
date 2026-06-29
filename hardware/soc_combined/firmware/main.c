/*
 * hardware/soc_combined/firmware/main.c
 *
 * Bare-metal RISC-V firmware for the combined Sapphire SoC + Church Machine
 * bitstream on the Ti60F225 devkit.
 *
 * FIRMWARE v2.3 — LUMP relay: APB3 UART-TX relay delivers LUMPs via ttyUSB2 only
 * =====================================================
 * Every CALLHOME now reports real NIA, real fault state, and real UID from
 * the APB3 bridge registers (no hardcoded zeros).  New record types:
 *
 *   CALLHOME:{...}         — periodic heartbeat; real nia/fault/boot_ok fields
 *   FAULT_EVENT:{...}      — structured fault record (6 telemetry fields)
 *   HUNG:{...}             — hung-program watchdog (NIA unchanged 3 s, no fault)
 *   TRACE:[0x..,0x..,...]  — 10-entry NIA circular buffer, emitted every ~1 s
 *   PONG\r\n               — response to RESET/PING/STATUS? commands over UART
 *   LUMP_PUSH_START:{...}  — emitted when LUMP_START relay begins (len field)
 *   LUMP_DONE:{...}        — emitted after CM restarts; ok=1 success, ok=0 fail
 *
 * CALLHOME protocol (ASCII, parsed by hardware/soc_combined/callhome_bridge.py):
 *   CALLHOME:{"board":"Ti60F225","uid":"<16 hex>","nia":"0x<8 hex>",
 *             "boot_ok":<0|1>,"boot_reason":<0|2>,"fault":<0|1>,
 *             "fault_code":<0-31>,"fault_name":"<str>",
 *             "fw_major":2,"fw_minor":3,
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
 *       --port=/dev/ttyUSB2 --baud=57600 --ide=http://localhost:5000
 *
 * UART commands accepted over ttyUSB2 (non-blocking receive):
 *   RESET\r\n           — pulse CTRL=0 for 1 s, reboots CM core
 *   PING\r\n            — respond with PONG\r\n
 *   STATUS?\r\n         — emit one CALLHOME immediately
 *   LUMP_START:<n>\r\n  — relay n raw bytes (immediately following) into CM
 *                          uart_rx via APB3 relay; wait for CM reboot;
 *                          respond with LUMP_DONE:{"ok":1|0}\r\n
 *
 * HOW THE CHURCH MACHINE STARTS (from CM Verilog, church_ti60_f225.v)
 * ====================================================================
 * ① FPGA reset deasserts.  boot_start fires after 15 clock cycles (automatic,
 *    no firmware action required).  The CM runs its boot ROM from NIA = 0.
 *
 * ② dbg_boot_complete asserts (<1 ms).  This is a sticky flag that stays HIGH
 *    forever; it is now properly wired to the APB3 STATUS.boot_complete bit.
 *
 * ③ startup_ctr counts ~3 s (75,620,543 cycles @ 25 MHz).  During this time
 *    the CM is halted; LED1 blinks as a heartbeat.
 *
 * ④ CM debug FSM (state 0x00 → 0x01 → ... → 0x07): sends boot banner + call-home
 *    data over the CM UART (ttyUSB3, 115200 bd).
 *
 * ⑤ State 0x07: free_run_start = 1.  CM begins executing from NIA = 0.
 *
 * HOW CM FAULT RECOVERY WORKS (v2.1)
 * ====================================
 * APB3_FAULT_RST (0x28) is a write-1-to-clear register added in soc_combined
 * apb3_cm_bridge.v.  On fault:
 *   a. FAULT_EVENT record emitted with all 6 telemetry fields.
 *   b. FAULT_RST = 1 clears fault_latched and all capture registers.
 *   c. CTRL = 0 pulses the CM push_button for 1 s (reboot via btn_hold_done).
 *   d. Wait up to 5 s for boot_complete to reassert.
 *
 * UART:    Sapphire UART0 at 0xF8010000.
 *          CLOCKDIV=53 → 57,600 baud at 25 MHz (CONFIRMED WORKING on /dev/ttyUSB2).
 *          Formula: baudRate = clkFreq / (8 × (CLOCKDIV + 1))
 *          25 MHz / (8 × 54) = 57,870 ≈ 57,600 baud.
 *          Do NOT use 115,200 on this build.
 *
 * APB3:    Church Machine bridge at CM_APB_BASE (0xF8100000).
 *
 * APB3 CM bridge register map:
 *   +0x00 CTRL        W/R  [0]=cm_pb (0=pressed, 1=released; default 1)
 *   +0x04 STATUS      RO   [0]=boot_complete [1]=fault_valid [2]=fault_latched
 *   +0x08 NIA         RO   [31:0]=next instruction address
 *   +0x0C FAULT       RO   [4:0]=fault code
 *   +0x10 UID_LO      R/W  [31:0]=lower 32 bits of 64-bit device UID
 *   +0x14 UID_HI      R/W  [31:0]=upper 32 bits of 64-bit device UID
 *   +0x18 FAULT_GT    RO   GT word0 of faulting capability (latched on fault)
 *   +0x1C FAULT_INSTR RO   Instruction word at fault NIA
 *   +0x20 FAULT_CR14  RO   Active abstraction slot at fault
 *   +0x24 FAULT_STAGE RO   Pipeline stage: 0=Fetch 1=Decode 2=Perm 3=Lambda
 *                                          4=TPERM 5=Call 6=Return 7=DataRW
 *   +0x28 FAULT_RST   WO   Write 1 to clear fault_latched and all capture regs
 *   +0x2C RELAY_DATA  WO   Write byte to shift it out on relay_tx at 57,600 baud
 *                          (silently dropped while busy — check RELAY_READY first)
 *   +0x30 RELAY_READY RO   [0]=1 when idle/ready for next byte, 0 while transmitting
 *
 * Target: Efinix Ti60F225, Sapphire SoC, 25 MHz, no libc, no OS.
 */

/* ------------------------------------------------------------------ */
/* SHA-256 / sha32 / HKDF — token identity primitive                  */
/* ------------------------------------------------------------------ */
#include <stdint.h>
#include "../sha256.h"

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
#define FW_MINOR  4u

/* ------------------------------------------------------------------ */
/* Sapphire UART0 registers                                            */
/* ------------------------------------------------------------------ */
#define UART_BASE      0xF8010000UL
#define UART_DATA      (*(volatile uint32_t *)(UART_BASE + 0x00))
#define UART_STATUS    (*(volatile uint32_t *)(UART_BASE + 0x04))
#define UART_CLOCKDIV  (*(volatile uint32_t *)(UART_BASE + 0x08))

/* CLOCKDIV=53 → 57,600 baud at 25 MHz (confirmed working on /dev/ttyUSB2) */
#define UART_DIV_57600  53u

/* SpinalHDL UART RX: reading UART_DATA returns bit[16]=valid, bits[7:0]=byte */
#define UART_RX_VALID  (1u << 16)

/* ------------------------------------------------------------------ */
/* APB3 CM bridge registers (Sapphire io_apbSlave_0 base = 0xF8100000)*/
/* ------------------------------------------------------------------ */
#define CM_APB_BASE      0xF8100000UL
#define CM_CTRL          (*(volatile uint32_t *)(CM_APB_BASE + 0x00))
#define CM_STATUS        (*(volatile uint32_t *)(CM_APB_BASE + 0x04))
#define CM_NIA           (*(volatile uint32_t *)(CM_APB_BASE + 0x08))
#define CM_FAULT         (*(volatile uint32_t *)(CM_APB_BASE + 0x0C))
#define CM_UID_LO        (*(volatile uint32_t *)(CM_APB_BASE + 0x10))
#define CM_UID_HI        (*(volatile uint32_t *)(CM_APB_BASE + 0x14))
#define CM_FAULT_GT      (*(volatile uint32_t *)(CM_APB_BASE + 0x18))
#define CM_FAULT_INSTR   (*(volatile uint32_t *)(CM_APB_BASE + 0x1C))
#define CM_FAULT_CR14    (*(volatile uint32_t *)(CM_APB_BASE + 0x20))
#define CM_FAULT_STAGE   (*(volatile uint32_t *)(CM_APB_BASE + 0x24))
#define CM_FAULT_RST     (*(volatile uint32_t *)(CM_APB_BASE + 0x28))
#define CM_RELAY_DATA    (*(volatile uint32_t *)(CM_APB_BASE + 0x2C))
#define CM_RELAY_READY   (*(volatile uint32_t *)(CM_APB_BASE + 0x30))

/* NUC_CODE_START / NUC_CODE_END: exempt the NUC_PROGRAM inner delay loop
 * from the hung-program watchdog.  The inner delay keeps NIA at one hot
 * instruction for seconds at a time — that is correct behaviour, not a hang.
 *
 * NEW BRAM layout (church_ti60_f225.v, cw=17, no embedded c-list):
 *   NUC code word  0 → NIA=0x004
 *   NUC inner delay (word 11, outer-loop-top OFF phase) → NIA=0x030
 *   NUC last word (word 16, branch-back) → NIA=0x044
 *
 * Fire HUNG only when NIA is *outside* [NUC_CODE_START, NUC_CODE_END]. */
#define NUC_CODE_START   0x00000000u   /* floor: code starts at NIA=0x004      */
#define NUC_CODE_END     0x00000044u   /* ceiling: last instr at NIA=0x044     */

#define CM_STATUS_BOOT_COMPLETE  (1u << 0)
#define CM_STATUS_FAULT_VALID    (1u << 1)
#define CM_STATUS_FAULT_LATCHED  (1u << 2)

#define CM_CTRL_RELEASED  1u
#define CM_CTRL_PRESSED   0u

/* ------------------------------------------------------------------ */
/* Timing                                                              */
/* 25 MHz; volatile-loop + nop ≈ 23 cycles → 1,000,000 iters ≈ 0.92s */
/* ------------------------------------------------------------------ */
#define LOOPS_PER_SECOND  1000000u

/* ------------------------------------------------------------------ */
/* Fault code name table                                               */
/* ------------------------------------------------------------------ */
static const char * const _fault_names[] = {
    /* 0x00 */ "UNKNOWN",
    /* 0x01 */ "PERM_R",          /* 0x02 */ "PERM_W",
    /* 0x03 */ "PERM_X",          /* 0x04 */ "PERM_L",
    /* 0x05 */ "PERM_S",          /* 0x06 */ "PERM_E",
    /* 0x07 */ "NULL_CAP",        /* 0x08 */ "BOUNDS",
    /* 0x09 */ "VERSION",         /* 0x0A */ "SEAL",
    /* 0x0B */ "INVALID_OP",      /* 0x0C */ "TPERM_RSV",
    /* 0x0D */ "DOMAIN_PURITY",   /* 0x0E */ "PERM_B",
    /* 0x0F */ "F_BIT",           /* 0x10 */ "STACK_OVERFLOW",
    /* 0x11 */ "ABSENT_OUTFORM",  /* 0x12 */ "STACK_CORRUPT",
    /* 0x13 */ "STACK_UNDERFLOW", /* 0x14 */ "UNKNOWN",
    /* 0x15 */ "OUTFORM_CRC",     /* 0x16 */ "OUTFORM_ALLOC",
    /* 0x17 */ "OUTFORM_MINT",    /* 0x18 */ "OUTFORM_HDR",
    /* 0x19 */ "INT_OVERFLOW",
};
#define FAULT_NAMES_COUNT ((uint32_t)(sizeof(_fault_names)/sizeof(_fault_names[0])))

static const char *fault_code_name(uint32_t code)
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
    { "global.Core.Heartbeat.boot",      "Heartbeat"       },
    { "global.Core.FaultReporter.boot",  "Fault.Reporter"  },
    { "global.Core.PerfReporter.boot",   "Perf.Reporter"   },
    { "global.Core.LumpLoader.boot",     "Lump.Loader"     },
    { "global.Core.TraceEmitter.boot",   "Trace.Emitter"   },
    { "global.Core.NSInspector.boot",    "NS.Inspector"    },
    { "global.Core.MediaConsumer.boot",  "Media.Consumer"  },
    { "global.Core.BrowseClient.boot",   "Browse.Client"   },
};

/* Precomputed sha32 tokens (= first 4 bytes of SHA-256(ogt), big-endian).
 * Hard-coded to avoid sha256() byte-store instructions (sb to BRAM stack
 * hangs on this SoC — same root cause as the uart_putc volatile-loop fix).
 * Verified against scripts/test_sha32_vectors.py on the host. */
static const uint32_t _NS_TOKENS[9] = {
    0x68706247u,  /* global.Core.BoardIdentity.boot */
    0x416D6848u,  /* global.Core.Heartbeat.boot     */
    0x677D36A7u,  /* global.Core.FaultReporter.boot */
    0xEB2B7554u,  /* global.Core.PerfReporter.boot  */
    0xD728290Du,  /* global.Core.LumpLoader.boot    */
    0xA7CE2B32u,  /* global.Core.TraceEmitter.boot  */
    0x404C79D5u,  /* global.Core.NSInspector.boot   */
    0xE400EC35u,  /* global.Core.MediaConsumer.boot */
    0xE7EED989u,  /* global.Core.BrowseClient.boot  */
};

/* ------------------------------------------------------------------ */
/* Per-abstraction key table (T0.4)                                   */
/*                                                                     */
/* Populated once after boot_complete + ns_manifest emission.         */
/* Lives entirely in RISC-V private RAM — inaccessible to CM core.    */
/* 9 Core OGTs × 32 bytes = 288 bytes total.                          */
/* ------------------------------------------------------------------ */
typedef struct {
    uint8_t k_enc[16];   /* ChaCha20 key — CM_ENC_v3 derivation */
    uint8_t k_mac[16];   /* HMAC-SHA256 key — CM_MAC_v3 derivation */
} cm_key_entry_t;

static cm_key_entry_t cm_key_table[9];  /* zero-initialised at reset */

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
static inline __attribute__((always_inline)) void uart_putc(char c)
{
    UART_DATA = (1u << 8) | (uint32_t)(unsigned char)c;
    /* Register-only delay — loop counter stays in a CPU register.
     * DO NOT use "volatile uint32_t i" here: volatile forces the counter
     * to the stack (data bus).  On this SoC the data bus to ROM-space
     * (0xF9007xxx stack region) may not be ready at boot, causing a hang
     * after the very first UART write.  The asm "+r" constraint keeps the
     * counter in a GPR and avoids any memory access. */
    uint32_t _d = 3000u;
    __asm__ volatile("1: addi %0,%0,-1\n bne %0,zero,1b\n" : "+r"(_d));
}

static void uart_puts(const char *s)
{
    while (*s) uart_putc(*s++);
}

/* Returns received byte (0–255) if available, -1 if nothing waiting. */
static int uart_getc_nonblocking(void)
{
    uint32_t v = UART_DATA;
    if (v & UART_RX_VALID)
        return (int)(v & 0xFFu);
    return -1;
}

/* Blocks until a byte is available; returns received byte (0–255). */
static int uart_getc_blocking(void)
{
    uint32_t v;
    do { v = UART_DATA; } while (!(v & UART_RX_VALID));
    return (int)(v & 0xFFu);
}

/* Emit 32-bit value as 8 lowercase hex digits (no prefix). */
static void uart_puthex32_lower(uint32_t v)
{
    static const char hex[] = "0123456789abcdef";
    int i;
    for (i = 28; i >= 0; i -= 4)
        uart_putc(hex[(v >> i) & 0xFu]);
}

/* Emit a decimal number (0..999999).
 * NO local array — char buf[] requires byte-stores (sb) to stack which
 * hang on this SoC (dBus byte-enable writes to BRAM not supported).
 * Instead we walk powers of 10 from high to low using only scalar
 * uint32_t variables that -O2 keeps in CPU registers. */
static void uart_putdec(uint32_t v)
{
    uint32_t tmp;
    if (v == 0u) { uart_putc('0'); return; }
    if (v >= 100000u) { tmp = v / 100000u; uart_putc((char)('0' + tmp % 10u)); }
    if (v >= 10000u)  { tmp = v / 10000u;  uart_putc((char)('0' + tmp % 10u)); }
    if (v >= 1000u)   { tmp = v / 1000u;   uart_putc((char)('0' + tmp % 10u)); }
    if (v >= 100u)    { tmp = v / 100u;    uart_putc((char)('0' + tmp % 10u)); }
    if (v >= 10u)     { tmp = v / 10u;     uart_putc((char)('0' + tmp % 10u)); }
    uart_putc((char)('0' + v % 10u));
}

static void delay_loops(uint32_t loops)
{
    /* Register-only countdown — same reasoning as uart_putc.
     * volatile uint32_t i would force a stack write and hang. */
    __asm__ volatile("1: addi %0,%0,-1\n bne %0,zero,1b\n" : "+r"(loops));
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
static void uart_emit_callhome(uint32_t boot_reason)
{
    uint32_t i;
    uint32_t nia           = CM_NIA;
    uint32_t status        = CM_STATUS;
    uint32_t boot_ok       = (status & CM_STATUS_BOOT_COMPLETE) ? 1u : 0u;
    uint32_t fault_latched = (status & CM_STATUS_FAULT_LATCHED) ? 1u : 0u;
    uint32_t fault_code    = fault_latched ? (CM_FAULT & 0x1Fu) : 0u;

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
    /* Diagnostic: 'X' is always_inline uart_putc — if 'X' appears but nothing
     * more, the hang is inside uart_puthex32_lower.  If 'X' doesn't appear,
     * the hang is at the function-call setup or the uart_puts itself. */
    uart_putc('X');
    uart_puthex32_lower(fault_code);
    uart_puts(",\"fault_name\":\"");
    uart_puts(fault_code_name(fault_code));
    uart_puts("\"");
    uart_puts(",\"fw_major\":");
    uart_putc((char)('0' + (FW_MAJOR % 10u))); /* single-char, no division needed */
    uart_puts(",\"fw_minor\":");
    uart_putc((char)('0' + (FW_MINOR % 10u)));

    /* ns_manifest: list of 9 Core OGTs with precomputed token_32.
     * sha32() uses byte-store instructions (sb) which hang on this SoC
     * (BRAM data bus does not support byte-enable writes at boot).
     * Use the precomputed _NS_TOKENS table instead — no sha256() call. */
    uart_puts(",\"ns_manifest\":[");
    for (i = 0u; i < 9u; i++) {
        uint32_t t32 = _NS_TOKENS[i];
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
/* FAULT_EVENT emitter — reads all six telemetry registers            */
/* ------------------------------------------------------------------ */
static void uart_emit_fault_event(uint32_t ts)
{
    uint32_t nia         = CM_NIA;
    uint32_t fault_code  = CM_FAULT & 0x1Fu;
    uint32_t fault_gt    = CM_FAULT_GT;
    uint32_t fault_instr = CM_FAULT_INSTR;
    uint32_t fault_cr14  = CM_FAULT_CR14;
    uint32_t fault_stage = CM_FAULT_STAGE & 0xFu;

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
static void uart_emit_hung(uint32_t nia, uint32_t loops)
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
static void uart_emit_trace(uint32_t *buf, uint32_t count)
{
    uint32_t i;
    uart_puts("TRACE:[");
    for (i = 0u; i < count; i++) {
        if (i > 0u) uart_putc(',');
        uart_puts("0x");
        uart_puthex32_lower(buf[i]);
    }
    uart_puts("]\r\n");
}

/* ------------------------------------------------------------------ */
/* LUMP relay: stream n bytes from UART0 → APB3 relay → CM uart_rx  */
/* ------------------------------------------------------------------ */
/*
 * Protocol (called from uart_poll_command on LUMP_START:<n>\r\n):
 *   1. Read n bytes from UART0 (blocking), relay each byte to CM.
 *   2. Wait 2 s for CM PATCH_LUMP FSM to process and ACK internally.
 *   3. Restart CM: hold push_button 1.2 s (free-run restart).
 *   4. Wait 3 s for CM reboot; sample boot_complete.
 *   5. Emit LUMP_DONE:{"ok":1}\r\n or LUMP_DONE:{"ok":0}\r\n.
 */
static void lump_push(uint32_t n)
{
    uint32_t i;

    uart_puts("LUMP_PUSH_START:{\"len\":");
    uart_putdec(n);
    uart_puts("}\r\n");

    /* Relay every byte: block on UART0 RX, spin on relay ready, write */
    for (i = 0u; i < n; i++) {
        int b = uart_getc_blocking();
        while (!(CM_RELAY_READY & 1u)) { /* spin */ }
        CM_RELAY_DATA = (uint32_t)(unsigned char)b;
    }

    /* Wait 2 s for CM to finish processing the PATCH_LUMP frame */
    delay_loops(2u * LOOPS_PER_SECOND);

    /* Restart CM: hold push_button ~1.2 s (30 M cycles @ 25 MHz) */
    CM_CTRL = CM_CTRL_PRESSED;
    delay_loops(12u * (LOOPS_PER_SECOND / 10u));
    CM_CTRL = CM_CTRL_RELEASED;

    /* Wait 3 s for CM to complete boot sequence */
    delay_loops(3u * LOOPS_PER_SECOND);

    /* boot_complete is the reliable reboot indicator */
    uint32_t ok = (CM_STATUS & CM_STATUS_BOOT_COMPLETE) ? 1u : 0u;

    uart_puts("LUMP_DONE:{\"ok\":");
    uart_putc(ok ? '1' : '0');
    uart_puts("}\r\n");
}

/* ------------------------------------------------------------------ */
/* UART command receiver — non-blocking line accumulator              */
/* ------------------------------------------------------------------ */
#define RX_BUF_SIZE 32u   /* 32 > "LUMP_START:65535" (15 chars) */
static char     _rx_buf[RX_BUF_SIZE];
static uint32_t _rx_len = 0u;

/* Call once per sub-tick.  Returns 1 if a complete command was processed. */
static int uart_poll_command(uint32_t *force_callhome_out)
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

        if (_rx_len == 5u &&
            _rx_buf[0]=='R' && _rx_buf[1]=='E' && _rx_buf[2]=='S' &&
            _rx_buf[3]=='E' && _rx_buf[4]=='T') {
            /* RESET: pulse CTRL=0 for 1 s */
            uart_puts("RESET-ACK\r\n");
            CM_CTRL = CM_CTRL_PRESSED;
            delay_loops(LOOPS_PER_SECOND);
            CM_CTRL = CM_CTRL_RELEASED;
        } else if (_rx_len == 4u &&
                   _rx_buf[0]=='P' && _rx_buf[1]=='I' &&
                   _rx_buf[2]=='N' && _rx_buf[3]=='G') {
            uart_puts("PONG\r\n");
        } else if (_rx_len == 7u &&
                   _rx_buf[0]=='S' && _rx_buf[1]=='T' && _rx_buf[2]=='A' &&
                   _rx_buf[3]=='T' && _rx_buf[4]=='U' && _rx_buf[5]=='S' &&
                   _rx_buf[6]=='?') {
            if (force_callhome_out)
                *force_callhome_out = 1u;
        } else if (_rx_len >= 12u &&
                   _rx_buf[0]=='L' && _rx_buf[1]=='U' && _rx_buf[2]=='M' &&
                   _rx_buf[3]=='P' && _rx_buf[4]=='_' && _rx_buf[5]=='S' &&
                   _rx_buf[6]=='T' && _rx_buf[7]=='A' && _rx_buf[8]=='R' &&
                   _rx_buf[9]=='T' && _rx_buf[10]==':') {
            /* Parse decimal byte count after "LUMP_START:" */
            uint32_t n = 0u;
            uint32_t k;
            for (k = 11u; k < _rx_len; k++) {
                if (_rx_buf[k] >= '0' && _rx_buf[k] <= '9')
                    n = n * 10u + (uint32_t)(_rx_buf[k] - '0');
            }
            if (n > 0u)
                lump_push(n);
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
    uint32_t i;
    uint32_t boot_reason = 0u;   /* 0 = cold boot */

    /* ---- Step 1: Baud rate (MUST be first) ---- */
    UART_CLOCKDIV = UART_DIV_57600;

    /* ---- Step 2: Write UID to APB3 bridge registers before any CALLHOME ---- */
    CM_UID_LO = BOARD_UID_LO;
    CM_UID_HI = BOARD_UID_HI;

    /* ---- Step 3: Release push_button (keep CM running) ---- */
    CM_CTRL = CM_CTRL_RELEASED;

    /* ---- Step 4: Boot banner ---- */
    uart_puts("CHURCH Ti60 SoC+CM v2.3\r\n");
    uart_puts("UID=");
    emit_uid();
    uart_puts("\r\n");

    /* ---- Step 5: Wait for CM boot_complete (timeout ~3 s) ---- */
    uart_puts("Waiting for CM boot_complete...\r\n");
    uint32_t boot_seen = 0u;
    for (uint32_t t = 0u; t < 3u; t++) {
        if (CM_STATUS & CM_STATUS_BOOT_COMPLETE) {
            boot_seen = 1u;
            uart_puts("CM boot_complete: 1\r\n");
            break;
        }
        delay_loops(LOOPS_PER_SECOND);
    }
    if (!boot_seen)
        uart_puts("CM boot_complete: timeout (CM debug FSM may still be starting)\r\n");

    /* ---- Step 6: CALLHOME before the 3-second free-run delay ----
     * Moved BEFORE delay_loops() to complete in ~60 ms, well ahead of any
     * time-triggered hardware event at the ~3-second mark that was suspected
     * to stall the Sapphire SoC's AXI data bus mid-transaction.
     * (Previous builds: output always stopped at exactly "fault_code": after
     * ~3 s elapsed — consistent with a time-triggered AXI/BRAM stall.) */
    uart_puts("Emitting CALLHOME before free-run delay...\r\n");
    uart_emit_callhome(boot_reason);

    /* ---- Step 7: Wait for CM to reach free-run (~3 s startup counter) ---- */
    uart_puts("Waiting for CM free-run (~3 s startup counter)...\r\n");
    delay_loops(3u * LOOPS_PER_SECOND);
    uart_puts("CM free-run window passed.\r\n");

    /* T0.4 key derivation — DISABLED pending byte-store-safe BRAM fix.
     * hkdf_sha256 → _sha256_update → ctx->buf[] byte stores hang on this
     * SoC (BRAM dBus byte-enable writes not supported at boot).  Keys stay
     * zero; cm_key_table is zero-initialised at reset.  The LUMP relay
     * protocol does not need keys until a LUMP_START command is issued.
     * TODO: replace sha256.h byte-store paths with uint32_t word-pack ops.
     * (void)cm_key_table;   ← suppress unused warning without the loop */
    (void)cm_key_table;

    /* ---- Watchdog state ---- */
    uint32_t last_nia      = CM_NIA;
    uint32_t nia_unchanged = 0u;

    /* ---- NIA trace buffer (10 entries, sampled at ~10 Hz) ---- */
    uint32_t trace_buf[10];
    uint32_t trace_idx = 0u;

    /* ---- Loop counter (proxy timestamp for FAULT_EVENT ts field) ---- */
    uint32_t loop_ctr = 0u;

    uart_puts("Monitoring CM (Ctrl+C to stop host terminal):\r\n");

    for (;;) {
        uint32_t force_callhome = 0u;

        /* ------------------------------------------------------------
         * Inner trace loop: 10 × (LOOPS_PER_SECOND/10) ≈ 1 second total.
         * Sample NIA every ~100 ms; poll UART commands between samples.
         * ------------------------------------------------------------ */
        uint32_t ti;
        for (ti = 0u; ti < 10u; ti++) {
            delay_loops(LOOPS_PER_SECOND / 10u);
            trace_buf[trace_idx++] = CM_NIA;
            uart_poll_command(&force_callhome);
        }

        /* Emit TRACE when buffer is full (every outer iteration ≈ 1 s) */
        uart_emit_trace(trace_buf, 10u);
        trace_idx = 0u;

        /* ------------------------------------------------------------
         * Hung-program watchdog
         * Track NIA unchanged-samples.  3 unchanged 1-s samples = 3 s hang.
         * Only trigger if no fault is latched (known fault ≠ hung).
         * Exempt NIA in [NUC_CODE_START, NUC_CODE_END]: the LED blink inner
         * delay loop dominates ~99.9% of execution time and appears "stuck"
         * to the 1-Hz sampler even while running correctly.
         * NIA < NUC_CODE_START fires (stuck-at-boot / BRAM zeroed / wrong PC).
         * NIA > NUC_CODE_END fires (genuinely hung post-NUC code).
         * ------------------------------------------------------------ */
        uint32_t nia    = CM_NIA;
        uint32_t status = CM_STATUS;

        if (!(status & CM_STATUS_FAULT_LATCHED)) {
            if (nia == last_nia && (nia < NUC_CODE_START || nia > NUC_CODE_END)) {
                nia_unchanged++;
                if (nia_unchanged >= 3u) {
                    uart_emit_hung(nia, nia_unchanged);
                    CM_CTRL = CM_CTRL_PRESSED;
                    delay_loops(LOOPS_PER_SECOND);
                    CM_CTRL = CM_CTRL_RELEASED;
                    nia_unchanged = 0u;
                    last_nia = CM_NIA;
                }
            } else {
                last_nia = nia;
                nia_unchanged = 0u;
            }
        } else {
            /* NIA may be frozen at fault address — don't count as hung */
            nia_unchanged = 0u;
        }

        /* ------------------------------------------------------------
         * Fault detection and telemetry
         * ------------------------------------------------------------ */
        if (status & CM_STATUS_FAULT_LATCHED) {
            /* a. Emit structured FAULT_EVENT with all six telemetry fields */
            uart_emit_fault_event(loop_ctr);

            /* b. Clear the latch so the next fault is independently detectable */
            CM_FAULT_RST = 1u;

            /* c. Pulse CTRL=0 for 1 s to reboot the CM core (btn_hold_done) */
            CM_CTRL = CM_CTRL_PRESSED;
            delay_loops(LOOPS_PER_SECOND);
            CM_CTRL = CM_CTRL_RELEASED;

            /* d. Wait up to 5 s for boot_complete to reassert */
            for (uint32_t t = 0u; t < 5u; t++) {
                if (CM_STATUS & CM_STATUS_BOOT_COMPLETE)
                    break;
                delay_loops(LOOPS_PER_SECOND);
            }

            boot_reason   = 2u;   /* fault-recovery re-boot */
            last_nia      = CM_NIA;
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
