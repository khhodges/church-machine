#!/usr/bin/env python3
"""hardware/check_dmem_count.py — Pre-synthesis DMEM init count guard.

Computes N_INIT (the number of non-zero words written by the hw_init sequencer
at boot) from the current WUKONG_DEMO_NAMESPACE and WUKONG_DEMO_CLIST tables in
boot_rom.py and either prints it (default), saves it to a reference file
(--write), or checks it against a saved reference (--check).

Also checks that _TU_VERSION_CALL_3PKT in wukong_top.py matches
TU_VERSION_CALL_3PKT in wukong_bridge.py (in --check and default modes).
A mismatch means the bitstream will emit the wrong TU_VERSION sentinel byte,
causing the bridge to report wrong TraceUnit capability.

Run this before every Wukong bitstream synthesis to catch stale N_INIT or a
TU_VERSION split before the bitstream is built.

Exit codes
----------
  0 — counts match (or --write succeeded)
  1 — count mismatch or TU_VERSION mismatch (--check mode)
  2 — reference file missing (--check mode)

Usage
-----
  # Print current N_INIT, SHA, and TU_VERSION compatibility (diagnostic):
  python3 hardware/check_dmem_count.py

  # Save current N_INIT as the build reference before synthesis:
  python3 hardware/check_dmem_count.py --write

  # Assert N_INIT matches the saved reference AND TU_VERSION is consistent
  # (run as pre-synthesis gate):
  python3 hardware/check_dmem_count.py --check

Integrate into the build pipeline
----------------------------------
Add before efx_run / yosys / vivado synthesis:

  python3 hardware/check_dmem_count.py --check || exit 1

After updating boot_rom.py tables, update the reference and rebuild:

  python3 hardware/check_dmem_count.py --write
  # … then run the full synthesis
"""

import argparse
import hashlib
import os
import re
import sys

# Allow running from project root or from hardware/ directly.
# When run as `python3 hardware/check_dmem_count.py`, Python puts hardware/ on
# sys.path[0], not the project root.  We insert the project root explicitly so
# that `from hardware.boot_rom import ...` resolves correctly (hardware/ is a
# package with __init__.py).
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)   # project root
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

try:
    from hardware.boot_rom import WUKONG_DEMO_NAMESPACE, WUKONG_DEMO_CLIST
except ImportError as exc:
    print(f"ERROR: cannot import hardware.boot_rom: {exc}", file=sys.stderr)
    sys.exit(2)

_REF_FILE = os.path.join(_HERE, "wukong_dmem_count.ref")

# Paths to the two files whose TU_VERSION constants must stay in sync.
_WUKONG_TOP_PY    = os.path.join(_HERE, "wukong_top.py")
_WUKONG_BRIDGE_PY = os.path.join(_HERE, "wukong_bridge.py")


def _read_tu_version_const(filepath, varname):
    """Extract an integer constant ``varname = 0xNN`` from a Python source file.

    Uses a simple regex so that neither wukong_top.py (requires Amaranth) nor
    wukong_bridge.py (requires pyserial / requests) needs to be imported.

    Parameters
    ----------
    filepath : str
        Absolute path to the Python source file.
    varname : str
        Exact variable name to look up (e.g. ``'_TU_VERSION_CALL_3PKT'``).

    Returns
    -------
    int
        The constant's value.

    Raises
    ------
    FileNotFoundError
        If the file does not exist or cannot be opened.
    ValueError
        If the pattern is not found in the file.
    """
    pattern = re.compile(
        rf'^\s*{re.escape(varname)}\s*=\s*(0x[0-9A-Fa-f]+|\d+)',
        re.MULTILINE,
    )
    try:
        with open(filepath) as f:
            src = f.read()
    except OSError as exc:
        raise FileNotFoundError(f"Cannot open {filepath!r}: {exc}") from exc
    m = pattern.search(src)
    if not m:
        raise ValueError(
            f"Cannot find {varname!r} in {filepath!r} — "
            "pattern expected: '<varname> = 0xNN' or '<varname> = NN'"
        )
    return int(m.group(1), 0)


