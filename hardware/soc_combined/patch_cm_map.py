#!/usr/bin/env python3
"""patch_cm_map.py — Fix EFX_MAP bug where $readmemb BRAM INIT values land
in defparam but NOT in the /* verific */ comment that efx_pnr reads for
BRAM bitstream initialisation.

ROOT CAUSE
----------
EFX_MAP computes correct INIT_N values from $readmemb and stores them in
  defparam \\u_cm/dmem_bX__<INST> .INIT_N = 256'h<value>;
but efx_pnr reads BRAM INIT from the inline /* verific ... INIT_N=... */
attribute comment. Instances initialised by $readmemb have no INIT_N in
their verific comment, so efx_pnr uses all-zero — confirmed by INSTR=0x0
in FAULT_EVENT even though the defparam is non-zero.

FIX
---
For every dmem_b? EFX_RAM10 instance whose defparam has ≥1 non-zero INIT:
  • Find the instance statement in map.v
  • If the /* verific */ comment lacks INIT_N attrs, add them
  • If it has INIT_N attrs already, update the zero ones with defparam values

USAGE
-----
  python3 hardware/soc_combined/patch_cm_map.py \\
      ~/church_project/SoC/outflow/church_soc_cm.map.v

After patching re-run ONLY P&R (no re-synthesis):
  cd ~/church_project/SoC && bash work_pnr/run_efx_pnr.sh
"""

import re
import shutil
import sys
from pathlib import Path

ZERO64 = '0' * 64


def _init_val(init_map, n):
    return init_map.get(f'INIT_{n}', ZERO64)


