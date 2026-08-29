#!/usr/bin/env python3
"""Pre-synthesis audit for the active namespace/thread hardware contract.

This intentionally checks the live Python sources rather than copied comments
or legacy generated files.  If generated artifacts exist, they must contain
the source fingerprint emitted by the generation path; an unstamped artifact
is rejected rather than assumed current.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from hardware.boot_rom import (  # noqa: E402
    NS_SLOT_COUNT,
    WUKONG_DEMO_CLIST,
    WUKONG_DEMO_NAMESPACE,
    WUKONG_THREAD_BASE_WORD,
    WUKONG_THREAD_CAPS0_WORD,
    WUKONG_THREAD_CAPS12_WORD,
    WUKONG_THREAD_HEADER,
    WUKONG_THREAD_STO_INIT,
    WUKONG_THREAD_STO_WORD,
    make_gt,
)
from hardware.hw_types import (  # noqa: E402
    GT_TYPE_INFORM,
    PERM_MASK_E,
    PERM_MASK_S,
    NS_TABLE_BASE,
    SELFTEST_NS_SLOT,
)
from hardware.layouts import (  # noqa: E402
    CAP_REG_LAYOUT,
    GT_LAYOUT,
    WORD2_LAYOUT,
)
from hardware.readiness import (  # noqa: E402
    CORE_SOURCES,
    WUKONG_SOURCES,
    artifact_is_fresh,
)


def _fail(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def check_contract() -> list[str]:
    """Return human-readable checks; raise on the first concrete mismatch."""
    checks = []
    _fail_if = _fail

    _fail_if(GT_LAYOUT.size == 32, f"GT layout is {GT_LAYOUT.size} bits, expected 32")
    _fail_if(CAP_REG_LAYOUT.size == 96, "capability register is not three 32-bit words")
    _fail_if(WORD2_LAYOUT.size == 32, "namespace authority word is not 32 bits")
    _fail_if(len(WUKONG_DEMO_NAMESPACE) == NS_SLOT_COUNT * 4,
             "Wukong namespace is not exactly four words per slot")
    _fail_if(len(WUKONG_DEMO_CLIST) >= 11, "boot c-list lost its canonical entries")

    # The active Wukong image uses a compact forward table at DMEM word zero.
    # The general simulator uses an inverted table at the top of memory; these
    # are distinct projections, not interchangeable address formulas.
    _fail_if(NS_TABLE_BASE > 0, "canonical namespace base must be non-zero")
    # Wukong deliberately projects the root table to byte address zero.
    for slot in range(NS_SLOT_COUNT):
        word0 = WUKONG_DEMO_NAMESPACE[slot * 4]
        word1 = WUKONG_DEMO_NAMESPACE[slot * 4 + 1]
        word2 = WUKONG_DEMO_NAMESPACE[slot * 4 + 2]
        expected = __import__("hardware.integrity32", fromlist=["integrity32"]).integrity32(
            word0, word1
        )
        _fail_if(word2 == expected, f"NS slot {slot} integrity does not match W0/W1")
        _fail_if(WUKONG_DEMO_NAMESPACE[slot * 4 + 3] == 0,
                 f"NS slot {slot} has a non-zero authoritative W3 token")

    _fail_if(WUKONG_DEMO_NAMESPACE[SELFTEST_NS_SLOT * 4] == 0x600,
             "SelfTest entry is not at the canonical Wukong location")
    _fail_if(WUKONG_THREAD_BASE_WORD > 0, "thread lump must not overlap the NS root")
    _fail_if(WUKONG_THREAD_STO_WORD == WUKONG_THREAD_BASE_WORD + 17,
             "protected Thread STO is not at reserved offset +17")
    _fail_if(WUKONG_THREAD_CAPS0_WORD == WUKONG_THREAD_BASE_WORD + 244,
             "Thread.caps[0] is not at the fixed +244 offset")
    _fail_if(WUKONG_THREAD_CAPS12_WORD == WUKONG_THREAD_BASE_WORD + 256,
             "Thread.caps[12] is not at the fixed +256 offset")
    _fail_if(WUKONG_THREAD_STO_INIT > 0, "boot thread STO must be a non-zero stack sentinel")
    _fail_if(WUKONG_THREAD_HEADER != 0, "boot thread header must be present")
    _fail_if(WUKONG_DEMO_CLIST[0] == make_gt(GT_TYPE_INFORM, PERM_MASK_E, SELFTEST_NS_SLOT),
             "boot c-list entry 0 is not the SelfTest E-GT")
    checks.append("namespace width, integrity, reserved slots, and thread offsets")
    return checks


def check_artifacts(build_dir: Path | str = ROOT / "build") -> list[str]:
    """Check generated artifacts in *build_dir* for current source stamps.

    The default keeps the pre-synthesis command pointed at the repository
    build directory, while the explicit path makes the same gate usable by
    generation tests and isolated build pipelines.
    """
    build_dir = Path(build_dir)
    checks = []
    for filename, sources in (
        ("church_core.v", CORE_SOURCES),
        ("church_core_iot.v", CORE_SOURCES),
        ("church_wukong_xc7a100t.il", WUKONG_SOURCES),
        ("church_wukong_xc7a100t.v", WUKONG_SOURCES),
    ):
        path = build_dir / filename
        if path.exists():
            ok, detail = artifact_is_fresh(path, sources)
            if not ok:
                raise AssertionError(detail + "; regenerate before synthesis")
            checks.append(detail)
    return checks


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) > 1:
        print(
            "usage: check_hardware_namespace_thread_readiness.py [build_dir]",
            file=sys.stderr,
        )
        return 2
    build_dir = argv[0] if argv else ROOT / "build"
    try:
        messages = check_contract() + check_artifacts(build_dir)
    except (AssertionError, FileNotFoundError) as exc:
        print(f"hardware-readiness: FAIL: {exc}", file=sys.stderr)
        return 1
    print("hardware-readiness: PASS")
    for message in messages:
        print(f"  - {message}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())