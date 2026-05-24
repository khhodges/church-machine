/*
 * hardware/soc_minimal/firmware/crt0.S
 *
 * Minimal _start for bare-metal RISC-V (RV32IM, ILP32 ABI).
 * Sets sp from the linker-symbol _stack_top, zeroes .bss, copies .data,
 * then calls main().  Loops forever on return.
 */

    .section .text.startup
    .global _start
_start:
    /* Load stack pointer */
    la   sp, _stack_top

    /* Zero .bss */
    la   t0, _bss_start
    la   t1, _bss_end
1:  bge  t0, t1, 2f
    sw   zero, 0(t0)
    addi t0, t0, 4
    j    1b
2:
    /* Copy .data from ROM load address to RAM */
    la   t0, _data_load
    la   t1, _data_start
    la   t2, _data_end
3:  bge  t1, t2, 4f
    lw   t3, 0(t0)
    sw   t3, 0(t1)
    addi t0, t0, 4
    addi t1, t1, 4
    j    3b
4:
    call main

    /* main should never return; halt if it does */
halt:
    j    halt
