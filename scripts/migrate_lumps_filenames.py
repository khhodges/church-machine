#!/usr/bin/env python3
"""
Migrate server/lumps/ filenames to canonical DotName.issueN.8hex.{lump,json} convention.

Part 1: Rename 9 sidecar JSON files + update manifest sidecar_file fields.
Part 2: Fix manifest abstraction fields (idempotent — skips already-correct entries).
Part 3: Delete orphan files (files on disk not referenced by manifest.json).

Safety: the script refuses to delete any file currently referenced by manifest.json
(either via 'filename', 'sidecar_file', or legacy token basename) regardless of what
is listed in ORPHAN_FILES. This prevents the script from deleting live assets if the
manifest is updated without a corresponding ORPHAN_FILES update.

Usage:
    python3 scripts/migrate_lumps_filenames.py [--dry-run]
"""

import json
import os
import shutil
import sys

LUMPS_DIR = "server/lumps"
MANIFEST_PATH = os.path.join(LUMPS_DIR, "manifest.json")

# Part 1: sidecar renames: old_name -> new_name
# Only renames that map to a manifest sidecar_file field are applied; others skip silently.
SIDECAR_RENAMES = [
    ("00003300.json",                        "Ethernet.1.b169bba4.json"),
    ("NoteG_v6.json",                        "NoteG.1.04a720f8.json"),
    ("Human_Hand_v13.json",                  "Human.Hand.1.e88911d6.json"),
    ("Tunnel_37words_cc_1_25free_v2.json",   "Tunnel.1.8a90193e.json"),
    ("Memory_v1.json",                       "Memory.1.3359e86e.json"),
    ("Loader_v1.json",                       "Loader.1.19ba3a9d.json"),
    ("LEDFlash_v3.json",                     "LEDFlash.1.55f1a32f.json"),
    ("WukongCallHome_v1.json",               "WukongCallHome.1.2f3d7d46.json"),
    ("Abstraction_MorseCmOk_v4.json",        "MorseCmOk.1.eb20fe01.json"),
    ("Abstraction_WukongCallHome_v3.json",   "WukongCallHome.1.0342a02d.json"),
    ("SlideRule_v2.json",                    "SlideRule.1.d960f531.json"),
]

# Part 2: abstraction field fixes: token -> (wrong_value, correct_value)
ABSTRACTION_FIXES = {
    "97cc8047": ("Human_Hand",                          "Human.Hand"),
    "d78f751b": ("Abstraction:  MorseCmOk",            "MorseCmOk"),
    "87c45cc2": ("Abstraction:  WukongCallHome",        "WukongCallHome"),
    "00001001": ("SlideRule (Haskell)",                 "SlideRule.Haskell"),
    "cb8739cf": ("GT Encoding v1.1 Hardware Self-Test", "GT.Encoding.v1.1.Hardware.Self-Test"),
}

