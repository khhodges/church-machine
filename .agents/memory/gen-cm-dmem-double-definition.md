---
name: gen_cm_dmem_direct.py double-definition trap
description: gen_cm_dmem_direct.py embeds cm_dmem_bram module in church_ti60_f225.v AND writes standalone cm_dmem_bram.v; project XML listing both causes VERI-1206 duplicate-module error in efx_map.
---

## The Rule
After running `gen_cm_dmem_direct.py`, delete `cm_dmem_bram.v` from disk and remove its `<efx:design_file>` entry from `church_soc_cm.xml` before running MAP.

## Why
`gen_cm_dmem_direct.py` does two things:
1. **Appends** the `module cm_dmem_bram` definition to the END of `church_ti60_f225.v`
2. **Also writes** a standalone `cm_dmem_bram.v` with the same module

The Efinity project XML includes `cm_dmem_bram.v` as a separate source file. When MAP analyses both files it finds two definitions of `cm_dmem_bram` and aborts with `VERI-1206: overwriting previous definition`.

## How to Apply
In any build script that calls `gen_cm_dmem_direct.py`:
```bash
python3 "$SOC_DIR/gen_cm_dmem_direct.py" "$SOC_DIR"
rm -f "$SOC_DIR/cm_dmem_bram.v"
sed -i '/"cm_dmem_bram\.v"/d' "$SOC_DIR/church_soc_cm.xml"
```

The embedded definition in `church_ti60_f225.v` is sufficient; the standalone file is redundant.

## Also Note
- Before calling `gen_cm_dmem_direct.py`, always restore `church_ti60_f225.v` from `church_ti60_f225.v.pre_direct` if it exists, because if the file was already patched from a previous run the script will fail ("Could not identify dmem pattern").
- The `.pre_direct` backup is created by the first successful run of the script and lives in `$SOC_DIR/`.
