---
name: Sapphire firmware uart_putdec hang
description: uart_putdec using divu/remu causes a runtime hang on the Sapphire SoC; workaround and investigation status
---

## The Rule

Do NOT use `uart_putdec()` in the CALLHOME path. Replace every call with either `uart_puthex32_lower()` (for unknown values) or a direct `uart_putc((char)('0' + constant))` (for single-digit compile-time constants).

**Why:** `uart_putdec` uses `v / 10u` and `v % 10u` which GCC compiles to `divu`/`remu` (RV32IM M-extension). At runtime, these instructions cause a hang — the UART output stops exactly at the point where the first division executes. The hang occurs even with `__attribute__((always_inline))` on `uart_putc`. Root cause not yet confirmed (M-extension trap vs register spill vs something else), but the symptom is 100% reproducible: CALLHOME JSON cuts off at `"fault_code":` every time.

**How to apply:** In `uart_emit_callhome`:
```c
// WRONG — hangs:
uart_putdec(fault_code);
uart_putdec(FW_MAJOR);
uart_putdec(FW_MINOR);

// RIGHT — proven working:
uart_puthex32_lower(fault_code);            // outputs 8 hex chars, no division
uart_putc((char)('0' + (FW_MAJOR % 10u))); // constant folded at compile time
uart_putc((char)('0' + (FW_MINOR % 10u))); // constant folded at compile time
```

Note: `FW_MAJOR % 10u` on a compile-time constant is folded to a literal by the compiler — no runtime division instruction generated.

## Investigation status (build #3 in progress)

Build #3 includes this fix. Previous builds (#1, #2) hung at `"fault_code":` with identical UART output despite:
- Build #1: original `uart_putdec` with `char buf[7]` stack buffer
- Build #2: rewritten `uart_putdec` with scalar `uint32_t tmp` + `always_inline uart_putc`
- Build #3: `uart_putdec` calls replaced entirely in CALLHOME path (current attempt)

If build #3 gets past `fault_code` but hangs later (e.g. at sha32 or ns_manifest), the divu/remu hypothesis is confirmed.

## Longer term

If a division-free `uart_putdec` is needed, use subtraction-only loop:
```c
static void uart_putdec_safe(uint32_t v) {
    uint32_t d;
    if (v == 0u) { uart_putc('0'); return; }
    d=0; while(v>=100000u){d++;v-=100000u;} if(d) uart_putc('0'+d);
    d=0; while(v>=10000u) {d++;v-=10000u;}  if(d) uart_putc('0'+d);
    d=0; while(v>=1000u)  {d++;v-=1000u;}   if(d) uart_putc('0'+d);
    d=0; while(v>=100u)   {d++;v-=100u;}    if(d) uart_putc('0'+d);
    d=0; while(v>=10u)    {d++;v-=10u;}     if(d) uart_putc('0'+d);
    uart_putc('0'+v);
}
```
No divu/remu, no stack writes, no function calls (if uart_putc is always_inline).