# Part 3: orphan files to delete.
# These are files on disk that were not referenced by any manifest.json field at the
# time this migration was written. The safety guard below double-checks this at runtime.
#
# NOT included (live assets that must not be deleted):
#   059dc47f.json / 059dc47f.lump  — PostFlashSelftest binary; consumed by
#       scripts/check_selftest_lump_stale.js, simulator/test_load_lump_binary.js,
#       and tests/simulator/test_selftest_lump_runs.py even though manifest entry
#       has empty filename/sidecar_file (legacy token-basename pattern).
#   SelfTest.1.b562e522.json / SelfTest.1.b562e522.lump — referenced by manifest
#       token 00000600 via filename + sidecar_file fields.
#   00000600.lump / 00000600.json — symlink + sidecar for the SelfTest boot binary;
#       consumed by hardware/boot_rom.py, server/boot_image.py, server/app.py,
#       scripts/gen_build_checkpoint.py, and the entire tests/boot/ suite. The
#       manifest entry for token 00000600 points to the canonical DotName filename,
#       so the manifest guard does NOT protect these legacy paths automatically.
ORPHAN_FILES = """
00000800.json
00000800.lump
00001001.json
00001001.lump
00001200.json
00001200.lump
00001f00.json
00001f00.lump
00002000.json
00002000.lump
00003300.lump
00130000.json
00130000.lump
0baf5e0e.json
0baf5e0e.lump
19d3e599.json
19d3e599.lump
50789581.json
50789581.lump
50ce4c64.json
50ce4c64.lump
5a93ce79.json
5a93ce79.lump
8e37e416.json
8e37e416.lump
ab1e86af.json
ab1e86af.lump
ab3de4fd.json
ab3de4fd.lump
b3076308.json
b3076308.lump
cb8739cf.json
cb8739cf.lump
d9454529.json
d9454529.lump
e186c4ec.json
e186c4ec.lump
Abstraction_MorseCmOk_v1.json
Abstraction_MorseCmOk_v1.lump
Abstraction_MorseCmOk_v2.json
Abstraction_MorseCmOk_v2.lump
Abstraction_MorseCmOk_v3.json
Abstraction_MorseCmOk_v3.lump
Abstraction_MorseCmOk_v4.lump
Abstraction_WukongCallHome_v1.json
Abstraction_WukongCallHome_v1.lump
Abstraction_WukongCallHome_v2.json
Abstraction_WukongCallHome_v2.lump
Abstraction_WukongCallHome_v3.lump
FallbackRegressionAbs_v137.json
FallbackRegressionAbs_v137.lump
FallbackRegressionAbs_v138.json
FallbackRegressionAbs_v138.lump
FallbackRegressionAbs_v139.json
FallbackRegressionAbs_v139.lump
FallbackRegressionAbs_v140.json
FallbackRegressionAbs_v140.lump
FallbackRegressionAbs_v142.json
FallbackRegressionAbs_v142.lump
FallbackRegressionAbs_v143.json
FallbackRegressionAbs_v143.lump
FallbackRegressionAbs_v145.json
FallbackRegressionAbs_v145.lump
FallbackRegressionAbs_v146.json
FallbackRegressionAbs_v146.lump
FallbackRegressionAbs_v147.json
FallbackRegressionAbs_v147.lump
FallbackRegressionAbs_v148.json
FallbackRegressionAbs_v148.lump
FallbackRegressionAbs_v149.json
FallbackRegressionAbs_v149.lump
FallbackRegressionAbs_v150.json
FallbackRegressionAbs_v150.lump
FallbackRegressionAbs_v152.json
FallbackRegressionAbs_v152.lump
FallbackRegressionAbs_v153.json
FallbackRegressionAbs_v153.lump
FallbackRegressionAbs_v154.json
FallbackRegressionAbs_v154.lump
FallbackRegressionAbs_v156.json
FallbackRegressionAbs_v156.lump
FallbackRegressionAbs_v157.json
FallbackRegressionAbs_v157.lump
FallbackRegressionAbs_v159.json
FallbackRegressionAbs_v159.lump
FallbackRegressionAbs_v160.json
FallbackRegressionAbs_v160.lump
FallbackRegressionAbs_v161.json
FallbackRegressionAbs_v161.lump
FallbackRegressionAbs_v162.json
FallbackRegressionAbs_v162.lump
Human_Hand_v1.json
Human_Hand_v1.lump
Human_Hand_v2.json
Human_Hand_v2.lump
Human_Hand_v3.json
Human_Hand_v3.lump
Human_Hand_v4.json
Human_Hand_v4.lump
Human_Hand_v5.json
Human_Hand_v5.lump
Human_Hand_v6.json
Human_Hand_v6.lump
Human_Hand_v7.json
Human_Hand_v7.lump
Human_Hand_v8.json
Human_Hand_v8.lump
Human_Hand_v9.json
Human_Hand_v9.lump
Human_Hand_v10.json
Human_Hand_v10.lump
Human_Hand_v11.json
Human_Hand_v11.lump
Human_Hand_v12.json
Human_Hand_v12.lump
Human_Hand_v13.lump
LED_flash_v1.json
LED_flash_v1.lump
LEDFlash_v1.json
LEDFlash_v1.lump
LEDFlash_v2.json
LEDFlash_v2.lump
LEDFlash_v3.lump
Loader_v0.json
Loader_v0.lump
Loader_v1.lump
Memory_v1.lump
NoteG_v6.lump
SlideRule_v0.json
SlideRule_v0.lump
SlideRule_v1.json
SlideRule_v1.lump
SlideRule_v2.lump
SelfTest_v39.json
SelfTest_v39.lump
SelfTest_v41.json
SelfTest_v41.lump
SelfTest_v43.json
SelfTest_v43.lump
SelfTest_v45.json
SelfTest_v45.lump
SelfTest_v47.json
SelfTest_v47.lump
SelfTest_v49.json
SelfTest_v49.lump
SelfTest_v51.json
SelfTest_v51.lump
SelfTest_v53.json
SelfTest_v53.lump
SelfTest_v55.json
SelfTest_v55.lump
SelfTest_v57.json
SelfTest_v57.lump
SelfTest_v59.json
SelfTest_v59.lump
SelfTest_v61.json
SelfTest_v61.lump
SelfTest_v63.json
SelfTest_v63.lump
SelfTest_v65.json
SelfTest_v65.lump
SelfTest_v67.json
SelfTest_v67.lump
SelfTest_v69.json
SelfTest_v69.lump
SelfTest_v71.json
SelfTest_v71.lump
SelfTest_v73.json
SelfTest_v73.lump
SelfTest_v75.json
SelfTest_v75.lump
SelfTest_v76.json
SelfTest_v76.lump
Tunnel_37words_cc_1_25free_v1.json
Tunnel_37words_cc_1_25free_v1.lump
Tunnel_37words_cc_1_25free_v2.lump
WukongCallHome_v1.lump
start_v76.json
start_v76.lump
""".strip().splitlines()


