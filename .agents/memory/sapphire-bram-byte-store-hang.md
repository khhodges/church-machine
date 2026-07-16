---
name: Sapphire BRAM dBus hang — byte-store, lbu, uart_putc timing, and -O2 dead-call elimination
description: Four related dBus/compiler bugs on Efinix Ti60 Sapphire SoC; any sb, lbu lane 1/2/3, uart_putc before ROM lw, or -O2 killing init_strings_ram() call
---

## Rule
Four distinct bugs affect firmware correctness on the Efinix Ti60 Sapphire SoC:

### Bug A — lbu from non-zero byte lane
After any APB write, a subsequent `lbu` from ROM BRAM at byte lane 1, 2, or 3 stalls the dBus. Lane 0 works. GCC -O2 rewrites explicit `lw+shift+mask` to `lbu`, so `__attribute__((optimize("O0")))` is required on any function that reads string literals from ROM.

### Bug B — sb to stack (0xF9007xxx)
Any `sb` instruction to the BRAM data region (0xF9007000–0xF9007FFF) hangs the CPU permanently. Only `sw` (4-byte stores) and `lw` (4-byte loads) are safe. Fix: use `uint32_t` for all locals in functions compiled at -O0.

### Bug C — uart_putc stalls ROM dBus (TIMING — 4 340-cycle window)

**Every UART_DATA write (every `uart_putc` call) stalls ROM BRAM dBus reads until TX completes.**

At 57 600 baud / 25 MHz, one character transmits in **4 340 cycles (174 µs)**. The stall persists for the full TX duration — it is NOT cleared by APB writes (fence approach does not work). Any APB write after the UART_DATA write RESETS the stall timer, making things worse.

**Fix**: `uart_putc` waits **10 000 cycles** (400 µs > 174 µs) using a register-only asm loop before returning. No fence writes anywhere. After `uart_putc` returns, 10 000 cycles have elapsed since the UART write — the stall is guaranteed clear. Subsequent ROM `lw` is safe.

```c
static inline __attribute__((always_inline)) void uart_putc(uint32_t c)
{
    UART_DATA = (1u << 8) | (c & 0xFFu);
    uint32_t _d = 10000u;   /* 400 µs — stall guaranteed clear on return */
    __asm__ volatile("1: addi %0,%0,-1\n bne %0,zero,1b\n" : "+r"(_d));
}
```

**Why the fence approach failed**: CM APB3 writes (0xF8100010, 0xF8100014) also reset the stall timer. After the last fence write, the stall timer resets and the immediately-following ROM `lw` hangs. Fence pattern is a dead end.

**Why the original CLOCKDIV stall was cleared by fence**: CLOCKDIV write stalls BRAM, but the fence ran while BRAM access was not needed (uart_putc is peripheral-only). The fence "worked" only because uart_putc doesn't need ROM — not because the fence cleared anything for a subsequent lw.

## uart_puts implementation (Bug C fix)
```c
static void __attribute__((optimize("O0"))) uart_puts(const char *s)
{
    /* No APB writes — any write resets stall timer */
    uint32_t align = (uintptr_t)s & 3u;
    const uint32_t *wp = (const uint32_t *)((uintptr_t)s - align);
    uint32_t w = *wp++;           /* ROM lw — safe: caller's uart_putc waited 10k cycles */
    uint32_t remaining = 4u - align;
    w >>= (align << 3);
    for (;;) {
        uint32_t c = w & 0xFFu;
        if (c == 0u) return;
        uart_putc(c);             /* 10k-cycle delay inside — stall clears */
        w >>= 8;
        if (--remaining == 0u) {
            w = *wp++;            /* ROM lw — safe after uart_putc's delay */
            remaining = 4u;
        }
    }
}
```

## Confirmed hang-triggering patterns
- `uart_putc()` immediately followed by `uart_puts()` with only fence writes in between → hangs (fence resets timer)
- `uart_putc()` + 3 000-cycle delay + `uart_puts()` → hangs (3 000 < 4 340 cycles)
- `uart_putc()` + 10 000-cycle delay + `uart_puts()` → works (10 000 > 4 340 cycles)
- `char buf[N]` local array → GCC emits `sb` → hangs (Bug B, independent)
- `sb` to any 0xF9007xxx address → hangs (Bug B)

### Bug D — GCC -O2 dead-call elimination of init_strings_ram()
`init_strings_ram()` writes the same byte values as the `.data` initializers (it is the workaround for crt0's failed ROM dBus copy). At `-O2`, GCC performs intra-TU IPA on this `static` function and determines the call is a no-op (writes identical to already-initialized values), then **eliminates the call entirely**. Result: `.data` stays all-zeros, `uart_puts` sees `\0` on first byte, returns instantly, nothing printed.

**Fix: compile firmware at `-O0`** (Makefile `CFLAGS` flag). `-O0` disables IPA dead-call elimination and constant propagation. The `__attribute__((optimize("O0")))` on individual functions is NOT sufficient — the CALLER (main) at `-O2` removes the call site before entering the callee.

```makefile
CFLAGS := -march=rv32im -mabi=ilp32 -O0 -nostdlib -ffreestanding ...
```

## How to apply
- `uart_putc`: always use 10 000-cycle register-only asm delay (never 3 000)
- `uart_puts`: NO fence writes, NO APB writes of any kind
- Between `uart_putc` and next ROM-reading function: NO APB writes
- `uart_puthex32_lower`: arithmetic only, no ROM reads — safe after uart_putc
- All `sb` patterns → still must be avoided (Bug B independent of Bug C)
- **Firmware Makefile must use `-O0`** — `-O2` silently kills init_strings_ram()
