"""CI gate: NS-table catalog purity checks.

Task #954: Block mixed-permission NS-table entries.

Two suites:

Suite 1 — Python catalog (server/boot_image.py DEFAULT_ABSTRACTION_CATALOG):
  P1  Every non-null entry is domain-pure  (no entry mixes Turing {R,W,X} with
      Church {L,S,E}).
  P2  Every non-null entry carries at most one Church permission bit.

Suite 2 — Simulator catalog cross-check (simulator/simulator.js
          _getHardwareBootCatalog() via Node):
  S1  The simulator catalog has exactly 8 entries (same length as Python).
  S2  Every non-null simulator entry is domain-pure.
  S3  Every non-null simulator entry has at most one Church permission bit.
  S4  Every non-null entry in both catalogs agrees on label and perms
      (no drift between server and simulator).

Failure messages are self-diagnosing: they identify the slot index, entry
name, and which permission bits caused the violation.
"""

import json
import os
import subprocess
import sys

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CATALOG_HARNESS = os.path.join(ROOT, 'tests', 'gt', 'catalog_harness.js')

sys.path.insert(0, os.path.join(ROOT, 'server'))
from boot_image import DEFAULT_ABSTRACTION_CATALOG


# ---------------------------------------------------------------------------
# Permission rule helpers (mirror simulator.js static methods exactly)
# ---------------------------------------------------------------------------

def _perm_bits_str(perms):
    out = ''
    for k in ('B', 'R', 'W', 'X', 'L', 'S', 'E'):
        if perms.get(k):
            out += k
    return out


def _is_domain_pure(perms):
    """Return (ok, bits_str).  ok=False when Turing and Church bits coexist."""
    has_turing = perms.get('R') or perms.get('W') or perms.get('X')
    has_church  = perms.get('L') or perms.get('S') or perms.get('E')
    if has_turing and has_church:
        return False, _perm_bits_str(perms)
    return True, ''


def _is_single_perm(perms):
    """Return (ok, bits_str).  ok=False when >1 Church bit is set."""
    has_church = perms.get('L') or perms.get('S') or perms.get('E')
    if not has_church:
        return True, ''
    church_count = (1 if perms.get('L') else 0) + \
                   (1 if perms.get('S') else 0) + \
                   (1 if perms.get('E') else 0)
    if church_count > 1:
        bits = (('L' if perms.get('L') else '') +
                ('S' if perms.get('S') else '') +
                ('E' if perms.get('E') else ''))
        return False, bits
    return True, ''


# ---------------------------------------------------------------------------
# Simulator catalog loader
# ---------------------------------------------------------------------------

def _load_simulator_catalog():
    """Run catalog_harness.js via Node; return the parsed catalog list."""
    proc = subprocess.run(
        ['node', CATALOG_HARNESS],
        capture_output=True,
        timeout=30,
        cwd=ROOT,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f'catalog_harness.js exited {proc.returncode}\n'
            f'stderr:\n{proc.stderr.decode("utf-8", errors="replace")}'
        )
    out = proc.stdout.decode('utf-8', errors='replace').strip()
    try:
        return json.loads(out)
    except json.JSONDecodeError as e:
        raise RuntimeError(
            f'catalog_harness.js produced non-JSON output: {e}\nstdout:\n{out}'
        )


# ---------------------------------------------------------------------------
# Suite 1 — Python catalog (boot_image.py)
# ---------------------------------------------------------------------------

def test_python_catalog_domain_purity():
    """P1: Every non-null Python catalog entry must be domain-pure."""
    violations = []
    for slot, entry in enumerate(DEFAULT_ABSTRACTION_CATALOG):
        if entry is None:
            continue
        name, perms, _chainable = entry
        ok, bits = _is_domain_pure(perms)
        if not ok:
            violations.append(
                f'  slot {slot} "{name}": mixed Turing+Church bits ({bits})'
            )
    assert not violations, (
        'Domain-purity violations in DEFAULT_ABSTRACTION_CATALOG '
        '(boot_image.py):\n' + '\n'.join(violations)
    )


def test_python_catalog_single_church_perm():
    """P2: Every non-null Python catalog entry must have at most one Church bit."""
    violations = []
    for slot, entry in enumerate(DEFAULT_ABSTRACTION_CATALOG):
        if entry is None:
            continue
        name, perms, _chainable = entry
        ok, bits = _is_single_perm(perms)
        if not ok:
            violations.append(
                f'  slot {slot} "{name}": multiple Church bits ({bits})'
            )
    assert not violations, (
        'Single-Church-perm violations in DEFAULT_ABSTRACTION_CATALOG '
        '(boot_image.py):\n' + '\n'.join(violations)
    )