# Files that are NOT in manifest's filename/sidecar_file fields but still live on disk
# as required by code outside manifest.json. The safety guard uses this in addition to
# the manifest-derived set so that these files are never accidentally deleted.
EXTERNAL_CONSUMER_FILES = {
    "00000600.lump",   # symlink → SelfTest.1.b562e522.lump; read by hardware/boot_rom.py,
                       #   server/boot_image.py, server/app.py, scripts/gen_build_checkpoint.py,
                       #   tests/boot/* (entire boot suite)
    "00000600.json",   # sidecar for the above; read by server/app.py + tests/boot/*
}


def _manifest_referenced_files(manifest):
    """Return the set of basenames referenced by any manifest field.

    Covers three cases:
    1. Explicit 'filename' field (e.g. "SelfTest.1.b562e522.lump")
    2. Explicit 'sidecar_file' field (e.g. "SelfTest.1.b562e522.json")
    3. Legacy token-basename pattern: when 'filename' is absent/empty, the binary
       lives at "{token}.lump" and the sidecar at "{token}.json" by convention.
       Example: PostFlashSelftest (token 059dc47f) has no 'filename' but
       check_selftest_lump_stale.js, test_load_lump_binary.js, and
       test_selftest_lump_runs.py all consume 059dc47f.lump / 059dc47f.json.
    """
    refs = set()
    for entry in manifest:
        tok = entry.get("token", "").lower()
        fn = entry.get("filename", "")
        sf = entry.get("sidecar_file", "")
        # Explicit filename / sidecar_file
        if fn:
            refs.add(fn)
        if sf:
            refs.add(sf)
        # Legacy token-basename — only apply when no canonical filename is set
        if tok and not fn:
            refs.add(f"{tok}.lump")
            refs.add(f"{tok}.json")
    return refs