def _check_tu_version_compat(*, fatal):
    """Compare TU_VERSION constants between wukong_top.py and wukong_bridge.py.

    Parameters
    ----------
    fatal : bool
        If True, print to stderr and sys.exit(1) on mismatch or read error.
        If False, print diagnostics and return (ok, top_val, bridge_val).

    Returns
    -------
    tuple[bool, int | None, int | None]
        (compatible, tu_top, tu_bridge)  — tu_* are None on read error.
    """
    try:
        tu_top = _read_tu_version_const(_WUKONG_TOP_PY,    '_TU_VERSION_CALL_3PKT')
        tu_bridge = _read_tu_version_const(_WUKONG_BRIDGE_PY, 'TU_VERSION_CALL_3PKT')
    except (FileNotFoundError, ValueError) as exc:
        msg = f"ERROR: TU_VERSION check failed: {exc}"
        if fatal:
            print(msg, file=sys.stderr)
            sys.exit(1)
        print(f"  WARNING: {msg}")
        return False, None, None

    ok = (tu_top == tu_bridge)
    if fatal and not ok:
        print("FAIL: TU_VERSION mismatch — bitstream will emit wrong capability byte!",
              file=sys.stderr)
        print(f"  wukong_top.py    _TU_VERSION_CALL_3PKT = 0x{tu_top:02X}",
              file=sys.stderr)
        print(f"  wukong_bridge.py TU_VERSION_CALL_3PKT  = 0x{tu_bridge:02X}",
              file=sys.stderr)
        print("", file=sys.stderr)
        print("  The bitstream sentinel byte and bridge expectation are out of sync.",
              file=sys.stderr)
        print("  Update both constants to the same value, then rebuild the bitstream.",
              file=sys.stderr)
        sys.exit(1)
    return ok, tu_top, tu_bridge


def _compute_dmem_init():
    """Return (n_init, sha256_hex) matching wukong_top.py hw_init_pairs."""
    dmem_init = list(WUKONG_DEMO_NAMESPACE)
    while len(dmem_init) < 256:
        dmem_init.append(0)
    dmem_init += list(WUKONG_DEMO_CLIST)
    while len(dmem_init) < 16384:
        dmem_init.append(0)

    hw_init_pairs = [(addr, val) for addr, val in enumerate(dmem_init) if val != 0]
    n_init = len(hw_init_pairs)

    h = hashlib.sha256()
    for addr, val in hw_init_pairs:
        h.update(addr.to_bytes(2, 'big'))
        h.update(val.to_bytes(4, 'big'))
    return n_init, h.hexdigest()


def _load_ref():
    """Return (n_init, sha) from the reference file, or raise FileNotFoundError."""
    with open(_REF_FILE) as f:
        lines = [l.strip() for l in f if l.strip() and not l.startswith('#')]
    if len(lines) < 2:
        raise ValueError(f"Malformed reference file {_REF_FILE!r}: expected 2 data lines")
    return int(lines[0]), lines[1]


def _save_ref(n_init, sha):
    with open(_REF_FILE, 'w') as f:
        f.write("# Wukong DMEM init count reference — generated by check_dmem_count.py\n")
        f.write("# Lines: N_INIT  SHA256-of-hw_init_pairs\n")
        f.write(f"{n_init}\n")
        f.write(f"{sha}\n")


