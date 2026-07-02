---
name: Ti60 one-button build
description: Single command that does everything correctly — git pull, firmware, MAP, PNR, PGM, serve hex
---

## The command

```bash
bash ~/church-machine/hardware/soc_combined/run_full_build.sh
```

Run this from the droplet (165.227.190.84). Takes ~75 min. Ends with the hex being served on port 8888.

**Why:** Every individual step has a silent failure mode. The only reliable approach is one script that bakes in all patches in the correct order with all env vars set.

## What the script does (in order)

1. `git pull` — always start from latest code
2. `make -C firmware clean all` — **clean, not just make** (git pull leaves equal timestamps; plain `make` skips rebuild and firmware stays at the old version)
3. `run_efx_map.sh` — strips banned XML params; Step 0b self-tests the CM DMEM patch (see `obbs-single-patch-location.md` — the actual patch runs earlier, in `build_ti60_bitstream.sh` Step 2.5 via `gen_cm_dmem_direct.py`, not here)
4. `run_efx_pnr.sh` — calls `gen_sapphire_symbol_bins.py` + `patch_mapv_init.py` before PNR (Sapphire BRAM firmware injection)
5. `run_efx_pgm.sh` — all Efinity env vars pre-exported (EFINITY_USER_DIR_INI, EFXPT_HOME, EFXPGM_HOME)
6. Kills any old http.server on 8888, starts fresh one serving outflow/

## Silent failure modes that burned us (never repeat these)

| Skipped step | Symptom |
|---|---|
| `patch_cm_bram.py` before MAP | CM DMEM all zeros → NULL_CAP fault at NIA=0 |
| `make clean` before firmware build | Old v2.3 firmware in bitstream even after git pull |
| `gen_sapphire_symbol_bins.py` before PNR | Sapphire BRAM all zeros → UART completely silent |
| `patch_mapv_init.py` before PNR | Same as above |
| `EFINITY_USER_DIR_INI` export | PGM aborts with bare KeyError on Step 1 |
| `EFXPGM_HOME` export | PGM aborts with bare KeyError on Step 2 |

## After the build

```bash
# On local machine — download and flash:
curl -O http://165.227.190.84:8888/church_soc_cm.hex
sudo openFPGALoader -b titanium_ti60_f225_jtag --external-flash -f church_soc_cm.hex

# Listen BEFORE power-cycling (banner is one-shot):
stty -F /dev/ttyUSB2 57600 raw && cat /dev/ttyUSB2
```

## Partial rebuild (MAP already done — skip 45 min)

If only firmware or Verilog changed but the MAP output (map.v) is still valid:

```bash
cd /root/church-machine && git pull
bash hardware/soc_combined/run_efx_pnr.sh   # firmware clean all + PNR
EFINITY_USER_DIR_INI=$HOME/.efinity EFXPT_HOME=$HOME/efinity/2026.1 \
  EFXPGM_HOME=$HOME/efinity/2026.1 \
  bash hardware/soc_combined/run_efx_pgm.sh
```
