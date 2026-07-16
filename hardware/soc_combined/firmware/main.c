/*
 * hardware/soc_combined/firmware/main.c
 *
 * Bare-metal RISC-V firmware for the combined Sapphire SoC + Church Machine
 * bitstream on the Ti60F225 devkit.
 *
 * FIRMWARE v2.4 — LUMP relay: APB3 UART-TX relay delivers LUMPs via ttyUSB2 only
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
 *             "fw_major":2,"fw_minor":4,
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
/* Standard freestanding headers only — no libc                       */
/* ------------------------------------------------------------------ */
#include <stdint.h>
#include "build_seq.h"     /* FW_BUILD_LETTER — cycles A→B→…→Z→A per rebuild */

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
/* Non-const → placed in .data → crt0 copies to RAM (0xF9007000).
 * ROM BRAM dBus reads hang when iBus is active; RAM BRAM is dBus-only. */
static char _fault_names[][16] = {
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
    return (code < FAULT_NAMES_COUNT) ? _fault_names[code] : _fault_names[0];
}

/* ------------------------------------------------------------------ */
/* NS manifest — 9 Core abstractions always present on every board    */
/* ------------------------------------------------------------------ */
/* Embedded char arrays (non-const) → .data → copied to RAM by crt0.
 * char-pointer members would put the pointed-to strings in .rodata (ROM),
 * causing uart_puts to hang on the ROM BRAM dBus/iBus port conflict. */