def main():
    dry_run = "--dry-run" in sys.argv
    if dry_run:
        print("=== DRY RUN — no files will be changed ===\n")

    # Load manifest
    with open(MANIFEST_PATH) as f:
        manifest = json.load(f)

    print(f"Loaded manifest with {len(manifest)} entries.\n")

    # Build safety set: files the manifest references (must never be deleted)
    protected = _manifest_referenced_files(manifest) | EXTERNAL_CONSUMER_FILES

    # Validate ORPHAN_FILES against protection set
    print("=== Safety check: orphan list vs manifest + external consumers ===")
    unsafe = [f for f in ORPHAN_FILES if f in protected]
    if unsafe:
        print(f"  ERROR: the following ORPHAN_FILES are protected (manifest or known external consumer):")
        for f in unsafe:
            print(f"    {f}")
        if not dry_run:
            print("  Aborting to protect live assets. Fix ORPHAN_FILES and retry.")
            sys.exit(1)
        else:
            print("  [DRY RUN] Would abort here in live mode.\n")
    else:
        print("  OK — no ORPHAN_FILES overlap with protected files.\n")

    # --- Part 1: Rename sidecar files + update manifest ---
    print("=== Part 1: Sidecar renames ===")
    rename_map = {old: new for old, new in SIDECAR_RENAMES}

    renamed_count = 0
    for entry in manifest:
        sf = entry.get("sidecar_file")
        if sf and sf in rename_map:
            new_sf = rename_map[sf]
            old_path = os.path.join(LUMPS_DIR, sf)
            new_path = os.path.join(LUMPS_DIR, new_sf)
            print(f"  RENAME sidecar: {sf} -> {new_sf}")
            if not dry_run:
                if os.path.exists(old_path):
                    shutil.copy2(old_path, new_path)
                    os.remove(old_path)
                    print(f"    [OK] file moved")
                else:
                    print(f"    [WARN] source file not found: {old_path}")
                entry["sidecar_file"] = new_sf
            renamed_count += 1

    print(f"  Total sidecar renames applied: {renamed_count}\n")

    # --- Part 2: Fix abstraction fields ---
    print("=== Part 2: Abstraction field fixes ===")
    abstr_fixed = 0

    for entry in manifest:
        token = entry.get("token", "")
        if token in ABSTRACTION_FIXES:
            wrong, correct = ABSTRACTION_FIXES[token]
            current = entry.get("abstraction", "")
            if current == correct:
                print(f"  SKIP token={token}: abstraction already '{correct}' (already fixed)")
            elif current == wrong:
                print(f"  FIX abstraction token={token}: '{wrong}' -> '{correct}'")
                if not dry_run:
                    entry["abstraction"] = correct
                abstr_fixed += 1
            else:
                print(f"  WARN token={token}: expected '{wrong}' but found '{current}' — setting to '{correct}' anyway")
                if not dry_run:
                    entry["abstraction"] = correct
                abstr_fixed += 1

    print(f"  Abstraction fixes: {abstr_fixed}\n")

    # --- Write manifest atomically ---
    if not dry_run and (renamed_count > 0 or abstr_fixed > 0):
        tmp_path = MANIFEST_PATH + ".tmp"
        with open(tmp_path, "w") as f:
            json.dump(manifest, f, indent=2)
            f.write("\n")
        os.replace(tmp_path, MANIFEST_PATH)
        print("  manifest.json written.\n")

    # --- Part 3: Delete orphan files ---
    print("=== Part 3: Delete orphan files ===")
    deleted = 0
    missing = 0
    skipped_protected = 0
    for fname in ORPHAN_FILES:
        # Extra runtime safety: skip if manifest now references this file
        if fname in protected:
            print(f"  SKIP (protected by manifest) {fname}")
            skipped_protected += 1
            continue
        fpath = os.path.join(LUMPS_DIR, fname)
        if os.path.exists(fpath):
            print(f"  DELETE {fname}")
            if not dry_run:
                os.remove(fpath)
            deleted += 1
        else:
            print(f"  SKIP (not found) {fname}")
            missing += 1

    print(f"\n  Deleted: {deleted}, Not found: {missing}, Protected: {skipped_protected}\n")

    # --- Summary ---
    print("=== Summary ===")
    print(f"  Sidecar renames:      {renamed_count}")
    print(f"  Abstraction fixes:    {abstr_fixed}")
    print(f"  Orphan files deleted: {deleted}")
    if dry_run:
        print("\n[DRY RUN complete — re-run without --dry-run to apply changes]")
    else:
        print("\n[Done]")


if __name__ == "__main__":
    main()
