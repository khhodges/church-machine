"""Shared fixtures for tests/boot/.

Boot tests use per-session copies of the canonical LUMP library and saved boot
configuration.  This lets them install a synthetic Boot.Abstr LUMP and
exercise save/upload endpoints without changing IDE runtime state in the
working tree.
"""
import contextlib
import fcntl
import math
import os
import shutil
import struct
import sys

import pytest

ROOT      = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LIVE_LUMPS_DIR = os.path.join(ROOT, "server", "lumps")
LIVE_BOOT_CONFIG_PATH = os.path.join(ROOT, "server", "boot-config.json")


# ── Cross-process write lock for the live server/lumps/ directory ────────────
# The all-tests runner starts several pytest sessions in parallel.  Any test
# (or fixture) that MUTATES the live server/lumps/ directory must hold this
# exclusive lock for the full mutate-then-restore span, so that two
# cooperating writers can never interleave snapshot/restore cycles.
#
# Guarantee and limits: this serializes only *cooperating* lock holders
# (tests/fixtures that call lumps_write_lock()).  It cannot protect against
# non-cooperating writers such as a live dev server process; do not run the
# destructive suites while the IDE server is actively saving lumps.
_LUMPS_LOCK_PATH = os.path.join(ROOT, "server", ".lumps.write.lock")


@contextlib.contextmanager
def lumps_write_lock():
    """Exclusive cross-process lock for mutations of the live server/lumps/."""
    fh = open(_LUMPS_LOCK_PATH, "a+")
    try:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
        fh.close()


_BOOT_ABSTR_NS_SLOT = 6
_LUMP_SIZE          = 64          # words — must match BOOT_ABSTR_DEFAULT_SIZE
_LUMP_FILENAME      = f"{_BOOT_ABSTR_NS_SLOT << 8:08x}.lump"   # "00000600.lump"
def _make_synthetic_lump(lump_size: int = _LUMP_SIZE, cw: int = 3, cc: int = 0) -> bytes:
    """Return a minimal valid big-endian Boot.Abstr lump binary.

    Header: magic=0x1F, n_minus_6 derived from lump_size, cw, cc.
    All code/data words are zero (the lump body is not executed by these tests).
    This matches what generate_boot_image() embeds from the real SelfTest lump
    in terms of header layout and NS entry values.
    """
    n_minus_6 = max(0, math.ceil(math.log2(lump_size)) - 6)
    hdr       = (0x1F << 27) | (n_minus_6 << 23) | (cw << 10) | cc
    words     = [0] * lump_size
    words[0]  = hdr
    return struct.pack(f">{lump_size}I", *words)


def _redirect_boot_module_paths(
    source_dir: str,
    isolated_dir: str,
    exact_path_replacements: dict[str, str],
) -> list[tuple[object, str, str]]:
    """Point boot-test path constants at private storage and return originals.

    Test modules intentionally keep their LUMP directory constants simple so
    their image assertions are readable.  They are imported before session
    fixtures run, therefore redirect their already-created path constants here
    rather than making every individual test thread a fixture argument through
    its helpers.
    """
    changed: list[tuple[object, str, str]] = []
    source_prefix = source_dir + os.sep
    boot_tests_dir = os.path.join(ROOT, "tests", "boot") + os.sep

    for module in tuple(sys.modules.values()):
        module_file = getattr(module, "__file__", "") or ""
        if not os.path.abspath(module_file).startswith(boot_tests_dir):
            continue
        for name, value in tuple(vars(module).items()):
            if not isinstance(value, str):
                continue
            if value in exact_path_replacements:
                replacement = exact_path_replacements[value]
            elif value == source_dir:
                replacement = isolated_dir
            elif value.startswith(source_prefix):
                replacement = os.path.join(isolated_dir, value[len(source_prefix):])
            else:
                continue
            setattr(module, name, replacement)
            changed.append((module, name, value))
    return changed


@pytest.fixture(scope="session", autouse=True)
def isolated_boot_lumps(tmp_path_factory):
    """Give every boot test session a private copy of ``server/lumps/``.

    The direct-dispatch tests need a Boot.Abstr binary even in a fresh checkout.
    The synthetic binary is written only to this copy.  Flask state and
    boot-test module constants and server persistence paths are redirected as
    well, so save/upload coverage cannot leak a manifest, LUMP artifact, or
    boot configuration change into the live IDE state.
    """
    isolated_dir = str(tmp_path_factory.mktemp("boot_lumps"))
    shutil.copytree(LIVE_LUMPS_DIR, isolated_dir, symlinks=True, dirs_exist_ok=True)
    boot_state_dir = str(tmp_path_factory.mktemp("boot_state"))
    isolated_boot_config_path = os.path.join(boot_state_dir, "boot-config.json")
    if os.path.exists(LIVE_BOOT_CONFIG_PATH):
        shutil.copy2(LIVE_BOOT_CONFIG_PATH, isolated_boot_config_path)

    synthetic_path = os.path.join(isolated_dir, _LUMP_FILENAME)
    if not os.path.exists(synthetic_path):
        with open(synthetic_path, "wb") as fh:
            fh.write(_make_synthetic_lump())

    changed_modules = _redirect_boot_module_paths(
        LIVE_LUMPS_DIR,
        isolated_dir,
        {LIVE_BOOT_CONFIG_PATH: isolated_boot_config_path},
    )

    import server.app as app_module

    app_paths = {
        "LUMPS_DIR": isolated_dir,
        "LUMPS_MANIFEST_PATH": os.path.join(isolated_dir, "manifest.json"),
        "BOOT_IMAGE_PATH": os.path.join(isolated_dir, "boot-image.bin"),
        "NS_STATE_PATH": os.path.join(isolated_dir, "ns-state.json"),
        "BOOT_CONFIG_PATH": isolated_boot_config_path,
        "_LUMPS_DIR": isolated_dir,
    }
    original_app_paths = {
        name: getattr(app_module, name)
        for name in app_paths
        if hasattr(app_module, name)
    }
    for name, value in app_paths.items():
        if name in original_app_paths:
            setattr(app_module, name, value)

    try:
        yield isolated_dir
    finally:
        for module, name, value in reversed(changed_modules):
            setattr(module, name, value)
        for name, value in original_app_paths.items():
            setattr(app_module, name, value)
