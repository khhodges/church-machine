---
name: OBBS top.v / apb3_cm_bridge.v not deployed
description: build_ti60_bitstream.sh was not copying top.v or apb3_cm_bridge.v to $SOC_DIR before synthesis, so stale server copies were silently used.
---

## Rule

`scripts/build_ti60_bitstream.sh` must explicitly `cp hardware/soc_combined/top.v $SOC_DIR/` and `cp hardware/soc_combined/apb3_cm_bridge.v $SOC_DIR/` before synthesis runs. Neither file is deployed by any other step.

**Why:** Efinity synthesizes whatever Verilog source files are already in `~/church_project/SoC/`. If a stale `top.v` has `jtagCtrl_reset(1'b0)`, the VexRiscv debug clock domain stays in permanent reset → `io_systemReset` stuck HIGH → `system_reset` HIGH → `assign led0 = ~system_reset` → LED0 OFF, firmware never runs, UART completely silent. Board shows: green FPGA-configured indicator ON, all 3 user LEDs OFF.

**How to apply:** The fix is now in the OBBS (lines ~271-302): cp + jtagCtrl_reset grep guard that `_fail`s the build if the deployed copy is wrong. If a future board is silent after flash, check: (1) all 3 user LEDs OFF with green configured LED ON → stale top.v; (2) LED0 ON but UART silent → firmware BRAM empty.

## Diagnostic shortcut

| LED pattern after flash | Meaning |
|:------------------------|:--------|
| Green ON, all 3 user LEDs OFF | `system_reset` stuck HIGH → stale top.v (jtagCtrl_reset=0) or POR broken |
| Green ON, LED0 ON, LED1+2 OFF | SoC booted, CM not booted yet (firmware running) |
| Green ON, LED0+1 ON | CM boot complete |

## Fast recovery (no full rebuild needed)

If the bitstream has stale top.v, copy the corrected files and re-run only MAP+PNR+PGM (~10 min) instead of the full 75-min OBBS:

```bash
cd ~/church-machine
git fetch origin && git reset --hard origin/main
cp hardware/soc_combined/top.v ~/church_project/SoC/
cp hardware/soc_combined/apb3_cm_bridge.v ~/church_project/SoC/
export _OBBS_RUN=1
EFINITY_HOME=~/efinity/2026.1 bash hardware/soc_combined/run_efx_map.sh ~/church_project/SoC/church_soc_cm.xml 2>&1 | tail -20
bash hardware/soc_combined/run_efx_pnr.sh ~/church_project/SoC/church_soc_cm.xml 2>&1 | tail -30
bash hardware/soc_combined/run_efx_pgm.sh ~/church_project/SoC/church_soc_cm.xml 2>&1 | tail -10
cp ~/church_project/SoC/outflow/church_soc_cm.hex ~/church-machine/bitstreams/church_ti60_f225.hex
```
