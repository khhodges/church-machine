---
name: Ti60 headless build — IO placement and LPF
description: Complete working headless build flow for Ti60F225 on Chromebook Penguin; IO pin placement pitfalls; Patch4 must call not bypass check_design
---

# Ti60F225 Headless Build — IO Placement and LPF

## IO pins randomly placed root cause
All IO cells show "no assigned placement; will be placed randomly" when:
1. peri.xml is missing the `clk` GPIO entry (`gpio_def="GPIOL_P_18"`) — peri.xml starts with only 7 GPIOs, `clk` must be added before the `cm_uart_tx` entry
2. Python heredoc writes (`python3 - <<'EOF'`) silently fail to write the file on this Penguin setup — use `cat > /tmp/fix.py << 'EOF'` then `python3 /tmp/fix.py` instead
3. Patch 4 bypasses `check_design()` entirely — IO config state never populated, LPF has `comp_gpio` copied from peri.xml but no HSIO instance configurations

## Correct Patch 4 (design.py)
Do NOT use `if True:` — call `check_design()` but ignore its return:
```python
try:
    self.check_design()  # populate IO config state
except Exception:
    print("WARNING: check_design raised (headless patch)")
if True:  # always generate constraint
    try:
        self.__gen_report(outdir)
    except Exception:
        print("WARNING: report generation skipped (headless patch)")
    self.__gen_constraint(enable_bitstream, outdir)
```

## Complete 4-step headless build flow (SoC_minimal project)

```
# Step 1 — write BRAM symbol files from firmware BEFORE synthesis
python3 -c "fw=open('firmware.bin','rb').read();fw+=b'\x00'*(8192*4-len(fw));base='work_syn/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol';[open(base+str(l)+'.bin','wb').write(bytes(fw[i*4+l] for i in range(8192))) for l in range(4)]"

# Step 2 — synthesis (reads symbol files for BRAM init; initial begin blocks are IGNORED)
rm -f work_syn/top.vdb outflow/church_soc.vdb
sed -i '/infer_set_reset\|infer_clk_enable/d' church_soc.xml
python3 ~/efinity/2026.1/scripts/efx_run.py --prj church_soc.xml -f map

# Step 3 — place and route
~/efinity/2026.1/bin/efx_pnr --prj church_soc.xml --circuit church_soc \
  --family Titanium --device Ti60F225 --operating_conditions C3 \
  --pack --place --route \
  --vdb_file outflow/church_soc.vdb --sync_file outflow/church_soc.interface.csv \
  --work_dir work_pnr --output_dir outflow

# Step 4 — bitstream generation (REQUIRED — efx_pnr does NOT write the hex/bit files)
python3 ~/efinity/2026.1/scripts/efx_run.py --prj church_soc.xml -f pgm
```

**Why:** `efx_pnr` only does pack/place/route — it does NOT generate the `.hex`/`.bit` files. A separate `efx_run.py -f pgm` step is mandatory. Without it, `openFPGALoader` silently flashes the old bitstream. This caused persistent FW=1.3 even after correct synthesis.

## Symbol file rule
Synthesis READS `work_syn/EfxSapphireSoc.v_..._symbol{0-3}.bin` as BRAM init input. The `initial begin` blocks in `sapphire.v` are **ignored by synthesis** — they are simulation-only. Always pre-write symbol files from `firmware.bin` before running `efx_map`. If files are absent, BRAM is zero-initialized.

## Checking a specific byte (not just byte 0)
`match=True` on sym[0]==fw[0] is misleading — byte 0 is the same in all firmware versions (RISC-V AUIPC opcode). Always check a version-specific byte, e.g. the '2' vs '3' at `fw.find(b'v2.0')+1`.

## Use efx_run wrappers, not bare efx_pnr/efx_pgm (for other projects)
- `efx_run church_soc_cm --prj --flow pnr --family Titanium --device Ti60F225` (NOT bare efx_pnr)
- `efx_run church_soc_cm --prj --flow pgm --family Titanium --device Ti60F225` (NOT efx_pgm --source)

The bare tools need extra flags and don't automatically apply the LPF for IO placement.

## Confirming IO placement worked
After PnR: `grep -c "random placement" work_pnr/pnr.log` should return 0.
If still random: check peri.xml has all 8 GPIOs (clk included), re-run Interface Designer.

## clk not in LPF grep
`grep -c "GPIOL_P_18" outflow/church_soc_cm.lpf` returns 0 — the LPF uses HSIO instance IDs (GPIOL_PN_18), not the peri.xml resource name. The clk IS constrained; grep for "clk" or line count instead.

## UART device mapping on Penguin (FT4232H)
`/dev/ttyUSB2` does not exist — USB devices enumerated as ttyUSB0, ttyUSB1, ttyUSB3, ttyUSB4.
SoC UART (FT4232H interface B) is likely ttyUSB1 or ttyUSB3 at 57600 baud.

**Why:** Efinix 2026.1 headless IO placement requires check_design() side effects. The `if True:` Patch4 shortcut produces a structurally incomplete LPF.
