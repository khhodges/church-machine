---
name: Ti60 firmware update pipeline — A-to-Z probe foundation
description: The ONLY correct flow to get new firmware into the board; PNR-only skips three required steps and always flashes stale 'C' firmware.
---

## The three steps that were silently skipped (causing permanent 'C')

1. `patch_sapphire_init.py` on the **repo copy** (`$HW/sapphire.v`) — writes bare-filename `$readmemb` block; then patched file MUST be deployed to `$SOC_DIR/sapphire.v`.  Running only PNR never touches sapphire.v.
2. VDB deletion before MAP — `patch_sapphire_init.py` is idempotent (mtime never changes after first run), so MAP sees "Verilog unchanged → VDB fresh" and exits in seconds with OLD firmware.  Must delete all VDB files to force 45-min full synthesis.
3. MAP itself — skipped entirely when only PNR+PGM were run.  PNR resolves `$readmemb` symbol bins at P&R time, but if it uses a VDB built from a previous MAP run with old bins, it embeds old firmware.

## The ONLY correct procedure on the droplet

```bash
cd ~/church-machine
git pull   # BEFORE build, never after
bash scripts/build_ti60_bitstream.sh   # bumps letter, builds, patches, MAP, PNR, PGM (~1 hr)
# Hex is at $SOC_DIR/outflow/church_soc_cm.hex — serve from THERE, not the repo
python3 -m http.server 8888 --directory ~/church_project/SoC/outflow/
```

On Chromebook:
```bash
stty -F /dev/ttyUSB2 57600 raw cs8 -cstopb -parenb && cat /dev/ttyUSB2 &
wget http://165.227.190.84:8888/church_soc_cm.hex -O /tmp/new_fw.hex
sudo openFPGALoader -b titanium_ti60_f225_jtag -f /tmp/new_fw.hex
```

## Why serving from the repo's bitstreams/ silently breaks the A-to-Z mechanism

- Replit auto-syncs every 30 min, force-pushing Replit's old hex to GitHub
- `git pull` on the droplet (before or after build) restores the old Replit hex
- `bitstreams/church_ti60_f225.hex` in the repo gets overwritten

**Fix:** serve from `~/church_project/SoC/outflow/church_soc_cm.hex` — the Efinity output directory, never in the git repo.

## What the OBBS does that PNR-only does NOT

| Step | OBBS | PNR-only |
|------|------|----------|
| bump_build_letter.sh | ✓ | ✗ |
| make -C firmware clean && make | ✓ | ✗ |
| patch_sapphire_init.py on $HW/sapphire.v | ✓ | ✗ |
| deploy patched sapphire.v to $SOC_DIR/ | ✓ | ✗ |
| copy bins to $SOC_DIR/ AND work_syn/ | ✓ | ✗ |
| delete all VDB files (force full MAP) | ✓ | ✗ |
| MAP synthesis (~45 min) | ✓ | ✗ |
| copy bins to work_pnr/ and outflow/ | ✓ | ✗ |
| PNR + PGM | ✓ | ✓ |

**Why:** PNR resolves `$readmemb` from bins at P&R time.  But without a fresh VDB from MAP, the VDB has old firmware baked in.  MAP must run after patch to produce a fresh VDB.

## A-to-Z probe verification

After the OBBS: `grep FW_BUILD_LETTER ~/church-machine/hardware/soc_combined/firmware/build_seq.h`
After flash: first character on ttyUSB2 must match that letter.
If it matches: foundation confirmed.  If 'C' again: git pull overwrote the hex.
