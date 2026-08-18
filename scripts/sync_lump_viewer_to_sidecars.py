#!/usr/bin/env python3
"""
sync_lump_viewer_to_sidecars.py — sync group/doc_refs from Lump Viewer into sidecar JSONs.

The Lump Viewer (docs/figures/Lumps Directory.html) is the authoritative source for
group classification and documentation cross-references.  This script propagates those
two fields into the per-lump sidecar JSONs so that /api/lumps/list exposes them, and so
the Manifest Viewer can display them.

TOKEN RULE
----------
Every Lump Viewer entry is matched to a manifest entry by abstraction name (primary) or
by the Viewer's token field (fallback).  Once matched, the Viewer's token must agree with
the manifest token for that entry — a discrepancy means the Viewer HTML has a stale or
copy-pasted token and is an error.

MISSING SIDECAR
---------------
Every manifest entry whose .lump file is on disk must have a readable sidecar .json.
A missing sidecar is an error — it means group/doc_refs cannot be propagated.

COLLISION DETECTION
-------------------
Multiple Lump Viewer entries may legitimately resolve to the same manifest/sidecar (e.g.
CapabilityTest and CapabilityTest.2 share a token/sidecar).  This is allowed only if
both entries carry identical group and doc_refs values.  Conflicting metadata is an error.

WRITE SAFETY
------------
No sidecar file is touched until ALL preflights across ALL entries pass.

Ghost entries
-------------
Lump Viewer entries with no matching manifest entry or no .lump on disk are reported
as informational ghost entries and are skipped.  Not fatal.

Usage
-----
  # Write mode (default) — validates ALL entries first, then updates sidecars in place:
  python scripts/sync_lump_viewer_to_sidecars.py

  # CI guard — asserts but never writes:
  python scripts/sync_lump_viewer_to_sidecars.py --check
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

HERE    = os.path.dirname(os.path.abspath(__file__))
ROOT    = os.path.dirname(HERE)
HTML_PATH     = os.path.join(ROOT, "docs", "figures", "Lumps Directory.html")
LUMPS_DIR     = os.path.join(ROOT, "server", "lumps")
MANIFEST_PATH = os.path.join(LUMPS_DIR, "manifest.json")

# ── Ghost allowlist ────────────────────────────────────────────────────────────
# Lump Viewer entries that have no matching .lump on disk are "ghost" entries.
# In --check mode any ghost whose id is NOT in this set is a CI failure, so new
# accidental ghosts are caught immediately.  To legitimise a new ghost, add its
# id here AND update this comment.
GHOST_ALLOWLIST: frozenset = frozenset({
    "Adder",        # placeholder — no .lump built yet
    "Alice",        # placeholder — no .lump built yet
    "Calc",         # placeholder — no .lump built yet
    "Counter",      # placeholder — no .lump built yet
    "DijkstraFlag", # placeholder — no .lump built yet
    "Mallory",      # placeholder — no .lump built yet
    "Store",        # placeholder — no .lump built yet
})

# ── Parse LUMPS[] from HTML ────────────────────────────────────────────────────

def _extract_lumps_js(html_path: str) -> str:
    """Return the raw JS source of the LUMPS array from the HTML file."""
    with open(html_path, encoding="utf-8") as fh:
        content = fh.read()
    m = re.search(
        r'const\s+LUMPS\s*=\s*(\[.*?\])\s*;\s*//\s*end\s+LUMPS',
        content, re.DOTALL
    )
    if not m:
        raise RuntimeError(
            f"Cannot locate 'const LUMPS = [...]; // end LUMPS' in {html_path}"
        )
    return m.group(1)


def _parse_lumps_array(js_source: str) -> list:
    """Evaluate the JS LUMPS array via Node.js and return parsed Python objects."""
    script = (
        "const LUMPS = " + js_source + ";\n"
        "process.stdout.write(JSON.stringify(LUMPS));\n"
    )
    with tempfile.NamedTemporaryFile(mode="w", suffix=".js", delete=False) as tf:
        tf.write(script)
        tmp_path = tf.name
    try:
        result = subprocess.run(
            ["node", tmp_path],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"node failed (exit {result.returncode}):\n{result.stderr.strip()}"
            )
        return json.loads(result.stdout)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def load_lumps_viewer(html_path: str) -> list:
    """Return the LUMPS[] array parsed from the Lump Viewer HTML."""
    js_src = _extract_lumps_js(html_path)
    return _parse_lumps_array(js_src)


# ── Manifest helpers ───────────────────────────────────────────────────────────

def load_manifest(path: str) -> list:
    with open(path) as fh:
        return json.load(fh)


def _sidecar_path_for_entry(mf_entry: dict, lumps_dir: str) -> str | None:
    """Return the resolved sidecar path for a manifest entry, or None if absent."""
    sc_fn = mf_entry.get("sidecar_file") or f"{mf_entry.get('token','')}.json"
    candidate = os.path.join(lumps_dir, sc_fn)
    if os.path.isfile(candidate):
        return candidate
    fallback = os.path.join(lumps_dir, f"{mf_entry.get('token','')}.json")
    return fallback if os.path.isfile(fallback) else None


def _lump_path_for_entry(mf_entry: dict, lumps_dir: str) -> str | None:
    """Return the resolved .lump path for a manifest entry, or None if absent."""
    fn = mf_entry.get("filename")
    if fn:
        p = os.path.join(lumps_dir, fn)
        if os.path.isfile(p):
            return p
    token = mf_entry.get("token", "")
    p2 = os.path.join(lumps_dir, f"{token}.lump")
    return p2 if os.path.isfile(p2) else None


# ── Matching: LUMPS[] entry ↔ manifest entry ───────────────────────────────────

def _build_manifest_lookup(manifest: list):
    """Return (by_name, by_token) dicts for fast manifest lookups."""
    by_name  = {}  # abstraction.lower() → entry
    by_token = {}  # token.lower()        → entry
    for e in manifest:
        name = e.get("abstraction", "")
        if name:
            by_name[name.lower()] = e
        tok = e.get("token", "")
        if tok:
            by_token[tok.lower()] = e
    return by_name, by_token


def _find_manifest_entry(lump_id: str, lump_token: str,
                          by_name: dict, by_token: dict):
    """Find the manifest entry for a LUMPS[] id/token pair.

    Primary key: abstraction name (id).  Fallback: manifest token.
    Returns (mf_entry, matched_by_name) or (None, False).
    """
    e = by_name.get(lump_id.lower())
    if e:
        return e, True
    if lump_token:
        e = by_token.get(lump_token.lower())
        if e:
            return e, False
    return None, False


def _find_lumps_entry(mf_abs: str, mf_token: str,
                       lumps_by_id: dict, lumps_by_token: dict):
    """Find the LUMPS[] entry for a manifest abstraction/token pair."""
    e = lumps_by_id.get(mf_abs.lower())
    if e:
        return e
    if mf_token:
        e = lumps_by_token.get(mf_token.lower())
        if e:
            return e
    return None


# ── Sidecar I/O ────────────────────────────────────────────────────────────────

def _load_sidecar(path: str) -> dict:
    with open(path) as fh:
        return json.load(fh)


def _save_sidecar(path: str, data: dict) -> None:
    with open(path, "w") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


# ── Preflight + work planning ──────────────────────────────────────────────────

def plan_work(lumps: list, manifest: list, lumps_dir: str):
    """Validate all entries and return (errors, ghosts, work_items).

    No file is read/written beyond preflights.  work_items contains everything
    needed for the write or --check phase.

    Preflights enforced here:
      A — sidecar must exist for every on-disk lump
      B — sidecar.token must match manifest.token
      C — Viewer token must agree with matched manifest token (cross-token check)
      D — multiple Viewer entries resolving to the same sidecar must have
          identical group/doc_refs (collision check)
    """
    by_name, by_token = _build_manifest_lookup(manifest)

    lumps_by_id    = {l["id"].lower(): l for l in lumps}
    lumps_by_token = {}
    for lv in lumps:
        t = lv.get("token", "")
        if t:
            lumps_by_token.setdefault(t.lower(), lv)

    errors = []
    ghosts = []

    # sidecar_key (sc_path) → first work item that claimed it, for collision detection
    claimed: dict[str, dict] = {}

    work = []

    for lump in lumps:
        lump_id    = lump["id"]
        lump_token = (lump.get("token") or "").lower()

        mf_entry, matched_by_name = _find_manifest_entry(
            lump_id, lump_token, by_name, by_token
        )
        if mf_entry is None:
            ghosts.append((lump_id, f"{lump_id} (no manifest entry, token={lump_token})"))
            continue

        # Is the .lump file on disk?
        if _lump_path_for_entry(mf_entry, lumps_dir) is None:
            ghosts.append((lump_id, f"{lump_id} (no .lump file on disk)"))
            continue

        mf_token = (mf_entry.get("token") or "").lower()

        # --- PREFLIGHT C: Viewer token must match manifest token for this entry ---
        # Only checked when matched by name AND the Viewer supplies a token.
        # (When matched by token-fallback the Viewer token IS the manifest token.)
        if matched_by_name and lump_token and lump_token != mf_token:
            # Is the Viewer token pointing at a DIFFERENT manifest entry?
            other = by_token.get(lump_token)
            if other is not None and other is not mf_entry:
                errors.append(
                    f"TOKEN CROSS-REFERENCE — {lump_id}: Lump Viewer token={lump_token!r} "
                    f"belongs to manifest entry '{other.get('abstraction')}' "
                    f"(not {mf_entry.get('abstraction')!r}).  "
                    f"Fix the token in Lumps Directory.html."
                )
                continue  # do not include in work list

        # --- PREFLIGHT A: sidecar must exist ---
        sc_path = _sidecar_path_for_entry(mf_entry, lumps_dir)
        if sc_path is None:
            sc_fn = mf_entry.get("sidecar_file") or f"{mf_token}.json"
            errors.append(
                f"MISSING SIDECAR — {lump_id} "
                f"(manifest token={mf_token}): "
                f"expected '{sc_fn}' not found in {lumps_dir}.  "
                f"Create the sidecar before running sync."
            )
            continue

        try:
            sidecar = _load_sidecar(sc_path)
        except Exception as exc:
            errors.append(f"UNREADABLE SIDECAR — {lump_id} ({sc_path}): {exc}")
            continue

        # --- PREFLIGHT B: sidecar.token must match manifest.token ---
        sc_token = (sidecar.get("token") or "").lower()
        if sc_token != mf_token:
            errors.append(
                f"TOKEN MISMATCH — {lump_id}: "
                f"sidecar.token={sc_token!r} != manifest.token={mf_token!r} "
                f"in {os.path.basename(sc_path)}.  "
                f"Run the token-fix task first."
            )
            continue

        lump_group    = lump.get("group")
        lump_doc_refs = lump.get("doc_refs") or []

        item = {
            "lump_id":       lump_id,
            "lump_group":    lump_group,
            "lump_doc_refs": lump_doc_refs,
            "mf_entry":      mf_entry,
            "sc_path":       sc_path,
            "sidecar":       sidecar,
        }

        # --- PREFLIGHT D: collision — same sidecar targeted by multiple entries ---
        if sc_path in claimed:
            first = claimed[sc_path]
            if (first["lump_group"] != lump_group or
                    sorted(first["lump_doc_refs"]) != sorted(lump_doc_refs)):
                errors.append(
                    f"COLLISION — both '{first['lump_id']}' and '{lump_id}' "
                    f"resolve to {os.path.basename(sc_path)} "
                    f"but carry conflicting group/doc_refs.  "
                    f"Align them in Lumps Directory.html."
                )
        else:
            claimed[sc_path] = item
            work.append(item)

    # Deduplicate work (only the first entry per sidecar survives collision filter above)
    return errors, ghosts, work, by_name, by_token, lumps_by_id, lumps_by_token


# ── Main ───────────────────────────────────────────────────────────────────────

def main(
    html_path=HTML_PATH,
    lumps_dir=LUMPS_DIR,
    manifest_path=MANIFEST_PATH,
    argv=None,
) -> int:
    ap = argparse.ArgumentParser(
        description="Sync group/doc_refs from Lump Viewer into sidecar JSONs."
    )
    ap.add_argument(
        "--check", action="store_true",
        help="CI guard mode: assert but never write. Exit 1 on any violation."
    )
    args = ap.parse_args(argv)

    # ── Load data ──────────────────────────────────────────────
    print(f"[sync] Loading Lump Viewer: {html_path}")
    lumps = load_lumps_viewer(html_path)
    print(f"[sync] {len(lumps)} LUMPS[] entries found.")

    manifest = load_manifest(manifest_path)
    print(f"[sync] {len(manifest)} manifest entries found.")

    # ── Preflight all entries (no writes happen inside plan_work) ──
    errors, ghosts, work, by_name, by_token, lumps_by_id, lumps_by_token = plan_work(
        lumps, manifest, lumps_dir
    )

    # --- Bail early if any preflight failed (before touching any file) ---
    if errors and not args.check:
        print(f"\n[ERROR] Preflight failed — no sidecars were modified.")
        for err in errors:
            print(f"  ✗ {err}")
        if ghosts:
            _print_ghosts(ghosts)
        return 1

    # ── Phase 2: check or write ────────────────────────────────
    check_errors = list(errors)   # carry preflight errors into --check totals
    updated    = 0
    checked_ok = 0

    for item in work:
        lump_id       = item["lump_id"]
        lump_group    = item["lump_group"]
        lump_doc_refs = item["lump_doc_refs"]
        sc_path       = item["sc_path"]
        sidecar       = item["sidecar"]

        if args.check:
            sc_group    = sidecar.get("group")
            sc_doc_refs = sidecar.get("doc_refs") or []
            entry_ok = True
            if sc_group != lump_group:
                check_errors.append(
                    f"group mismatch — {lump_id}: "
                    f"sidecar={sc_group!r} != viewer={lump_group!r}"
                )
                entry_ok = False
            if sorted(sc_doc_refs) != sorted(lump_doc_refs):
                check_errors.append(
                    f"doc_refs mismatch — {lump_id}: "
                    f"sidecar={sc_doc_refs} != viewer={lump_doc_refs}"
                )
                entry_ok = False
            if entry_ok:
                checked_ok += 1
        else:
            # Write mode: merge group and doc_refs (never touch build-owned fields)
            changed = False
            if sidecar.get("group") != lump_group:
                sidecar["group"] = lump_group
                changed = True
            if (sidecar.get("doc_refs") or []) != lump_doc_refs:
                sidecar["doc_refs"] = lump_doc_refs
                changed = True
            if changed:
                _save_sidecar(sc_path, sidecar)
                updated += 1
                print(f"  [updated] {os.path.basename(sc_path):50s}  "
                      f"group={lump_group!r:25s}  doc_refs={len(lump_doc_refs)}")
            else:
                print(f"  [ok]      {os.path.basename(sc_path):50s}  "
                      f"(already up to date)")

    # ── Phase 3 (check only): every on-disk manifest entry must have a Viewer entry ──
    if args.check:
        for mf_entry in manifest:
            mf_abs   = mf_entry.get("abstraction", "")
            mf_token = (mf_entry.get("token") or "").lower()
            if _lump_path_for_entry(mf_entry, lumps_dir) is None:
                continue
            lv_entry = _find_lumps_entry(mf_abs, mf_token, lumps_by_id, lumps_by_token)
            if lv_entry is None:
                check_errors.append(
                    f"Manifest entry '{mf_abs}' (token={mf_token}) "
                    f"has no corresponding Lump Viewer entry."
                )

    # ── Report ghost entries; enforce allowlist in --check mode ───
    if ghosts:
        _print_ghosts(ghosts)
    if args.check:
        for ghost_id, desc in ghosts:
            if ghost_id not in GHOST_ALLOWLIST:
                check_errors.append(
                    f"UNEXPECTED GHOST — '{ghost_id}' appears in Lump Viewer "
                    f"but has no .lump on disk and is not in GHOST_ALLOWLIST.  "
                    f"Either build the lump or add '{ghost_id}' to GHOST_ALLOWLIST "
                    f"in scripts/sync_lump_viewer_to_sidecars.py."
                )

    # ── Final result ───────────────────────────────────────────
    if check_errors:
        print(f"\n{'[FAIL]' if args.check else '[ERROR]'} "
              f"{'--check' if args.check else 'sync'} found {len(check_errors)} violation(s):")
        for err in check_errors:
            print(f"  ✗ {err}")
        return 1

    if args.check:
        total = len(work)
        print(f"\n[OK] --check passed: {checked_ok}/{total} entries verified "
              f"(group + doc_refs + token).")
    else:
        print(f"\n[DONE] Sync complete — {updated} sidecar(s) updated.")

    return 0


def _print_ghosts(ghosts: list) -> None:
    print(f"\n[INFO] Ghost entries ({len(ghosts)}) — "
          f"in Lump Viewer but no .lump on disk (not fatal):")
    for _lump_id, desc in ghosts:
        print(f"         • {desc}")


if __name__ == "__main__":
    sys.exit(main())
