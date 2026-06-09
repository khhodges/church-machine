---
name: EFX_MAP $readmemb path resolution
description: Where Efinity EFX_MAP looks for $readmemb binary files when synthesising the Sapphire SoC BRAM — and the confirmed firmware update workflow.
---

## CRITICAL: $readmemb REQUIRES ABSOLUTE PATHS

EFX_MAP does NOT resolve `$readmemb` relative to `work_syn/` despite the log
saying "Synthesis flow working directory is .../work_syn". It also does NOT
resolve relative to the Verilog source file directory.

**Confirmed working fix: use ABSOLUTE PATHS in the `$readmemb` calls in sapphire.v.**

Tested and failed:
- Symbol files in `work_syn/` only → VERI-1012 cannot open file
- Symbol files in project root only → VERI-1012 cannot open file
- Symbol files in both locations → VERI-1012 cannot open file

Tested and worked:
- Patch `$readmemb("EfxSapphireSoc...symbol0.bin",...)` → `$readmemb("/home/sipantichijk/.../EfxSapphireSoc...symbol0.bin",...)` → synthesis passes, BRAM initialised with firmware ✓

## Firmware update workflow (Efinity GUI on Chromebook)

```bash
cd ~/church_project/SoC/church-machine/hardware/soc_minimal

# 1. Build firmware
TOOLCHAIN=~/efinity/efinity-riscv-ide-2025.2/toolchain/bin
make -C firmware TOOLCHAIN=$TOOLCHAIN
$TOOLCHAIN/riscv-none-embed-objcopy -O binary firmware/firmware.elf firmware/firmware.raw

# 2. Split into 4 symbol .bin files (put in project root)
python3 - <<'EOF'
raw = open('firmware/firmware.raw','rb').read()
raw += b'\x00' * (16384 - len(raw))
prefix = 'EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol'
for lane in range(4):
    with open(f'{prefix}{lane}.bin','w') as f:
        for i in range(4096):
            f.write(f'{raw[i*4+lane]:08b}\n')
    print(f'  Written: {prefix}{lane}.bin')
EOF
ls -la EfxSapphire*.bin   # confirm 4 files exist

# 3. Patch sapphire.v with absolute paths
cp sapphire.v.bak sapphire.v
PROJ='/home/sipantichijk/church_project/SoC/church-machine/hardware/soc_minimal'
for LANE in 0 1 2 3; do
  OLD="EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol${LANE}.bin"
  sed -i "s|\"${OLD}\"|\"${PROJ}/${OLD}\"|g" sapphire.v
done
grep readmemb sapphire.v   # must show 4 ABSOLUTE paths

# 4. Compile in Efinity GUI (just Compile — NOT Clean All)
# 5. Flash
sudo /usr/bin/openFPGALoader -b titanium_ti60_f225_jtag -f outflow/church_soc.hex
```

**Why:** EFX_MAP's actual CWD during $readmemb evaluation is unknown/unreachable
via relative paths. Absolute paths bypass the problem entirely. Confirmed working
end-to-end: board registers with IDE, fw_major=1 fw_minor=0, boot_count actively
incrementing, ~2996 callhome entries logged.

**Do NOT use Clean All** — unnecessary; symbol files are in the project root now.

## CRITICAL: Must use Efinity 2026.1, NOT 2025.2

The project XML has `sw_version="2026.1.132"`. Use the Efinity 2026.1 GUI.
The `efinity-riscv-ide-2025.2` toolchain is only for the RISC-V GCC compiler,
not for synthesis.

## Other confirmed facts

- UART port: ttyUSB2 = Sapphire SoC UART
- Bridge: `python3 hardware/soc_combined/callhome_bridge.py --port=/dev/ttyUSB2 --baud=115200 --ide=<URL> --insecure`
- Flash: `sudo /usr/bin/openFPGALoader -b titanium_ti60_f225_jtag -f outflow/church_soc.hex`
- Device UID in DB: `c0ffee0100000001`, board_type=3 (Ti60-Full), status=online
- UART write-valid: bit 8 of UART_DATA must be set: `UART_DATA = (1u<<8) | c`
- CLOCKDIV=53 must be written before first uart_puts (SoC resets it to 0x00)