def main(mapv_path):
    path = Path(mapv_path)
    if not path.exists():
        sys.exit(f"ERROR: {path} not found")

    print(f"Reading {path.name}  ({path.stat().st_size:,} bytes)")
    text = path.read_text()
    lines = text.split('\n')

    # ── 1. Collect all defparam INIT_N for dmem_b? instances ─────────────────
    dp_re = re.compile(
        r"^\s*defparam\s+(\\u_cm/dmem_b\d__\S+)\s*\.(INIT_\d+)\s*"
        r"=\s*256'h([0-9a-fA-F]+)\s*;\s*$",
        re.MULTILINE,
    )
    inits = {}  # inst_name -> {INIT_N: hex_str}
    for m in dp_re.finditer(text):
        inits.setdefault(m.group(1), {})[m.group(2)] = m.group(3).lower()

    nonzero = {
        inst: d for inst, d in inits.items()
        if any(v.strip('0') for v in d.values())
    }
    print(f"dmem_b instances with defparam: {len(inits)}, "
          f"non-zero INIT: {len(nonzero)}")
    if not nonzero:
        print("Nothing to patch — no non-zero defparam INIT values found.")
        return

    # ── 2. Extract a template verific comment from a zero-INIT instance ───────
    # Template gives us the attribute list (polarity flags, mode strings, etc.)
    # We strip INIT entries and replace them with the real values.
    tmpl_comment = None
    for line in lines:
        if ('EFX_RAM10' in line and 'dmem_b' in line
                and 'verific' in line and 'INIT_0' in line):
            m = re.search(r'(/\* verific .+?\*/)', line)
            if m:
                tmpl_comment = m.group(1)
                break

    if tmpl_comment:
        # Strip all INIT_N=256'h... entries to get the base attribute block
        base_attrs = re.sub(r",?\s*INIT_\d+=256'h[0-9a-fA-F]+", '', tmpl_comment)
        # Remove closing */ so we can append INIT entries then re-add */
        base_open = base_attrs.rstrip()
        if base_open.endswith('*/'):
            base_open = base_open[:-2].rstrip()
        print(f"Template comment  : {base_open[:90]}...")
    else:
        base_open = (
            "/* verific EFX_ATTRIBUTE_CELL_NAME=EFX_RAM10, "
            "READ_WIDTH=1, WRITE_WIDTH=1"
        )
        print("WARNING: no template comment found — using minimal verific header")

    # ── 3. Build per-instance INIT string ─────────────────────────────────────
    def build_init_str(init_map):
        max_n = max(int(k.split('_')[1]) for k in init_map)
        return ', '.join(
            f"INIT_{n}=256'h{_init_val(init_map, n)}"
            for n in range(max_n + 1)
        )

    # ── 4. Patch instance lines ───────────────────────────────────────────────
    patched = 0
    new_lines = []

    for line in lines:
        modified = line
        for inst_name, init_map in nonzero.items():
            # Fast check: instance name must appear in the line
            if inst_name not in line:
                continue
            # Confirm it's the EFX_RAM10 instantiation (not a defparam or comment)
            if 'EFX_RAM10' not in line:
                continue

            nz_count = sum(1 for v in init_map.values() if v.strip('0'))
            init_str = build_init_str(init_map)
            max_n = max(int(k.split('_')[1]) for k in init_map)

            if re.search(r'INIT_\d+=256', line):
                # ── Case A: verific comment already has INIT attrs (update them)
                def repl(m2):
                    return (
                        f"INIT_{m2.group(1)}=256'h"
                        f"{_init_val(init_map, int(m2.group(1)))}"
                    )
                modified = re.sub(
                    r"INIT_(\d+)=256'h[0-9a-fA-F]+", repl, line
                )
                if modified != line:
                    patched += 1
                    print(f"  UPDATED {inst_name}  "
                          f"({max_n+1} INIT params, {nz_count} non-zero)")
            elif '/* verific' in line:
                # ── Case B: verific comment exists but has no INIT attrs
                # Insert INIT entries before the closing */
                modified = re.sub(
                    r'\s*\*/',
                    f', {init_str} */',
                    line,
                    count=1,
                )
                if modified != line:
                    patched += 1
                    print(f"  INSERTED into existing comment  {inst_name}  "
                          f"({max_n+1} INIT params, {nz_count} non-zero)")
            else:
                # ── Case C: no verific comment at all — add one before ;
                stripped = line.rstrip()
                if stripped.endswith(');'):
                    new_comment = f" {base_open}, {init_str} */"
                    modified = stripped[:-1] + new_comment + ';'
                    # Preserve original trailing whitespace / newline
                    modified += line[len(stripped):]
                    patched += 1
                    print(f"  ADDED new comment  {inst_name}  "
                          f"({max_n+1} INIT params, {nz_count} non-zero)")
                else:
                    print(f"  WARN: unexpected line ending for {inst_name} — "
                          f"skipped")
            break  # one instance per line

        new_lines.append(modified)

    print(f"\n{patched} instance(s) patched")
    if patched == 0:
        print("No changes written.")
        return

    bak = path.with_name(path.name + '.bak')
    shutil.copy2(path, bak)
    print(f"Backup  → {bak}")
    path.write_text('\n'.join(new_lines))
    print(f"Written → {path}")
    print()
    print("Next step — re-run P&R only (no re-synthesis needed):")
    print("  cd ~/church_project/SoC && bash work_pnr/run_efx_pnr.sh")
    print()
    print("Then flash and run bridge:")
    print("  bash ~/church_project/SoC/church-machine/hardware/soc_combined/"
          "run_efx_pgm.sh ~/church_project/SoC/church_soc_cm.xml")
    print("  sudo openFPGALoader -b titanium_ti60_f225_jtag "
          "-f ~/church_project/SoC/outflow/church_soc_cm.hex")
    print("  python3 ~/church_project/SoC/church-machine/hardware/soc_combined/"
          "callhome_bridge.py --port=/dev/ttyUSB2 "
          "--ide=https://lab.cloomc.org --insecure")


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <path/to/church_soc_cm.map.v>")
        sys.exit(1)
    main(sys.argv[1])