def main():
    ap = argparse.ArgumentParser(description='Wukong DMEM init count guard')
    grp = ap.add_mutually_exclusive_group()
    grp.add_argument('--write', action='store_true',
                     help='Save current N_INIT as the build reference')
    grp.add_argument('--check', action='store_true',
                     help='Assert N_INIT matches saved reference (pre-synthesis gate)')
    args = ap.parse_args()

    n_init, sha = _compute_dmem_init()

    if args.write:
        _save_ref(n_init, sha)
        print(f"Saved reference: N_INIT={n_init}  SHA={sha[:16]}…")
        print(f"  → {_REF_FILE}")
        return

    if args.check:
        try:
            ref_n, ref_sha = _load_ref()
        except FileNotFoundError:
            print(f"ERROR: reference file not found: {_REF_FILE}", file=sys.stderr)
            print("Run `python3 hardware/check_dmem_count.py --write` after your last "
                  "synthesis to create the reference.", file=sys.stderr)
            sys.exit(2)

        n_init_ok = (n_init == ref_n) and (sha == ref_sha)
        if n_init_ok:
            print(f"OK: N_INIT={n_init}  SHA={sha[:16]}…  matches reference")
        else:
            print("FAIL: DMEM init count mismatch — bitstream may be stale!", file=sys.stderr)
            print(f"  Expected: N_INIT={ref_n}  SHA={ref_sha[:16]}…", file=sys.stderr)
            print(f"  Current:  N_INIT={n_init}  SHA={sha[:16]}…", file=sys.stderr)
            print("", file=sys.stderr)
            if n_init != ref_n:
                print(f"  N_INIT changed by {n_init - ref_n:+d} words.", file=sys.stderr)
                print("  WUKONG_DEMO_NAMESPACE or WUKONG_DEMO_CLIST has grown/shrunk.", file=sys.stderr)
            else:
                print("  N_INIT is unchanged but content differs.", file=sys.stderr)
                print("  A DMEM word value changed without an N_INIT change.", file=sys.stderr)
            print("", file=sys.stderr)
            print("Action: rebuild the bitstream, then run:", file=sys.stderr)
            print("  python3 hardware/check_dmem_count.py --write", file=sys.stderr)
            # Do not exit yet — fall through to TU_VERSION check so all failures
            # are reported in a single run.

        # ── TU_VERSION compatibility check ────────────────────────────────────
        # _check_tu_version_compat(fatal=True) exits non-zero on mismatch.
        # We call it unconditionally so a TU_VERSION split is always reported,
        # even when the N_INIT check already failed above.
        tu_ok, tu_top, tu_bridge = _check_tu_version_compat(fatal=False)
        if tu_ok:
            print(f"OK: TU_VERSION=0x{tu_top:02X}  wukong_top.py == wukong_bridge.py  ✓")
        elif tu_top is not None:
            # Already printed detailed error in _check_tu_version_compat.
            print("FAIL: TU_VERSION mismatch — bitstream will emit wrong capability byte!",
                  file=sys.stderr)
            print(f"  wukong_top.py    _TU_VERSION_CALL_3PKT = 0x{tu_top:02X}",
                  file=sys.stderr)
            print(f"  wukong_bridge.py TU_VERSION_CALL_3PKT  = 0x{tu_bridge:02X}",
                  file=sys.stderr)
            print("", file=sys.stderr)
            print("  The bitstream sentinel byte and bridge expectation are out of sync.",
                  file=sys.stderr)
            print("  Update both constants to the same value, then rebuild the bitstream.",
                  file=sys.stderr)
        # else: read error already printed a warning in _check_tu_version_compat.

        if not n_init_ok or not tu_ok:
            sys.exit(1)
        return

    # Default: print for diagnostic / build-log embedding.
    print(f"N_INIT={n_init}  SHA={sha}")
    print(f"  N_INIT & 0xFF = 0x{n_init & 0xFF:02X}  "
          f"(boot sentinel byte baked into bitstream)")
    print(f"  NAMESPACE words: {len([v for v in WUKONG_DEMO_NAMESPACE if v != 0])}"
          f"  CLIST words: {len([v for v in WUKONG_DEMO_CLIST if v != 0])}")
    ref_path = _REF_FILE
    if os.path.exists(ref_path):
        try:
            ref_n, ref_sha = _load_ref()
            match = "✓ matches reference" if (n_init == ref_n and sha == ref_sha) \
                    else "✗ DIFFERS from reference — rebuild needed"
            print(f"  Reference: N_INIT={ref_n}  {match}")
        except Exception as e:
            print(f"  (Could not read reference: {e})")
    else:
        print(f"  (No reference file — run --write after synthesis)")

    # TU_VERSION diagnostic (non-fatal in default mode — just inform the user).
    tu_ok, tu_top, tu_bridge = _check_tu_version_compat(fatal=False)
    if tu_ok and tu_top is not None:
        print(f"  TU_VERSION=0x{tu_top:02X}  ✓ wukong_top.py == wukong_bridge.py")
    elif tu_top is not None:
        print(f"  TU_VERSION MISMATCH: wukong_top.py=0x{tu_top:02X}  "
              f"wukong_bridge.py=0x{tu_bridge:02X}  ✗ (run --check for details)")


if __name__ == '__main__':
    main()