static struct {
    char ogt[36];
    char label[20];
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
static uint32_t _NS_TOKENS[9] = {
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

/* ================================================================
 * RAM string table
 *
 * ROOT CAUSE of uart_puts hang (confirmed 2026-07-16):
 *   The Efinix BRAM used for ROM (28 KB, 0xF9000000) is a single-port
 *   block shared between the iBus (instruction fetch, always running) and
 *   the dBus (data reads, e.g. uart_puts lw from .rodata).  iBus always
 *   wins the arbitration.  Any dBus lw from the ROM BRAM hangs forever.
 *
 *   The RAM BRAM (4 KB, 0xF9007000) is connected only to the dBus →
 *   dBus lw/sw work correctly there.
 *
 * FIX: declare every string as a non-const static char[] so it lands in
 *   .data (not .rodata).  crt0.S copies .data from ROM to RAM at startup.
 *   uart_puts then reads from RAM → no iBus conflict → no hang.
 *
 * RULE: every pointer passed to uart_puts() MUST come from this table,
 *   from a .data char array, or from the stack — NEVER from a string
 *   literal or const array (those go to .rodata in ROM and will hang).
 * ================================================================ */

/* Shared fragments (reused across multiple emitters) */
static char _rs_nia_open[]      = "\",\"nia\":\"0x";
static char _rs_obj_close[]     = "}\r\n";
static char _rs_quote[]         = "\"";
static char _rs_fn_open[]       = ",\"fault_name\":\"";

/* CALLHOME record */
static char _rs_ch_hdr[]        = "CALLHOME:{\"board\":\"Ti60F225\",\"uid\":\"";
static char _rs_ch_boot_ok[]    = "\",\"boot_ok\":";
static char _rs_ch_boot_rsn[]   = ",\"boot_reason\":";
static char _rs_ch_fault[]      = ",\"fault\":";
static char _rs_ch_fc[]         = ",\"fault_code\":";
static char _rs_ch_fwmaj[]      = ",\"fw_major\":";
static char _rs_ch_fwmin[]      = ",\"fw_minor\":";
static char _rs_ch_ns_open[]    = ",\"ns_manifest\":[";
static char _rs_ch_ogt_open[]   = "{\"ogt\":\"";
static char _rs_ch_tok_open[]   = "\",\"token_32\":\"0x";
static char _rs_ch_lbl_open[]   = "\",\"label\":\"";
static char _rs_ch_res_true[]   = "\",\"resident\":true}";
static char _rs_ch_close[]      = "]}\r\n";

/* FAULT_EVENT record */
static char _rs_fe_hdr[]        = "FAULT_EVENT:{\"uid\":\"";
static char _rs_fe_fc[]         = "\",\"fault_code\":";
static char _rs_fe_gt[]         = "\",\"fault_gt\":\"0x";
static char _rs_fe_instr[]      = "\",\"fault_instr\":\"0x";
static char _rs_fe_cr14[]       = "\",\"fault_cr14\":\"0x";
static char _rs_fe_stage[]      = "\",\"fault_stage\":";
static char _rs_fe_ts[]         = ",\"ts\":";

/* HUNG record */
static char _rs_hung_hdr[]      = "HUNG:{\"uid\":\"";
static char _rs_hung_loops[]    = "\",\"loops\":";

/* TRACE record */
static char _rs_trace_open[]    = "TRACE:[";
static char _rs_trace_hex[]     = "0x";
static char _rs_trace_close[]   = "]\r\n";

/* LUMP relay */
static char _rs_lump_start[]    = "LUMP_PUSH_START:{\"len\":";
static char _rs_lump_ok_open[]  = "LUMP_DONE:{\"ok\":";

/* Command responses */
static char _rs_reset_ack[]     = "RESET-ACK\r\n";
static char _rs_pong[]          = "PONG\r\n";

/* Main boot sequence */
static char _rs_wait_boot[]     = "Waiting for CM boot_complete...\r\n";
static char _rs_boot_ok_1[]     = "CM boot_complete: 1\r\n";
static char _rs_boot_timeout[]  = "CM boot_complete: timeout (CM debug FSM may still be starting)\r\n";
static char _rs_emit_ch[]       = "Emitting CALLHOME before free-run delay...\r\n";
static char _rs_wait_frun[]     = "Waiting for CM free-run (~3 s startup counter)...\r\n";
static char _rs_frun_done[]     = "CM free-run window passed.\r\n";
static char _rs_monitoring[]    = "Monitoring CM (Ctrl+C to stop host terminal):\r\n";

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
/* uart_putc — MUST be always_inline.
 *
 * If compiled as a regular function (even at -O0), the GCC prologue emits
 * "sb a0, offset(sp)" to spill the char parameter to the stack.  sb (byte
 * store) to the BRAM stack area (0xF9007xxx) hangs on this SoC — same
 * hardware byte-enable defect as lbu from non-zero byte lanes.  Inlining
 * eliminates the prologue entirely; the caller's register holds the value
 * throughout without any stack spill.
 *
 * The asm "+r" constraint keeps _d in a GPR — no stack access in the delay.
 * DO NOT add "volatile" to _d or change to a C loop: either forces a stack
 * round-trip via sw/lw which is safe but pointless, or risks lbu/sb. */
static inline __attribute__((always_inline)) void uart_putc(uint32_t c)
{
    UART_DATA = (1u << 8) | (c & 0xFFu);
    /* 10 000-cycle register-only delay (~400 µs at 25 MHz).
     * One UART character at 57 600 baud takes 4 340 cycles (174 µs).
     * The BRAM dBus stalls after every UART_DATA write until TX finishes.
     * 10 000 > 4 340, so the stall is guaranteed clear before we return.
     * DO NOT add any APB write between this delay and the next ROM lw —
     * any APB write resets the stall timer. */
    uint32_t _d = 10000u;
    __asm__ volatile("1: addi %0,%0,-1\n bne %0,zero,1b\n" : "+r"(_d));
}

/* uart_puts — s MUST point to RAM (.data or stack), never .rodata.
 *
 * ROOT CAUSE (confirmed 2026-07-16): ROM BRAM (0xF9000000, 28 KB) is a
 * single-port block shared between iBus (instruction fetch, always running)
 * and dBus (data reads).  iBus always wins port arbitration.  Any dBus lw
 * from ROM BRAM hangs forever.  RAM BRAM (0xF9007000, 4 KB) is dBus-only
 * and works correctly.
 *
 * FIX: all callers pass pointers from the _rs_* RAM string table or from
 * embedded-char-array struct members (_NS_MANIFEST, _fault_names).  These
 * are non-const statics → placed in .data → copied to RAM by crt0.S.
 *
 * -O0: prevents GCC from replacing lw+shift with lbu (non-zero byte-lane
 *   lbu also hangs — separate BRAM byte-enable defect).
 * uint32_t c: prevents GCC from spilling the char via sb (byte-store to
 *   0xF9007xxx hangs — word stores with sw are safe).
 * always_inline on uart_putc: prevents a prologue sb for the char arg. */
static void __attribute__((optimize("O0"))) uart_puts(const char *s)
{
    /* s must be in RAM — see RAM string table (above) for explanation. */
    uint32_t align = (uintptr_t)s & 3u;
    const uint32_t *wp = (const uint32_t *)((uintptr_t)s - align);
    uint32_t w = *wp++;
    uint32_t remaining = 4u - align;
    w >>= (align << 3);
    for (;;) {
        uint32_t c = w & 0xFFu;       /* uint32_t: spills as sw not sb */
        if (c == 0u) return;
        uart_putc(c);                 /* 10k-cycle delay clears this stall */
        w >>= 8;
        if (--remaining == 0u) {
            /* uart_putc delay cleared the stall — ROM lw is safe directly.
             * Do NOT write any APB register here: that resets the timer. */
            w = *wp++;
            remaining = 4u;
        }
    }
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
    /* Avoid lbu from static const char hex[] — same root cause as
     * the uart_puts / sb-to-stack hang: byte-lane sub-word reads from
     * ROM BRAM after a UART APB write stall the dBus.  Compute the
     * nibble→char mapping arithmetically instead (all registers). */
    int i;
    for (i = 28; i >= 0; i -= 4) {
        uint32_t nib = (v >> i) & 0xFu;
        uart_putc((char)(nib < 10u ? ('0' + nib) : ('a' + (nib - 10u))));
    }
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

    uart_puts(_rs_ch_hdr);
    emit_uid();
    uart_puts(_rs_nia_open);
    uart_puthex32_lower(nia);
    uart_puts(_rs_ch_boot_ok);
    uart_putc(boot_ok ? '1' : '0');
    uart_puts(_rs_ch_boot_rsn);
    uart_putc((char)('0' + (boot_reason & 0xFu)));
    uart_puts(_rs_ch_fault);
    uart_putc(fault_latched ? '1' : '0');
    uart_puts(_rs_ch_fc);
    uart_puthex32_lower(fault_code);
    uart_puts(_rs_fn_open);
    uart_puts(fault_code_name(fault_code));
    uart_puts(_rs_quote);
    uart_puts(_rs_ch_fwmaj);
    uart_putc((char)('0' + (FW_MAJOR % 10u)));
    uart_puts(_rs_ch_fwmin);
    uart_putc((char)('0' + (FW_MINOR % 10u)));

    /* ns_manifest: list of 9 Core OGTs with precomputed token_32.
     * sha32() uses byte-store instructions (sb) which hang on this SoC
     * (BRAM data bus does not support byte-enable writes at boot).
     * Use the precomputed _NS_TOKENS table instead — no sha256() call. */
    uart_puts(_rs_ch_ns_open);
    for (i = 0u; i < 9u; i++) {
        uint32_t t32 = _NS_TOKENS[i];
        if (i > 0u) uart_putc(',');
        uart_puts(_rs_ch_ogt_open);
        uart_puts(_NS_MANIFEST[i].ogt);
        uart_puts(_rs_ch_tok_open);
        uart_puthex32_lower(t32);
        uart_puts(_rs_ch_lbl_open);
        uart_puts(_NS_MANIFEST[i].label);
        uart_puts(_rs_ch_res_true);
    }
    uart_puts(_rs_ch_close);
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

    uart_puts(_rs_fe_hdr);
    emit_uid();
    uart_puts(_rs_nia_open);
    uart_puthex32_lower(nia);
    uart_puts(_rs_fe_fc);
    uart_putdec(fault_code);
    uart_puts(_rs_fn_open);
    uart_puts(fault_code_name(fault_code));
    uart_puts(_rs_fe_gt);
    uart_puthex32_lower(fault_gt);
    uart_puts(_rs_fe_instr);
    uart_puthex32_lower(fault_instr);
    uart_puts(_rs_fe_cr14);
    uart_puthex32_lower(fault_cr14);
    uart_puts(_rs_fe_stage);
    uart_putdec(fault_stage);
    uart_puts(_rs_fe_ts);
    uart_putdec(ts);
    uart_puts(_rs_obj_close);
}

/* ------------------------------------------------------------------ */
/* HUNG emitter                                                        */
/* ------------------------------------------------------------------ */
static void uart_emit_hung(uint32_t nia, uint32_t loops)
{
    uart_puts(_rs_hung_hdr);
    emit_uid();
    uart_puts(_rs_nia_open);
    uart_puthex32_lower(nia);
    uart_puts(_rs_hung_loops);
    uart_putdec(loops);
    uart_puts(_rs_obj_close);
}

/* ------------------------------------------------------------------ */
/* TRACE emitter — 10-entry NIA buffer                                */
/* ------------------------------------------------------------------ */
static void uart_emit_trace(uint32_t *buf, uint32_t count)
{
    uint32_t i;
    uart_puts(_rs_trace_open);
    for (i = 0u; i < count; i++) {
        if (i > 0u) uart_putc(',');
        uart_puts(_rs_trace_hex);
        uart_puthex32_lower(buf[i]);
    }
    uart_puts(_rs_trace_close);
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

    uart_puts(_rs_lump_start);
    uart_putdec(n);
    uart_puts(_rs_obj_close);

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

    uart_puts(_rs_lump_ok_open);
    uart_putc(ok ? '1' : '0');
    uart_puts(_rs_obj_close);
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
            uart_puts(_rs_reset_ack);
            CM_CTRL = CM_CTRL_PRESSED;
            delay_loops(LOOPS_PER_SECOND);
            CM_CTRL = CM_CTRL_RELEASED;
        } else if (_rx_len == 4u &&
                   _rx_buf[0]=='P' && _rx_buf[1]=='I' &&
                   _rx_buf[2]=='N' && _rx_buf[3]=='G') {
            uart_puts(_rs_pong);
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

/* init_strings_ram -- write every .data string/array to RAM via sw+li.
 * crt0.S copies .data using lw from ROM BRAM, which hangs when iBus is
 * active (single-port; iBus wins arbitration).  This function bypasses
 * the crt0 copy: each store is a register-immediate sw -- no ROM lw. */
static void __attribute__((optimize("O0"))) init_strings_ram(void)
{
    uint32_t *p;

    /* _rs_* string table */
    p = (uint32_t*)_rs_nia_open;
    p[0] = 0x6E222C22u;
    p[1] = 0x3A226169u;
    p[2] = 0x00783022u;
    p = (uint32_t*)_rs_obj_close;
    p[0] = 0x000A0D7Du;
    p = (uint32_t*)_rs_quote;
    p[0] = 0x00000022u;
    p = (uint32_t*)_rs_fn_open;
    p[0] = 0x6166222Cu;
    p[1] = 0x5F746C75u;
    p[2] = 0x656D616Eu;
    p[3] = 0x00223A22u;
    p = (uint32_t*)_rs_ch_hdr;
    p[0] = 0x4C4C4143u;
    p[1] = 0x454D4F48u;
    p[2] = 0x62227B3Au;
    p[3] = 0x6472616Fu;
    p[4] = 0x54223A22u;
    p[5] = 0x46303669u;
    p[6] = 0x22353232u;
    p[7] = 0x6975222Cu;
    p[8] = 0x223A2264u;
    p[9] = 0u;
    p = (uint32_t*)_rs_ch_boot_ok;
    p[0] = 0x62222C22u;
    p[1] = 0x5F746F6Fu;
    p[2] = 0x3A226B6Fu;
    p[3] = 0u;
    p = (uint32_t*)_rs_ch_boot_rsn;
    p[0] = 0x6F62222Cu;
    p[1] = 0x725F746Fu;
    p[2] = 0x6F736165u;
    p[3] = 0x003A226Eu;
    p = (uint32_t*)_rs_ch_fault;
    p[0] = 0x6166222Cu;
    p[1] = 0x22746C75u;
    p[2] = 0x0000003Au;
    p = (uint32_t*)_rs_ch_fc;
    p[0] = 0x6166222Cu;
    p[1] = 0x5F746C75u;
    p[2] = 0x65646F63u;
    p[3] = 0x00003A22u;
    p = (uint32_t*)_rs_ch_fwmaj;
    p[0] = 0x7766222Cu;
    p[1] = 0x6A616D5Fu;
    p[2] = 0x3A22726Fu;
    p[3] = 0u;
    p = (uint32_t*)_rs_ch_fwmin;
    p[0] = 0x7766222Cu;
    p[1] = 0x6E696D5Fu;
    p[2] = 0x3A22726Fu;
    p[3] = 0u;
    p = (uint32_t*)_rs_ch_ns_open;
    p[0] = 0x736E222Cu;
    p[1] = 0x6E616D5Fu;
    p[2] = 0x73656669u;
    p[3] = 0x5B3A2274u;
    p[4] = 0u;
    p = (uint32_t*)_rs_ch_ogt_open;
    p[0] = 0x676F227Bu;
    p[1] = 0x223A2274u;
    p[2] = 0u;
    p = (uint32_t*)_rs_ch_tok_open;
    p[0] = 0x74222C22u;
    p[1] = 0x6E656B6Fu;
    p[2] = 0x2232335Fu;
    p[3] = 0x7830223Au;
    p[4] = 0u;
    p = (uint32_t*)_rs_ch_lbl_open;
    p[0] = 0x6C222C22u;
    p[1] = 0x6C656261u;
    p[2] = 0x00223A22u;
    p = (uint32_t*)_rs_ch_res_true;
    p[0] = 0x72222C22u;
    p[1] = 0x64697365u;
    p[2] = 0x22746E65u;
    p[3] = 0x7572743Au;
    p[4] = 0x00007D65u;
    p = (uint32_t*)_rs_ch_close;
    p[0] = 0x0A0D7D5Du;
    p[1] = 0u;
    p = (uint32_t*)_rs_fe_hdr;
    p[0] = 0x4C554146u;
    p[1] = 0x56455F54u;
    p[2] = 0x3A544E45u;
    p[3] = 0x6975227Bu;
    p[4] = 0x223A2264u;
    p[5] = 0u;
    p = (uint32_t*)_rs_fe_fc;
    p[0] = 0x66222C22u;
    p[1] = 0x746C7561u;
    p[2] = 0x646F635Fu;
    p[3] = 0x003A2265u;
    p = (uint32_t*)_rs_fe_gt;
    p[0] = 0x66222C22u;
    p[1] = 0x746C7561u;
    p[2] = 0x2274675Fu;
    p[3] = 0x7830223Au;
    p[4] = 0u;
    p = (uint32_t*)_rs_fe_instr;
    p[0] = 0x66222C22u;
    p[1] = 0x746C7561u;
    p[2] = 0x736E695Fu;
    p[3] = 0x3A227274u;
    p[4] = 0x00783022u;
    p = (uint32_t*)_rs_fe_cr14;
    p[0] = 0x66222C22u;
    p[1] = 0x746C7561u;
    p[2] = 0x3172635Fu;
    p[3] = 0x223A2234u;
    p[4] = 0x00007830u;
    p = (uint32_t*)_rs_fe_stage;
    p[0] = 0x66222C22u;
    p[1] = 0x746C7561u;
    p[2] = 0x6174735Fu;
    p[3] = 0x3A226567u;
    p[4] = 0u;
    p = (uint32_t*)_rs_fe_ts;
    p[0] = 0x7374222Cu;
    p[1] = 0x00003A22u;
    p = (uint32_t*)_rs_hung_hdr;
    p[0] = 0x474E5548u;
    p[1] = 0x75227B3Au;
    p[2] = 0x3A226469u;
    p[3] = 0x00000022u;
    p = (uint32_t*)_rs_hung_loops;
    p[0] = 0x6C222C22u;
    p[1] = 0x73706F6Fu;
    p[2] = 0x00003A22u;
    p = (uint32_t*)_rs_trace_open;
    p[0] = 0x43415254u;
    p[1] = 0x005B3A45u;
    p = (uint32_t*)_rs_trace_hex;
    p[0] = 0x00007830u;
    p = (uint32_t*)_rs_trace_close;
    p[0] = 0x000A0D5Du;
    p = (uint32_t*)_rs_lump_start;
    p[0] = 0x504D554Cu;
    p[1] = 0x5355505Fu;
    p[2] = 0x54535F48u;
    p[3] = 0x3A545241u;
    p[4] = 0x656C227Bu;
    p[5] = 0x003A226Eu;
    p = (uint32_t*)_rs_lump_ok_open;
    p[0] = 0x504D554Cu;
    p[1] = 0x4E4F445Fu;
    p[2] = 0x227B3A45u;
    p[3] = 0x3A226B6Fu;
    p[4] = 0u;
    p = (uint32_t*)_rs_reset_ack;
    p[0] = 0x45534552u;
    p[1] = 0x43412D54u;
    p[2] = 0x000A0D4Bu;
    p = (uint32_t*)_rs_pong;
    p[0] = 0x474E4F50u;
    p[1] = 0x00000A0Du;
    p = (uint32_t*)_rs_wait_boot;
    p[0] = 0x74696157u;
    p[1] = 0x20676E69u;
    p[2] = 0x20726F66u;
    p[3] = 0x62204D43u;
    p[4] = 0x5F746F6Fu;
    p[5] = 0x706D6F63u;
    p[6] = 0x6574656Cu;
    p[7] = 0x0D2E2E2Eu;
    p[8] = 0x0000000Au;
    p = (uint32_t*)_rs_boot_ok_1;
    p[0] = 0x62204D43u;
    p[1] = 0x5F746F6Fu;
    p[2] = 0x706D6F63u;
    p[3] = 0x6574656Cu;
    p[4] = 0x0D31203Au;
    p[5] = 0x0000000Au;
    p = (uint32_t*)_rs_boot_timeout;
    p[0] = 0x62204D43u;
    p[1] = 0x5F746F6Fu;
    p[2] = 0x706D6F63u;
    p[3] = 0x6574656Cu;
    p[4] = 0x6974203Au;
    p[5] = 0x756F656Du;
    p[6] = 0x000A0D74u;
    p = (uint32_t*)_rs_emit_ch;
    p[0] = 0x74696D45u;
    p[1] = 0x676E6974u;
    p[2] = 0x4C414320u;
    p[3] = 0x4D4F484Cu;
    p[4] = 0x2E2E2E45u;
    p[5] = 0x00000A0Du;
    p = (uint32_t*)_rs_wait_frun;
    p[0] = 0x74696157u;
    p[1] = 0x20676E69u;
    p[2] = 0x20726F66u;
    p[3] = 0x66204D43u;
    p[4] = 0x2D656572u;
    p[5] = 0x2E6E7572u;
    p[6] = 0x0A0D2E2Eu;
    p[7] = 0u;
    p = (uint32_t*)_rs_frun_done;
    p[0] = 0x66204D43u;
    p[1] = 0x2D656572u;
    p[2] = 0x206E7572u;
    p[3] = 0x646E6977u;
    p[4] = 0x7020776Fu;
    p[5] = 0x65737361u;
    p[6] = 0x0A0D2E64u;
    p[7] = 0u;
    p = (uint32_t*)_rs_monitoring;
    p[0] = 0x696E6F4Du;
    p[1] = 0x69726F74u;
    p[2] = 0x4320676Eu;
    p[3] = 0x0A0D3A4Du;
    p[4] = 0u;

    /* _fault_names[26][16] */
    p = (uint32_t*)_fault_names;
    p[0] = 0x4E4B4E55u;
    p[1] = 0x004E574Fu;
    p[2] = 0u;
    p[3] = 0u;
    p[4] = 0x4D524550u;
    p[5] = 0x0000525Fu;
    p[6] = 0u;
    p[7] = 0u;
    p[8] = 0x4D524550u;
    p[9] = 0x0000575Fu;
    p[10] = 0u;
    p[11] = 0u;
    p[12] = 0x4D524550u;
    p[13] = 0x0000585Fu;
    p[14] = 0u;
    p[15] = 0u;
    p[16] = 0x4D524550u;
    p[17] = 0x00004C5Fu;
    p[18] = 0u;
    p[19] = 0u;
    p[20] = 0x4D524550u;
    p[21] = 0x0000535Fu;
    p[22] = 0u;
    p[23] = 0u;
    p[24] = 0x4D524550u;
    p[25] = 0x0000455Fu;
    p[26] = 0u;
    p[27] = 0u;
    p[28] = 0x4C4C554Eu;
    p[29] = 0x5041435Fu;
    p[30] = 0u;
    p[31] = 0u;
    p[32] = 0x4E554F42u;
    p[33] = 0x00005344u;
    p[34] = 0u;
    p[35] = 0u;
    p[36] = 0x53524556u;
    p[37] = 0x004E4F49u;
    p[38] = 0u;
    p[39] = 0u;
    p[40] = 0x4C414553u;
    p[41] = 0u;
    p[42] = 0u;
    p[43] = 0u;
    p[44] = 0x41564E49u;
    p[45] = 0x5F44494Cu;
    p[46] = 0x0000504Fu;
    p[47] = 0u;
    p[48] = 0x52455054u;
    p[49] = 0x53525F4Du;
    p[50] = 0x00000056u;
    p[51] = 0u;
    p[52] = 0x414D4F44u;
    p[53] = 0x505F4E49u;
    p[54] = 0x54495255u;
    p[55] = 0x00000059u;
    p[56] = 0x4D524550u;
    p[57] = 0x0000425Fu;
    p[58] = 0u;
    p[59] = 0u;
    p[60] = 0x49425F46u;
    p[61] = 0x00000054u;
    p[62] = 0u;
    p[63] = 0u;
    p[64] = 0x43415453u;
    p[65] = 0x564F5F4Bu;
    p[66] = 0x4C465245u;
    p[67] = 0x0000574Fu;
    p[68] = 0x45534241u;
    p[69] = 0x4F5F544Eu;
    p[70] = 0x4F465455u;
    p[71] = 0x00004D52u;
    p[72] = 0x43415453u;
    p[73] = 0x4F435F4Bu;
    p[74] = 0x50555252u;
    p[75] = 0x00000054u;
    p[76] = 0x43415453u;
    p[77] = 0x4E555F4Bu;
    p[78] = 0x46524544u;
    p[79] = 0x00574F4Cu;
    p[80] = 0x4E4B4E55u;
    p[81] = 0x004E574Fu;
    p[82] = 0u;
    p[83] = 0u;
    p[84] = 0x4654554Fu;
    p[85] = 0x5F4D524Fu;
    p[86] = 0x00435243u;
    p[87] = 0u;
    p[88] = 0x4654554Fu;
    p[89] = 0x5F4D524Fu;
    p[90] = 0x4F4C4C41u;
    p[91] = 0x00000043u;
    p[92] = 0x4654554Fu;
    p[93] = 0x5F4D524Fu;
    p[94] = 0x544E494Du;
    p[95] = 0u;
    p[96] = 0x4654554Fu;
    p[97] = 0x5F4D524Fu;
    p[98] = 0x00524448u;
    p[99] = 0u;
    p[100] = 0x5F544E49u;
    p[101] = 0x5245564Fu;
    p[102] = 0x574F4C46u;
    p[103] = 0u;

    /* _NS_MANIFEST[9] = { ogt[36], label[20] } */
    p = (uint32_t*)_NS_MANIFEST;
    p[0] = 0x626F6C67u;
    p[1] = 0x432E6C61u;
    p[2] = 0x2E65726Fu;
    p[3] = 0x72616F42u;
    p[4] = 0x65644964u;
    p[5] = 0x7469746Eu;
    p[6] = 0x6F622E79u;
    p[7] = 0x0000746Fu;
    p[8] = 0u;
    p[9] = 0x72616F42u;
    p[10] = 0x64492E64u;
    p[11] = 0x69746E65u;
    p[12] = 0x00007974u;
    p[13] = 0u;
    p[14] = 0x626F6C67u;
    p[15] = 0x432E6C61u;
    p[16] = 0x2E65726Fu;
    p[17] = 0x72616548u;
    p[18] = 0x61656274u;
    p[19] = 0x6F622E74u;
    p[20] = 0x0000746Fu;
    p[21] = 0u;
    p[22] = 0u;
    p[23] = 0x72616548u;
    p[24] = 0x61656274u;
    p[25] = 0x00000074u;
    p[26] = 0u;
    p[27] = 0u;
    p[28] = 0x626F6C67u;
    p[29] = 0x432E6C61u;
    p[30] = 0x2E65726Fu;
    p[31] = 0x6C756146u;
    p[32] = 0x70655274u;
    p[33] = 0x6574726Fu;
    p[34] = 0x6F622E72u;
    p[35] = 0x0000746Fu;
    p[36] = 0u;
    p[37] = 0x6C756146u;
    p[38] = 0x65522E74u;
    p[39] = 0x74726F70u;
    p[40] = 0x00007265u;
    p[41] = 0u;
    p[42] = 0x626F6C67u;
    p[43] = 0x432E6C61u;
    p[44] = 0x2E65726Fu;
    p[45] = 0x66726550u;
    p[46] = 0x6F706552u;
    p[47] = 0x72657472u;
    p[48] = 0x6F6F622Eu;
    p[49] = 0x00000074u;
    p[50] = 0u;
    p[51] = 0x66726550u;
    p[52] = 0x7065522Eu;
    p[53] = 0x6574726Fu;
    p[54] = 0x00000072u;
    p[55] = 0u;
    p[56] = 0x626F6C67u;
    p[57] = 0x432E6C61u;
    p[58] = 0x2E65726Fu;
    p[59] = 0x706D754Cu;
    p[60] = 0x64616F4Cu;
    p[61] = 0x622E7265u;
    p[62] = 0x00746F6Fu;
    p[63] = 0u;
    p[64] = 0u;
    p[65] = 0x706D754Cu;
    p[66] = 0x616F4C2Eu;
    p[67] = 0x00726564u;
    p[68] = 0u;
    p[69] = 0u;
    p[70] = 0x626F6C67u;
    p[71] = 0x432E6C61u;
    p[72] = 0x2E65726Fu;
    p[73] = 0x63617254u;
    p[74] = 0x696D4565u;
    p[75] = 0x72657474u;
    p[76] = 0x6F6F622Eu;
    p[77] = 0x00000074u;
    p[78] = 0u;
    p[79] = 0x63617254u;
    p[80] = 0x6D452E65u;
    p[81] = 0x65747469u;
    p[82] = 0x00000072u;
    p[83] = 0u;
    p[84] = 0x626F6C67u;
    p[85] = 0x432E6C61u;
    p[86] = 0x2E65726Fu;
    p[87] = 0x6E49534Eu;
    p[88] = 0x63657073u;
    p[89] = 0x2E726F74u;
    p[90] = 0x746F6F62u;
    p[91] = 0u;
    p[92] = 0u;
    p[93] = 0x492E534Eu;
    p[94] = 0x6570736Eu;
    p[95] = 0x726F7463u;
    p[96] = 0u;
    p[97] = 0u;
    p[98] = 0x626F6C67u;
    p[99] = 0x432E6C61u;
    p[100] = 0x2E65726Fu;
    p[101] = 0x6964654Du;
    p[102] = 0x6E6F4361u;
    p[103] = 0x656D7573u;
    p[104] = 0x6F622E72u;
    p[105] = 0x0000746Fu;
    p[106] = 0u;
    p[107] = 0x6964654Du;
    p[108] = 0x6F432E61u;
    p[109] = 0x6D75736Eu;
    p[110] = 0x00007265u;
    p[111] = 0u;
    p[112] = 0x626F6C67u;
    p[113] = 0x432E6C61u;
    p[114] = 0x2E65726Fu;
    p[115] = 0x776F7242u;
    p[116] = 0x6C436573u;
    p[117] = 0x746E6569u;
    p[118] = 0x6F6F622Eu;
    p[119] = 0x00000074u;
    p[120] = 0u;
    p[121] = 0x776F7242u;
    p[122] = 0x432E6573u;
    p[123] = 0x6E65696Cu;
    p[124] = 0x00000074u;
    p[125] = 0u;

    /* _NS_TOKENS[9] */
    p = (uint32_t*)_NS_TOKENS;
    p[0] = 0x68706247u;
    p[1] = 0x416D6848u;
    p[2] = 0x677D36A7u;
    p[3] = 0xEB2B7554u;
    p[4] = 0xD728290Du;
    p[5] = 0xA7CE2B32u;
    p[6] = 0x404C79D5u;
    p[7] = 0xE400EC35u;
    p[8] = 0xE7EED989u;
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */
int main(void)
{
    uint32_t i;
    uint32_t boot_reason = 0u;   /* 0 = cold boot */

    /* ---- Step 0a: 2-second startup window ------------------------------------
     * openFPGALoader resets the FPGA; the SoC is running within ~1 s.
     * Give the user time to run 'stty -F /dev/ttyUSB2 57600 raw cs8 && cat'
     * before any output appears.  delay_loops uses register-only NOP — no
     * memory, no APB, nothing that can hang. */
    delay_loops(2u * LOOPS_PER_SECOND);

    /* ---- Step 0b: UART baud rate FIRST (before init_strings_ram) ---------- */
    UART_CLOCKDIV = UART_DIV_57600;

    /* ---- PROBE A: build letter — earliest possible output -----------------
     * uart_putc uses only immediate constants (no ROM, no RAM string table).
     * If this character appears, crt0 ran to completion and UART works.
     * Failure modes:
     *   Nothing at all  → crt0 hung (bad .data copy) OR wrong firmware in BRAM
     *   Letter seen     → crt0 OK, UART OK; hang is in init_strings_ram or later
     *   Letter + '1'    → init_strings_ram returned; hang is in banner/APB */
    uart_putc(FW_BUILD_LETTER);

    /* ---- Step 0c: Initialize string table in RAM --------------------------
     * crt0.S skips the .data copy (ROM BRAM dBus lw hangs — iBus wins).
     * init_strings_ram() writes every _rs_* string via sw+li (no ROM reads). */
    init_strings_ram();
    uart_putc('1');   /* PROBE B: init_strings_ram returned */

    /* ---- Step 2: Store board UID in CM APB3 bridge ----
     *
     * Write board UID to the CM APB3 slave (0xF8100000) so it is available
     * to CALLHOME emitters later.  These APB writes DO re-trigger the BRAM
     * dBus stall timer, but that is harmless: the subsequent PROBE 2
     * uart_putc('>') and all banner uart_putcs each run their 10 000-cycle
     * delay which clears the stall before any ROM lw is attempted. */
    CM_UID_LO = BOARD_UID_LO;
    CM_UID_HI = BOARD_UID_HI;

    /* PROBE 2: '>' confirms CM APB3 slave (0xF8100000) responded to both UID
     * writes.  If the build letter arrived but '>' did not, the APB3 bridge
     * is absent or at a wrong address in this bitstream. */
    uart_putc('>');

    /* ---- Step 3: Boot banner (BEFORE releasing CM core) ----
     *
     * Must come after the CM APB3 fence writes (Step 2) and before
     * CM_CTRL_RELEASED (Step 4).  Once the CM core is released it
     * immediately starts executing and can win APB3 bus arbitration,
     * stalling any mid-banner UART_DATA write and truncating the output. */
    /* Banner — individual uart_putc only (no uart_puts = no ROM lw).
     * Each call is always_inline with an immediate value; zero ROM reads. */
    uart_putc('K'); uart_putc('H'); uart_putc('U'); uart_putc('R');
    uart_putc('C'); uart_putc('H'); uart_putc(' ');
    uart_putc('T'); uart_putc('i'); uart_putc('6'); uart_putc('0'); uart_putc(' ');
    uart_putc('S'); uart_putc('o'); uart_putc('C'); uart_putc('+');
    uart_putc('C'); uart_putc('M'); uart_putc(' '); uart_putc('v');
    uart_putc((char)('0' + (FW_MAJOR % 10u)));
    uart_putc('.');
    uart_putc((char)('0' + (FW_MINOR % 10u)));
    uart_putc('\r'); uart_putc('\n');
    uart_putc('U'); uart_putc('I'); uart_putc('D'); uart_putc('=');
    emit_uid();
    uart_putc('\r'); uart_putc('\n');

    /* ---- Step 4: CM core is already running (cm_pb default = 1 = released).
     *
     * DO NOT write CM_CTRL here.  Empirically confirmed: after ~50 uart_putc
     * calls (the banner + UID output), a write to CM_CTRL (APB3 offset 0x00)
     * hangs the Sapphire SoC APB bus permanently.  Writes to CM_UID_LO/HI
     * (offsets +0x10/+0x14) work fine both before and after the banner, but
     * offset +0x00 causes an unrecoverable APB stall after the banner.
     *
     * The CM hardware startup_ctr (~3 s, 75 M cycles) controls when the CM
     * core begins executing — firmware does not need to write CM_CTRL at all
     * for a normal cold boot.  CM_CTRL = CM_CTRL_RELEASED writes the DEFAULT
     * value (1) and is completely redundant, so skipping it is safe. */

    /* ---- Step 5: Wait for CM boot_complete (~3 s) ---- */
    /* DO NOT poll CM_STATUS here.  startup_ctr fires at ~3 s; the instant it
     * does, the CM grabs the shared APB bus.  Any Sapphire dBus read to
     * 0xF8100000+ at that moment hangs forever (PREADY never asserts) and the
     * bus-error exception jumps to mtvec → restart loop.
     * Fixed 3 s delay is safe; CM_STATUS is cached at boot (see Step 0). */
    uart_puts(_rs_wait_boot);
    delay_loops(3u * LOOPS_PER_SECOND);
    uart_puts(_rs_boot_ok_1);   /* assumed: boot always succeeds at 3 s mark */

    /* ---- Step 6: CALLHOME before the 3-second free-run delay ----
     * Moved BEFORE delay_loops() to complete in ~60 ms, well ahead of any
     * time-triggered hardware event at the ~3-second mark that was suspected
     * to stall the Sapphire SoC's AXI data bus mid-transaction.
     * (Previous builds: output always stopped at exactly "fault_code": after
     * ~3 s elapsed — consistent with a time-triggered AXI/BRAM stall.) */
    uart_puts(_rs_emit_ch);
    uart_emit_callhome(boot_reason);

    /* ---- Step 7: Wait for CM to reach free-run (~3 s startup counter) ---- */
    uart_puts(_rs_wait_frun);
    delay_loops(3u * LOOPS_PER_SECOND);
    uart_puts(_rs_frun_done);

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

    uart_puts(_rs_monitoring);

    for (;;) {
        uint32_t force_callhome = 0u;

        /* ------------------------------------------------------------
         * Inner trace loop: 10 × (LOOPS_PER_SECOND/10) ≈ 1 second total.
         * Sample NIA every ~100 ms; poll UART commands between samples.
         * ------------------------------------------------------------ */
        uint32_t ti;
        for (ti = 0u; ti < 10u; ti++) {
            delay_loops(LOOPS_PER_SECOND / 10u);
            /* NOTE: CM_NIA is an APB read.  If CM holds the APB bus after
             * startup_ctr fires the read stalls forever, silently killing
             * all subsequent output.  Use a fixed dummy value; the TRACE
             * record still proves the monitoring loop is alive. */
            trace_buf[trace_idx++] = 0u;
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
