---
name: Chromebook call-home bridge workflow
description: Confirmed working flow for firmware→BRAM→Efinity→flash→bridge on the Penguin Chromebook Linux container
---

# Chromebook Call-Home Bridge Workflow

## Confirmed working bridge command
```bash
python3 hardware/soc_combined/callhome_bridge.py \
    --port=/dev/ttyUSB2 \
    --ide=https://lab.cloomc.org \
    --insecure
```

**Production IDE URL is https://lab.cloomc.org** (old dev URL was the long replit.dev string — no longer valid).

## LED flash LUMP test convenience script (Task #1870)

```bash
./hardware/soc_combined/test_led_flash.sh
```

This auto-detects ports, adds `--insecure`, and runs `--upload` mode.
Pre-requisite: generate boot-image.bin first via IDE Builder → Step 1 → Generate.

**Why no --baud:** The bridge defaults to 57600 (hardcoded `_BAUD = 57600`). Do NOT pass `--baud=115200` — the soc_combined firmware uses CLOCKDIV=53 → 57,870 ≈ 57,600 baud at 25 MHz. Connecting at 115200 produces garbage or silence.

**Why --insecure:** The Chromebook Linux container (Debian) does not have Replit's SSL CA in its trust store.

**Baud rate table:**
- ttyUSB2 (SoC UART / callhome_bridge): **57,600 baud** — CLOCKDIV=53, 25 MHz / (8×54) = 57,870 baud
- ttyUSB3 (CM debug UART / PATCH_LUMP --upload): **115,200 baud** — separate CM debug port

## PATCH_LUMP upload (via callhome_bridge --upload flag)

`upload_boot.py` does NOT exist as a standalone script. Use `--upload` on the bridge:

```bash
python3 hardware/soc_combined/callhome_bridge.py \
    --port=/dev/ttyUSB2 \
    --ide=https://31592a69-0a64-402e-9237-89b7ce66a127-00-1hr1bt2ealopt.kirk.replit.dev \
    --insecure --upload
```

CM debug UART (PATCH_LUMP) is on **ttyUSB3 at 115,200 baud** (bridge `--upload-port` default).
After ACK: hold push button ~1 s → CM reboots with patched BRAM. Volatile — wiped on power cycle.

## GitHub auto-sync delay gotcha (CRITICAL — caused one wasted synthesis cycle)

Replit auto-syncs to GitHub every 30 minutes. If a firmware change was just committed on Replit, `git pull` on the Chromebook may pull a commit that is **missing the change**. The Chromebook will silently compile the old firmware.

**Always verify NUC_CODE after `git pull`:**
```bash
grep "NUC_CODE_START\|NUC_CODE_END\|FW_MINOR\|FIRMWARE v" firmware/main.c
```
Expected (v2.2, new BRAM layout): `NUC_CODE_START=0x00000000u`, `NUC_CODE_END=0x00000044u`, `FW_MINOR=2u`.

If the pull is stale, patch directly on the Chromebook:
```bash
sed -i 's/#define NUC_CODE_START   0x00000160u/#define NUC_CODE_START   0x00000000u/' firmware/main.c
sed -i 's/#define NUC_CODE_END     0x000001B0u/#define NUC_CODE_END     0x00000044u/' firmware/main.c
sed -i 's/#define FW_MINOR  0u/#define FW_MINOR  2u/' firmware/main.c
sed -i 's/FIRMWARE v2\.1/FIRMWARE v2.2/' firmware/main.c
grep "NUC_CODE\|FW_MINOR\|FIRMWARE v2" firmware/main.c  # verify all four
```

## Firmware → flash sequence (scripted CLI, strict order)

These steps must run in this exact order. Any step out of order silently bakes old code into BRAM.

```bash
XML="$HOME/church_project/SoC/church-machine/hardware/soc_combined/church_soc_cm.xml"
cd ~/church_project/SoC/church-machine/hardware/soc_combined

# 1. git pull — verify NUC_CODE is correct BEFORE make firmware (see gotcha above)
git pull

# 2. Verify firmware constants
grep "NUC_CODE_START\|NUC_CODE_END\|FW_MINOR" firmware/main.c

# 3. Compile firmware
make firmware

# 4. Patch BRAM init into sapphire.v
python3 ../../scripts/patch_sapphire_init.py sapphire.v \
    EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol*.bin

# 5. Synthesize + PNR + PGM (runs unattended, ~45-60 min total)
bash run_efx_map.sh "$XML" 2>&1 | tee /tmp/map.log && \
bash run_efx_pnr.sh "$XML" 2>&1 | tee /tmp/pnr.log && \
bash run_efx_pgm.sh "$XML" 2>&1 | tee /tmp/pgm.log

# 6. Flash
sudo openFPGALoader -b titanium_ti60_f225_jtag -f outflow/church_soc_cm.hex
```

**IMPORTANT — always pass `"$XML"` explicitly to run_efx_map.sh.** Without it the script may fall back to the stale `SoC_minimal/church_soc.xml` default (depends on which version is on Chromebook).

**map.v location:** Efinity (2026.x) writes `church_soc_cm.map.v` to `outflow/` not `work_syn/`. The `work_syn/` directory only holds `synthesis.log` and cached symbol bins from previous runs.

**Verify BRAM after synthesis:**
```bash
grep -m1 'INIT_0' outflow/church_soc_cm.map.v   # must be non-zero hex
```

## Git sync gotcha: local top.v changes
The Chromebook often has local edits to `hardware/soc_minimal/top.v` (the working POR fix). 
`git pull --ff-only` aborts if this file is modified. Fix:
```bash
git stash push -m "local top.v" -- hardware/soc_minimal/top.v
git pull --ff-only
git checkout --theirs hardware/soc_minimal/top.v   # if conflict from stash pop
git add hardware/soc_minimal/top.v
git stash drop
```
The repo's top.v has the correct `por_cnt` POR fix, so `--theirs` is safe.

## Expected bridge output after successful flash
```
  CHURCH Ti60 v1.0
  UID=c0ffee0100000001
  [CALL HOME] Ti60F225  UID=c0ffee0100000001  NIA=0x00000000  boot_ok=1  FW=1.0
  [CALL HOME] ACK received from IDE — boot #NNNN
  NIA=0x00000000
  [CALL HOME] Ti60F225  ...
  [CALL HOME] ACK received from IDE — boot #NNNN+1
```
NIA heartbeat arrives every ~1 second. Boot count increments on every reset.
