/*
 * hardware/soc_combined/firmware/link.ld
 *
 * Linker script for the combined Sapphire SoC + Church Machine firmware.
 *
 * Memory map (standard Efinix Sapphire SoC defaults):
 *   ROM  0x00000000  512 KB  (on-chip ROM, holds .text + .rodata)
 *   RAM  0x00080000  128 KB  (on-chip RAM, holds .data + .bss + stack)
 *
 * Verify ROM_BASE and RAM_BASE against sapphire_define.vh before building.
 * The APB3 bridge for the CM sits at 0xF0040000 (APB_APB_SLAVE_0_BASE) —
 * this is a peripheral register address, not in the memory map here.
 */

MEMORY
{
    ROM (rx)  : ORIGIN = 0x00000000, LENGTH = 512K
    RAM (rwx) : ORIGIN = 0x00080000, LENGTH = 128K
}

ENTRY(_start)

SECTIONS
{
    .text : {
        *(.text.startup)
        *(.text*)
        *(.rodata*)
        . = ALIGN(4);
    } > ROM

    .data : {
        _data_start = .;
        *(.data*)
        . = ALIGN(4);
        _data_end = .;
    } > RAM AT > ROM

    _data_load = LOADADDR(.data);

    .bss : {
        _bss_start = .;
        *(.bss*)
        *(COMMON)
        . = ALIGN(4);
        _bss_end = .;
    } > RAM

    _stack_top = ORIGIN(RAM) + LENGTH(RAM);
}
