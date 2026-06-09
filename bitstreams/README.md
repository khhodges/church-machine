# bitstreams/

Pre-built bitstream files for the Ti60 F225.  Files in this directory can be
downloaded directly from the IDE and flashed to the board without running the
Efinity toolchain.

## Files

| File | Description |
|---|---|
| `church_ti60_f225.hex` | SPI flash hex — flash this to the Ti60 with `openFPGALoader` or Efinity Programmer |
| `church_ti60_f225.bit` | Raw active-serial bitstream (same content, different container) |
| `church_ti60_f225.json` | Build metadata sidecar — `built_at`, `firmware_version`, `size_bytes` |

## Download from the IDE

The IDE serves the hex file directly at `/dl/ti60-hex`.  The Builder → Connect
panel shows a **Download & Flash** card that links to this file and to the
WebSerial flash wizard.

## Building a new bitstream

Run from the repo root (requires Efinity installed):

```bash
make bitstream
```

Or with automatic flash + smoke-test after build:

```bash
make bitstream-flash
```

See `scripts/build_ti60_bitstream.sh` and `hardware/soc_combined/BUILD_SOC_CM.md`
for full prerequisites and troubleshooting.

## After a successful synthesis run

Commit the new hex immediately so the IDE can serve it:

```bash
git add bitstreams/
git commit -m "bitstream: Ti60 YYYY-MM-DD"
```
