#!/usr/bin/env python3
"""
scripts/patch_sapphire_init.py

Patch the Sapphire SoC ROM initial block in sapphire.v to use $readmemb so
EFX_MAP can embed firmware bytes in the synthesised BRAM.

EFX_MAP on Efinix Titanium IGNORES Verilog `initial begin` literal assignments
on inferred arrays — they are treated as simulation-only and the BRAM init is
left zeroed.  $readmemb with bare filenames IS propagated into BRAM INITVAL_
parameters during synthesis — but only if the referenced files actually exist
on disk at synthesis time, resolved relative to efx_run.py's --work_dir
(work_syn/), NOT the project root and NOT hardware/soc_combined/ (empirically
confirmed — see .agents/memory/efx-map-readmemb.md).  scripts/build_ti60_bitstream.sh
deploys the four symbol bins into $SOC_DIR/work_syn/ after this script patches
sapphire.v; scripts/check_sapphire_symbol_bins_fresh.sh guards that they are
present and fresh there before MAP runs.  (The CM BRAM does NOT use this
mechanism any more: it is patched via hardware/soc_combined/gen_cm_dmem_direct.py,
which emits an explicit cm_dmem_bram EFX_RAM10 instantiation with no $readmemb
and no work_syn/ bin files — the old patch_cm_bram.py $readmemb technique is
obsolete/unused, see .agents/memory/obbs-single-patch-location.md.)

The script replaces whatever is in the initial begin...end block that owns the
four ram_symbol0..3 arrays with fresh $readmemb calls using the canonical
bare filenames.  It handles all three states the file can be in:

  1. Virgin sapphire.v   — initial begin with $readmemb (full path from IP gen)
  2. Efinix 2026.1 stub  — initial begin with 4 zero assignments only
  3. Already-patched     — initial begin with 8192 inline assignments per lane

After patching, the four .bin files must exist in hardware/soc_combined/
alongside sapphire.v (the firmware Makefile writes them there automatically
on every `make`; gen_sapphire_symbol_bins.py can regenerate them standalone
from firmware.bin if needed) AND must be copied into $SOC_DIR/work_syn/
before MAP runs — see check_sapphire_symbol_bins_fresh.sh.

Usage (run from repo root):
    python3 scripts/patch_sapphire_init.py \\
        hardware/soc_combined/sapphire.v \\
        [hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol0.bin ...]

The .bin path arguments are accepted for backward compatibility but ignored —
this script only rewrites the $readmemb bare-filename block in sapphire.v.
It does NOT copy the .bin files anywhere; deploying them into
$SOC_DIR/work_syn/ (where EFX_MAP actually resolves bare filenames from) is
done separately by scripts/build_ti60_bitstream.sh.
"""

import re
import sys


SYMBOL_NAMES = [
    "EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol0.bin",
    "EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol1.bin",
    "EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol2.bin",
    "EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol3.bin",
]
RAM_VARS = ["ram_symbol0", "ram_symbol1", "ram_symbol2", "ram_symbol3"]

READMEMB_BLOCK = (
    "  initial begin\n"
    + "".join(
        f'    $readmemb("{SYMBOL_NAMES[i]}", {RAM_VARS[i]});\n'
        for i in range(4)
    )
    + "  end"
)


def patch(content):
    """
    Find and replace the initial begin...end block that initialises
    ram_symbol0..3, returning (new_content, description_string).

    Matches all three variants:
      - one or more $readmemb lines referencing ram_symbol
      - one or more ram_symbolN[...] = ... assignment lines
    All are replaced with four $readmemb bare-filename calls.
    """

    # Single pattern that covers all three variants in one pass.
    # The inner group matches any mixture of:
    #   ram_symbolN[i] = 8'hXX;   (stub zeros or 8192-line inline)
    #   $readmemb("...", ram_symbolN);  (virgin or previously patched)
    # Already patched with exactly the right bare-filename block — nothing to do.
    if READMEMB_BLOCK in content:
        return content, 0

    pat = re.compile(
        r'[ \t]*initial begin\n'
        r'(?:[ \t]*(?:'
        r'ram_symbol\d+\[\d+\] = 8\'h[0-9A-Fa-f]{2}'
        r'|\$readmemb\("[^"]*ram_symbol[^"]*",\s*ram_symbol\d+\)'
        r'|\$readmemb\("[^"]+",\s*ram_symbol\d+\)'
        r');\n)+'
        r'[ \t]*end',
        re.MULTILINE,
    )

    new_content, n = pat.subn(READMEMB_BLOCK, content)
    if n == 0:
        print(
            "ERROR: could not find the ram_symbol0..3 initial begin block in sapphire.v.\n"
            "  Grep for 'ram_symbol' in sapphire.v to inspect the current state.",
            file=sys.stderr,
        )
        sys.exit(1)

    return new_content, n


def main():
    if len(sys.argv) < 2:
        print(
            "Usage: patch_sapphire_init.py sapphire.v [symbol0.bin ...]\n"
            "(bin paths are ignored — $readmemb bare filenames are used)",
            file=sys.stderr,
        )
        sys.exit(1)

    sapphire_path = sys.argv[1]

    with open(sapphire_path, "r") as f:
        content = f.read()

    original_len = len(content)

    new_content, n = patch(content)

    if n == 0:
        print(f"Already patched {sapphire_path} — $readmemb bare-filename block already present, no changes needed.")
        print(f"\nResult block:\n{READMEMB_BLOCK}\n")
    else:
        with open(sapphire_path, "w") as f:
            f.write(new_content)
        delta = len(new_content) - original_len
        print(
            f"Patched {sapphire_path}  "
            f"({n} block(s) replaced, {delta:+,} chars, {len(new_content):,} total)"
        )
        print(f"\nResult block:\n{READMEMB_BLOCK}\n")
    print(
        "Next steps:\n"
        "  1. Ensure symbol .bin files exist in hardware/soc_combined/ "
        "(the firmware Makefile writes them on every `make`)\n"
        "  2. Copy them into $SOC_DIR/work_syn/ — EFX_MAP reads $readmemb bare\n"
        "     filenames relative to --work_dir, not hardware/soc_combined/.\n"
        "     (scripts/build_ti60_bitstream.sh does steps 1-2 automatically.)\n"
        "  3. bash run_efx_map.sh   (re-synthesise — EFX_MAP will read the .bin files)\n"
        "  4. bash run_efx_pnr.sh   (place & route)\n"
    )


if __name__ == "__main__":
    main()
