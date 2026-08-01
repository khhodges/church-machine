## Flash church_wukong_xc7a100t.mcs to the on-board W25Q256JVSIQ SPI NOR flash
## ============================================================================
## Usage (Vivado batch mode — run from the directory containing the .mcs file):
##
##   vivado -mode batch -source flash_spi_wukong.tcl
##
## Prerequisites:
##   • Wukong board powered and connected via JTAG (Platform Cable USB II or similar)
##   • church_wukong_xc7a100t.mcs  in the same directory (or set MCS_FILE below)
##   • Vivado 2020.x or later (WebPACK is fine for flash programming)
##
## What this does:
##   1. Opens Vivado Hardware Manager and connects to the JTAG target
##   2. Creates a cfgmem object for the W25Q256JVSIQ (256 Mb SPI NOR)
##   3. Erases, programs, and verifies the flash with the Church Machine image
##   4. Issues boot_hw_device so the FPGA loads from flash immediately
##
## After programming:
##   • Press the RESET button on the Wukong board (or power-cycle) at any time
##   • The Church Machine boots automatically — no JTAG programmer needed
##   • Expected: D1 blinks ~1 Hz (running), D2 off (no fault)
##   • UART E3 @ 57600 baud emits 0xBB sentinel within ~1 s of power-on
## ============================================================================

## ── Locate the MCS file ──────────────────────────────────────────────────────
set MCS_FILE "[pwd]/church_wukong_xc7a100t.mcs"
if {![file exists $MCS_FILE]} {
    error "MCS not found: $MCS_FILE\nRun the build first: vivado -mode batch -source wukong_xc7a100t.tcl"
}
puts "Using MCS: $MCS_FILE  ([expr {[file size $MCS_FILE] / 1048576}] MB)"

## ── Open Hardware Manager ────────────────────────────────────────────────────
puts "\n═══ Opening Hardware Manager ═══"
open_hw_manager
connect_hw_server -allow_non_jtag
open_hw_target

## ── Identify FPGA device ────────────────────────────────────────────────────
set devices [get_hw_devices]
if {[llength $devices] == 0} {
    error "No JTAG devices found.  Check cable, power, and driver."
}
set device [lindex $devices 0]
puts "Target device: $device"
refresh_hw_device -update_hw_probes false $device

## ── Create cfgmem object for W25Q256JVSIQ ───────────────────────────────────
puts "\n═══ Setting up SPI flash (W25Q256JVSIQ — 256 Mb) ═══"
set flash_parts [get_cfgmem_parts {w25q256jvsiq-spi-x1_x2_x4}]
if {[llength $flash_parts] == 0} {
    error "Flash part 'w25q256jvsiq-spi-x1_x2_x4' not found in Vivado database.\nRun: get_cfgmem_parts *w25q256* to list available parts."
}
create_hw_cfgmem -hw_device $device [lindex $flash_parts 0]
set cfgmem [get_property PROGRAM.HW_CFGMEM $device]

## ── Configure flash programming properties ──────────────────────────────────
set_property PROGRAM.FILES        [list $MCS_FILE] $cfgmem
set_property PROGRAM.BLANK_CHECK  0                $cfgmem
set_property PROGRAM.ERASE        1                $cfgmem
set_property PROGRAM.CFG_PROGRAM  1                $cfgmem
set_property PROGRAM.VERIFY       1                $cfgmem

## ── Program the flash ────────────────────────────────────────────────────────
puts "\n═══ Programming SPI flash (erase + program + verify — may take 3–8 min) ═══"
program_hw_cfgmem $cfgmem

## ── Boot from flash immediately ─────────────────────────────────────────────
puts "\n═══ Booting from SPI flash ═══"
boot_hw_device $device

puts ""
puts "═══════════════════════════════════════════════════════════════════"
puts " SPI flash programming COMPLETE."
puts " The Church Machine is now stored in on-board SPI NOR flash."
puts ""
puts " VERIFICATION:"
puts "   1. Disconnect the JTAG cable"
puts "   2. Power-cycle (or press RESET) the Wukong board"
puts "   3. UART E3 @ 57600 baud should emit 0xBB within ~1 s"
puts "   4. D1 (G21): blinks ~1 Hz (CM running)"
puts "      D2 (G20): off (no fault latched)"
puts "═══════════════════════════════════════════════════════════════════"
