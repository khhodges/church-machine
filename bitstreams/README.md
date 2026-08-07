# bitstreams/

Pre-built bitstream files for the Church Machine. The files currently in this
directory are legacy artifacts from the previous FPGA platform.

> **Current platform:** Wukong A7 XC7A100T. Bitstreams are built with Vivado
> on the Wukong droplet (see `docs/HARDWARE.md § 8` for the full build checklist).
> The output file is `church_wukong_xc7a100t.bit`.

## Building a new bitstream (Wukong A7)

```bash
# Step 1 — Download the build package ZIP from the IDE:
#   Builder → Connect → Download Wukong Build ZIP  (IDE URL: /dl/wukong-zip)
#   This ZIP contains church_wukong_xc7a100t.v, wukong_xc7a100t.xdc, and
#   wukong_xc7a100t.tcl all in the same directory — ready to feed to Vivado.
#   Extract it, then run Vivado from the extracted directory:
unzip church_wukong_build.zip
cd church_wukong_build
vivado -mode batch -source wukong_xc7a100t.tcl
# Output: church_wukong_xc7a100t.bit

# Alternative — build from source if you have the full repo:
python3 -m hardware.gen_rtlil --wukong   # writes build/church_wukong_xc7a100t.v
cp build/church_wukong_xc7a100t.v hardware/
cd hardware && vivado -mode batch -source wukong_xc7a100t.tcl

# Step 2 — Flash the board:
# Option A — Vivado Hardware Manager (GUI):
#   open_hw_manager → connect → Program Device → church_wukong_xc7a100t.bit
# Option B — xc3sprog (Chromebook Linux with Platform Cable USB II):
#   xc3sprog -c xpc -p 0 church_wukong_xc7a100t.bit

# Step 3 — (Optional) Upload the built bitstream back to the IDE:
#   curl -X POST <ide-url>/upload/wukong-bit -F "file=@church_wukong_xc7a100t.bit"
#   This makes it available via /dl/wukong-bit for future downloads.
```

## Legacy files

The legacy bitstream files in this directory are preserved for historical
reference only. They are not used by the current build pipeline.
