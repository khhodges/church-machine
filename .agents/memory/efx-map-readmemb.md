---
name: EFX_MAP $readmemb path resolution
description: Where Efinity EFX_MAP looks for $readmemb binary files, BRAM init bug (defparam vs verific comment), and the full patch workflow.
---

## CRITICAL: $readmemb BRAM init lands in defparam — efx_pnr ignores it

EFX_MAP 2026.1 bug (confirmed on command-line flow):
- `$readmemb` with ABSOLUTE PATHS: synthesis passes, no VERI error, INIT values
  computed correctly and stored in `defparam \u_cm/dmem_bX__<INST> .INIT_N = 256'h...`
- BUT efx_pnr reads BRAM init from `/* verific ... INIT_N=256'h... */` inline
  attribute comments, NOT from defparam.
- $readmemb-initialised instances get NO INIT_N attrs in their verific comment.
- Zero-init instances DO get `INIT_N=256'h0...0` attrs in their verific comment.
- Result: BRAM stays zero in the bitstream despite correct defparam values.

**Evidence:** D$02 (bit-0 instance, addr 0-1023) has defparam INIT_0=non-zero
but verific comment has 0 INIT attrs. FAULT_INSTR=0x00000000 at runtime confirms
BRAM is zero even after synthesis+P&R with $readmemb absolute paths.

**Confirmed:** fault code changes from NULL_CAP → PERM_L when $readmemb files
are found (partial initialization of NS table), so EFX_MAP DOES read the files —
it just puts the result in the wrong place.

## EFX_RAM10 instance structure for dmem byte lanes

The 4 byte-lane arrays (`reg [7:0] dmem_b0..3 [0:16383]`) are synthesized as
8 separate 1-bit-wide EFX_RAM10 instances per address bank:
- READ_WIDTH=1, WRITE_WIDTH=1
- Each instance covers 1024 addresses × 1 bit
- INIT_0..INIT_3 (4×256 = 1024 bits) cover all 1024 addresses for that bit-plane
- Instance suffix D$02, D$32, D$3f12, etc. are synthesis hash IDs, NOT address offsets

D$02 INIT_0 bit encoding confirmed correct:
  0x66 = 0b01100110 = bit-0 of dmem[7..0] at addresses 0-7 ✓

## FIX: patch_cm_map.py (post-synthesis map.v patcher)

Script: `hardware/soc_combined/patch_cm_map.py`

```bash
# On Chromebook — run AFTER synthesis, BEFORE P&R
cd ~/church_project/SoC/church-machine && git pull
python3 hardware/soc_combined/patch_cm_map.py \
    ~/church_project/SoC/outflow/church_soc_cm.map.v
# Then re-run only P&R (no re-synthesis):
cd ~/church_project/SoC && bash work_pnr/run_efx_pnr.sh
```

The script:
1. Collects defparam INIT_N values for all dmem_b? EFX_RAM10 instances
2. Finds instances with non-zero INIT (those initialised by $readmemb)
3. Copies those INIT values into the `/* verific */` comment on the instance line
   (Case A: existing INIT attrs → update zeros; Case B: verific comment, no INIT →
   insert before */; Case C: no comment → add full comment before ;)

## $readmemb path rules

EFX_MAP does NOT resolve bare filenames for $readmemb.
Only ABSOLUTE PATHS work:
```verilog
initial $readmemb("/home/sipantichijk/.../cm_dmem_b0.bin", dmem_b0);
```

Tested and failed (VERI-1012):
- Bare filename regardless of where file is placed

Tested: synthesis passes but BRAM zero in bitstream (see bug above):
- Absolute path `$readmemb` → correct defparam INIT but not in verific comment

## CRITICAL: $readmemb requires absolute paths — generates byte-lane binary files

`patch_cm_bram.py` in `hardware/soc_combined/` splits dmem into 4 byte-lane
binary files and patches church_ti60_f225.v with absolute-path $readmemb calls.

Run on Chromebook before every synthesis:
```bash
python3 ~/church_project/SoC/church-machine/hardware/soc_combined/patch_cm_bram.py \
        ~/church_project/SoC/church-machine/hardware/soc_combined
```

## CRITICAL: EFX_MAP also ignores `initial begin` blocks entirely

The `initial begin` block in church_ti60_f225.v is silently discarded.
→ BRAM comes up all-zeros → CM reads 0x00000000 → NIA stuck at 0x00000000
→ Sapphire fires HUNG watchdog every 3 s with nia=0x00000000.

**Symptom of unpacked BRAM (NIA=0x0):**
  `CALLHOME: nia=0x00000000, boot_ok=0, fault=0`
  `HUNG: {"nia":"0x00000000","loops":3}`
  NO FAULT_EVENT

**Symptom of correct boot namespace loaded (NIA=0x4):**
  `FAULT_EVENT: fault_name='PERM_S', nia=0x00000004` — real boot fault to diagnose.

## Firmware update workflow (Efinity GUI on Chromebook)

```bash
cd ~/church_project/SoC/church-machine/hardware/soc_minimal

TOOLCHAIN=~/efinity/efinity-riscv-ide-2025.2/toolchain/bin
make -C firmware TOOLCHAIN=$TOOLCHAIN
$TOOLCHAIN/riscv-none-embed-objcopy -O binary firmware/firmware.elf firmware/firmware.raw

python3 - <<'EOF'
raw = open('firmware/firmware.raw','rb').read()
raw += b'\x00' * (16384 - len(raw))
prefix = 'EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol'
for lane in range(4):
    with open(f'{prefix}{lane}.bin','w') as f:
        for i in range(4096):
            f.write(f'{raw[i*4+lane]:08b}\n')
EOF

cp sapphire.v.bak sapphire.v
PROJ='/home/sipantichijk/church_project/SoC/church-machine/hardware/soc_minimal'
for LANE in 0 1 2 3; do
  OLD="EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol${LANE}.bin"
  sed -i "s|\"${OLD}\"|\"${PROJ}/${OLD}\"|g" sapphire.v
done
```

## Other confirmed facts

- UART port: ttyUSB2 = Sapphire SoC UART (baud 57600)
- Bridge: `python3 hardware/soc_combined/callhome_bridge.py --port=/dev/ttyUSB2 --ide=<URL> --insecure`
- Flash: `sudo /usr/bin/openFPGALoader -b titanium_ti60_f225_jtag -f outflow/church_soc.hex`
- Device UID: c0ffee0100000001, board_type=3 (Ti60-Full)
- UART write-valid: bit 8 of UART_DATA must be set; CLOCKDIV=53 before first puts
- Must use Efinity 2026.1 GUI (not 2025.2) for synthesis
