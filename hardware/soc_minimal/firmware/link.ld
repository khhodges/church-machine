/*
 * hardware/soc_minimal/firmware/link.ld
 *
 * Linker script for Sapphire SoC bare-metal firmware.
 *
 * Memory map (standard Efinix Sapphire SoC defaults):
 *   ROM  0x00000000  512 KB  (on-chip ROM, holds .text + .rodata)
 *   RAM  0x00080000  128 KB  (on-chip RAM, holds .data + .bss + stack)
 *
 * Confirm ROM_BASE and RAM_BASE against sapphire_define.vh on your machine.
 * If they differ, update the MEMORY section below before building.
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
