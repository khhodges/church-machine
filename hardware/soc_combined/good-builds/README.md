# Good Builds

Snapshot of known-working Ti60 SoC firmware builds.

## Files

| File | Description |
|---|---|
| `firmware-YYYY-MM-DD.hex` | Compiled C firmware (BRAM initialisation input for Efinity) |
| `church_soc_cm-YYYY-MM-DD.hex` | Final Efinity output hex — flash this to the Ti60 |

## How to use a saved build

Flash the `.hex` directly with Efinity Programmer (no recompile needed):

1. Open Efinity Programmer
2. Select the `.hex` file
3. Program → the FPGA loads the saved firmware immediately

## Good-build ritual after a successful synthesis run

Run this sequence to make a new bitstream available to IDE users:

```bash
# 1. Build, flash, and smoke-test in one command:
make bitstream-flash

# 2. Verify in the IDE — open the Builder → Connect panel
#    The "Download & Flash" card should show a ✅ badge with the new build date.

# 3. Commit to the repo so the IDE serves the updated hex:
git add bitstreams/
git commit -m "bitstream: Ti60 $(date -u +%Y-%m-%d)"
git push

# 4. (Optional) Archive a copy here for audit:
cp hardware/soc_combined/outflow/church_soc_cm.hex \
   hardware/soc_combined/good-builds/church_soc_cm-$(date +%Y-%m-%d).hex
git add hardware/soc_combined/good-builds/
git commit -m "good-build: Ti60 $(date +%Y-%m-%d) — all UART tests passing"
```

The IDE's Builder → Connect panel polls `/api/bitstream-status` and shows the
build date and firmware version from `bitstreams/church_ti60_f225.json`.  The
metadata JSON is written automatically by `scripts/build_ti60_bitstream.sh`.