# ---------------------------------------------------------------------------
# Suite 2 — Simulator catalog (simulator.js _getAbstractionCatalog)
# ---------------------------------------------------------------------------

@pytest.fixture(scope='module')
def sim_catalog():
    return _load_simulator_catalog()


def test_simulator_catalog_length(sim_catalog):
    """S1: Simulator catalog has the same number of slots as the Python catalog."""
    expected = len(DEFAULT_ABSTRACTION_CATALOG)
    actual   = len(sim_catalog)
    assert actual == expected, (
        f'Simulator catalog has {actual} slots; expected {expected}. '
        f'Update both catalogs together when adding/removing NS slots.'
    )


def test_simulator_catalog_domain_purity(sim_catalog):
    """S2: Every non-null simulator catalog entry must be domain-pure."""
    violations = []
    for slot, entry in enumerate(sim_catalog):
        if entry is None:
            continue
        name  = entry.get('label', f'<slot {slot}>')
        perms = entry.get('perms', {})
        ok, bits = _is_domain_pure(perms)
        if not ok:
            violations.append(
                f'  slot {slot} "{name}": mixed Turing+Church bits ({bits})'
            )
    assert not violations, (
        'Domain-purity violations in simulator _getAbstractionCatalog() '
        '(simulator.js):\n' + '\n'.join(violations)
    )


def test_simulator_catalog_single_church_perm(sim_catalog):
    """S3: Every non-null simulator catalog entry must have at most one Church bit."""
    violations = []
    for slot, entry in enumerate(sim_catalog):
        if entry is None:
            continue
        name  = entry.get('label', f'<slot {slot}>')
        perms = entry.get('perms', {})
        ok, bits = _is_single_perm(perms)
        if not ok:
            violations.append(
                f'  slot {slot} "{name}": multiple Church bits ({bits})'
            )
    assert not violations, (
        'Single-Church-perm violations in simulator _getAbstractionCatalog() '
        '(simulator.js):\n' + '\n'.join(violations)
    )


def test_catalogs_agree(sim_catalog):
    """S4: Python and simulator catalogs agree on every slot (no drift)."""
    py_len  = len(DEFAULT_ABSTRACTION_CATALOG)
    sim_len = len(sim_catalog)
    length_ok = py_len == sim_len
    drift = []

    slots = min(py_len, sim_len)
    for slot in range(slots):
        py_entry  = DEFAULT_ABSTRACTION_CATALOG[slot]
        sim_entry = sim_catalog[slot]

        py_null  = py_entry  is None
        sim_null = sim_entry is None

        if py_null != sim_null:
            py_desc  = 'null' if py_null  else f'"{py_entry[0]}"'
            sim_desc = 'null' if sim_null else f'"{sim_entry.get("label")}"'
            drift.append(
                f'  slot {slot}: Python={py_desc}, simulator={sim_desc} '
                f'(null-presence mismatch)'
            )
            continue

        if py_null:
            continue

        py_name, py_perms, _chainable = py_entry
        sim_name  = sim_entry.get('label')
        sim_perms = sim_entry.get('perms', {})

        if py_name != sim_name:
            drift.append(
                f'  slot {slot}: name mismatch — Python="{py_name}", '
                f'simulator="{sim_name}"'
            )

        perm_keys = ('R', 'W', 'X', 'L', 'S', 'E')
        for k in perm_keys:
            pv = int(bool(py_perms.get(k)))
            sv = int(bool(sim_perms.get(k)))
            if pv != sv:
                drift.append(
                    f'  slot {slot} "{py_name}": perm "{k}" differs — '
                    f'Python={pv}, simulator={sv}'
                )

        py_chainable  = bool(_chainable)
        sim_chainable = bool(sim_entry.get('chainable'))
        if py_chainable != sim_chainable:
            drift.append(
                f'  slot {slot} "{py_name}": chainable differs — '
                f'Python={py_chainable}, simulator={sim_chainable}'
            )

    if not length_ok:
        drift.append(
            f'  catalog length: Python={py_len}, simulator={sim_len}'
        )

    assert not drift, (
        'Python (boot_image.py) and simulator (simulator.js) catalogs have '
        'drifted apart:\n' + '\n'.join(drift)
    )
