/*
 * hardware/soc_combined/firmware/crt0.S
 *
 * Minimal _start for bare-metal RISC-V (RV32IM, ILP32 ABI).
 * Sets sp from the linker-symbol _stack_top, zeroes .bss,
 * then calls main().  Loops forever on return.
 *
 * IMPORTANT — .data copy is intentionally SKIPPED:
 *   The Sapphire SoC ROM BRAM is single-port.  iBus (instruction fetch) wins
 *   every cycle, so any dBus lw from ROM (0xF9000000–0xF9006FFF) stalls the
 *   CPU permanently — main() is never reached.
 *
 *   The canonical fix is to call init_strings_ram() as the very first
 *   statement in main().  That function writes every _rs_* string and
 *   _fault_names / _NS_MANIFEST / _NS_TOKENS table into RAM using sw+li
 *   immediate constants (zero ROM reads).  The VMA region (0xF9007000+) is
 *   zero-initialised by the BRAM symbol files, so .bss zeroing below is
 *   idempotent.  All static .data variables that need non-zero values must
 *   be covered by init_strings_ram().
 *
 *   Do NOT re-add the .data copy loop without first solving the single-port
 *   BRAM conflict (e.g. by running the copy from a RAM trampoline so iBus
 *   uses RAM while dBus reads ROM).
 */

    .section .text.startup
    .global _start
_start:
    /* Load stack pointer */
    la   sp, _stack_top

    /* Zero .bss  (sw to RAM — safe, no iBus conflict) */
    la   t0, _bss_start
    la   t1, _bss_end
1:  bge  t0, t1, 2f
    sw   zero, 0(t0)
    addi t0, t0, 4
    j    1b
2:
    /* .data copy SKIPPED — see file header comment above */

    call main

    /* main should never return; halt if it does */
halt:
    j    halt
