"""Three-way LUMP consistency check: binary header <-> manifest.json <-> per-lump sidecar .json

CHANGE CONTROL GATE — this test must pass before any lump binary or metadata change is merged.

Rules enforced
--------------
R1   Every current .lump has valid header magic (bits[31:27] = 0x1F).
R2   Binary file size in words == header-declared lump_size.
R3   Every current .lump token has a manifest.json entry.
R4   No orphan sidecar .json (every non-archive <stem>.json needs a matching .lump).
R5   manifest.cw / cc / lump_size == binary header values.
R6   sidecar.cw / cc / lump_size == binary header values (for sidecars that exist).
R7   sidecar fields agree with manifest where both exist.  A sidecar-declared
     boot_resident flag must also be explicitly present and equal in manifest.json,
     because the boot-image generator reads only the manifest.
R8   No duplicate ns_slot values unless all claimants share the same non-null variant_group.
R9   RETIRED — ns_slot=null is implicitly dynamic; ns_slot_policy is optional/informational only.
R10  Every manifest entry with lump_size declared has a .lump file on disk.
R11  Every manifest entry with an explicit sidecar_file field has that file on
     disk.  Entries with lump_size but no sidecar_file emit a pytest warning so
     the gap stays visible without blocking CI.
R14  Every archive binary has a matching sidecar .json (both old <token>-vN and new <Name>_vN).
R16  A statically-slotted, system-baseline lump's `abstraction` field must name a
     currently-live entry in simulator/abstractions.js (catches abstraction-name
     drift after a rename, at build/merge time instead of only as a runtime toast).
R17  Every example-tab button in simulator/index.html whose tooltip label or display
     text is a case-insensitive match to a live abstraction name must use the exact
     registered casing (e.g. "LED Flash" not "LED flash" or "LED Control").
R18  Every top-level key of the knownPurposes dict in simulator/app-absdetail.js must
     name a currently-live entry in the abstraction registry (catches stale or
     wrongly-cased method-doc keys after an abstraction rename).
R20  Every manifest entry with a `dot_name` field must have a canonical-format
     `filename` ({Dot.Name}.{n}.{8hex}.lump), and recomputing sha256(dot_name_utf8
     + lump_bytes)[:8] must equal the Number segment in that filename (catches
     file renames or binary replacements that were not paired with a migration run).
R21  Every manifest entry with a `cw` or `cc` field whose .lump file is present
     on disk must have those fields agree with the decoded binary header.
     Skipped (not failed) when the .lump file is absent (WIP / not-yet-compiled
     entries).  This catches cw=0-style corruption for ALL manifest entries,
     including those that do not declare lump_size (which R5 skips).
R24  Every .lump file in server/lumps/ that is a symbolic link must resolve to a
     real regular file (broken/dangling symlinks are an immediate hard failure).
     Symlinks that resolve to a target outside the lumps directory are flagged as
     a pytest warning so the gap stays visible without blocking CI.
R24b Every .json file in server/lumps/ (sidecar and manifest) that is a symbolic
     link must resolve to a real regular file (broken/dangling symlinks are an
     immediate hard failure). Symlinks that resolve outside the lumps directory
     are flagged as a pytest warning.
R25b Every git-tracked archive .lump file (<token>-vN.lump, <Name>_vN.lump) with
     a valid LUMP header emits a pytest warning. Archives are exempt from the
     manifest-coverage requirement (R25), but a committed archive that was once
     a current binary deserves review before any cleanup sweep removes it.
     (Warning only — does not block CI.)

Failure messages are written to be self-diagnosing: they state what was found,
what was expected, and which file to correct.

Naming conventions supported
-----------------------------
Legacy:  <8hexchars>.lump        — primary file, <8hexchars>.json — sidecar
         <8hexchars>-vN.lump     — archive binary
New:     <AbsName>_vN.lump       — primary file (human-readable, N = current version)
         <AbsName>_vN.json       — sidecar
         <AbsName>_v(N-1).lump   — archive binary (previous versions)

The manifest entry's optional 'filename' / 'sidecar_file' fields point to the
actual files on disk.  When absent, the legacy <token>.*  naming is assumed.
"""

import hashlib
import json
import os
import re as _re
import struct
import subprocess

import warnings

import pytest

from tests.lump.lump_manifest_utils import build_manifest_filename_set as _build_manifest_filename_set_util

LUMPS_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "server", "lumps")
)

_SIMULATOR_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "simulator")
)
_INDEX_HTML     = os.path.join(_SIMULATOR_DIR, "index.html")
_ABSDETAIL_JS   = os.path.join(_SIMULATOR_DIR, "app-absdetail.js")

_DECORATOR_STRIP_RE = _re.compile(r"[\u2726\u2605\s]+$")


# ── R24b preflight: check .json symlinks before any module-level loading ───────
# This runs at collection time, before _load_manifest() is called, so that a
# dangling manifest.json or sidecar symlink produces a self-diagnosing R24b
# message rather than a raw FileNotFoundError from an unrelated rule.

def _check_json_symlinks(lumps_dir: str) -> list:
    """Return a list of (filename, target, resolved) for every dangling .json
    symlink found in *lumps_dir*.  Non-symlinks and resolving symlinks are
    not included.  Exported so regression tests can call it directly.
    """
    broken = []
    try:
        entries = sorted(os.listdir(lumps_dir))
    except FileNotFoundError:
        return broken
    for fn in entries:
        if not fn.endswith(".json"):
            continue
        path = os.path.join(lumps_dir, fn)
        if not os.path.islink(path):
            continue
        target = os.readlink(path)
        resolved = os.path.realpath(path)
        if not os.path.isfile(resolved):
            broken.append((fn, target, resolved))
    return broken


def _preflight_json_symlinks(lumps_dir: str = LUMPS_DIR) -> None:
    """Abort pytest collection if any .json file in *lumps_dir* is a dangling
    symlink.  Called immediately at module-import time so the guard fires
    before _load_manifest() and all other module-level discovery/loading.
    """
    broken = _check_json_symlinks(lumps_dir)
    if not broken:
        return
    lines = []
    for fn, target, resolved in broken:
        lines.append(
            f"  {fn}: dangling symlink — points to {target!r} "
            f"(resolved path: {resolved!r}).\n"
            "    Either restore the missing target file or delete this symlink.\n"
            "    Broken .json symlinks cause confusing FileNotFoundError failures\n"
            "    in manifest loading and other lump-consistency rules instead of\n"
            "    a clear R24b diagnostic."
        )
    pytest.exit(
        "R24b preflight: broken .json symlink(s) in "
        + lumps_dir
        + ":\n"
        + "\n".join(lines),
        returncode=1,
    )


_preflight_json_symlinks()


# ── Manifest + path helpers ────────────────────────────────────────────────────

def _load_manifest():
    with open(os.path.join(LUMPS_DIR, "manifest.json")) as f:
        return json.load(f)


MANIFEST = _load_manifest()

# Build per-token path info from the manifest.
# Keys: token.lower()  Values: dict(lump=path, sidecar=path, lump_stem=str)
_TOKEN_PATHS: dict = {}
for _me in MANIFEST:
    _tok = _me.get("token", "").lower()
    if not _tok:
        continue
    _fn  = _me.get("filename",     f"{_tok}.lump")
    _sfn = _me.get("sidecar_file", f"{_tok}.json")
    _TOKEN_PATHS[_tok] = {
        "lump":      os.path.join(LUMPS_DIR, _fn),
        "sidecar":   os.path.join(LUMPS_DIR, _sfn),
        "lump_stem": _fn[:-5] if _fn.endswith(".lump") else _tok,
    }

# Lowercase stems of every file that IS a "current" (non-archive) lump.
# A file is current if it is referenced by any manifest entry via 'filename'
# or if it matches a legacy token basename.
_MANIFEST_CURRENT_STEMS: set = set()
for _tok, _info in _TOKEN_PATHS.items():
    _MANIFEST_CURRENT_STEMS.add(_info["lump_stem"].lower())
    _MANIFEST_CURRENT_STEMS.add(_tok)          # legacy fallback stem


# ── Path-resolution helpers ────────────────────────────────────────────────────

def _lump_path(token: str) -> str:
    info = _TOKEN_PATHS.get(token.lower())
    return info["lump"] if info else os.path.join(LUMPS_DIR, f"{token.lower()}.lump")


def _sidecar_path(token: str) -> str:
    info = _TOKEN_PATHS.get(token.lower())
    return info["sidecar"] if info else os.path.join(LUMPS_DIR, f"{token.lower()}.json")


# ── Header / sidecar accessors ─────────────────────────────────────────────────

def _parse_header(word):
    magic   = (word >> 27) & 0x1F
    n_m6    = (word >> 23) & 0xF
    cw      = (word >> 10) & 0x1FFF
    typ     = (word >>  8) & 0x3
    cc      =  word        & 0xFF
    lump_sz = 1 << (n_m6 + 6)
    return dict(magic=magic, cw=cw, typ=typ, cc=cc, lump_sz=lump_sz, valid=(magic == 0x1F))


def _read_header(token: str):
    path = _lump_path(token)
    with open(path, "rb") as f:
        raw = f.read(4)
    if len(raw) < 4:
        return None
    return _parse_header(struct.unpack(">I", raw)[0])


def _word_count(token: str) -> int:
    return os.path.getsize(_lump_path(token)) // 4


def _load_sidecar(token: str):
    path = _sidecar_path(token)
    if not os.path.exists(path):
        path = os.path.join(LUMPS_DIR, f"{token.lower()}.json")
    if not os.path.exists(path):
        return None
    with open(path) as f:
        return json.load(f)


def _lump_exists(token: str) -> bool:
    return os.path.exists(_lump_path(token))


def _sidecar_exists(token: str) -> bool:
    return os.path.exists(_sidecar_path(token))


# ── Archive detection ──────────────────────────────────────────────────────────

def _is_archive_stem(stem: str) -> bool:
    """Return True if *stem* (filename without extension) is an archive, not a current lump.

    Recognises two patterns:
      - Legacy:  <8hexchars>-v<N>  (e.g. 95a651e7-v4)
      - New:     <AbsName>_v<N>    (e.g. NoteG_v5) when not a current manifest file
    """
    s = stem.lower()
    if _re.match(r'^[0-9a-f]{8}-v\d+$', s):
        return True
    if _re.match(r'^.+_v\d+$', s):
        return s not in _MANIFEST_CURRENT_STEMS
    return False


def _lump_tokens():
    """Return sorted list of manifest tokens for all non-archive .lump files on disk.

    Files are mapped back to their manifest token where possible; otherwise the
    lowercase file stem is used as the token.
    """
    stem_to_token = {info["lump_stem"].lower(): tok for tok, info in _TOKEN_PATHS.items()}
    result = set()
    for fn in os.listdir(LUMPS_DIR):
        if not fn.endswith(".lump"):
            continue
        stem = fn[:-5]
        if _is_archive_stem(stem):
            continue
        tok = stem_to_token.get(stem.lower()) or stem.lower()
        result.add(tok)
    return sorted(result)


def _json_tokens():
    """Return sorted list of manifest tokens for all non-archive .json files (exc. manifest)."""
    sc_stem_to_token: dict = {}
    for tok, info in _TOKEN_PATHS.items():
        sc_stem = info["sidecar"][len(LUMPS_DIR) + 1:]
        if sc_stem.endswith(".json"):
            sc_stem_to_token[sc_stem[:-5].lower()] = tok
        sc_stem_to_token[tok] = tok  # legacy
    result = set()
    for fn in os.listdir(LUMPS_DIR):
        if not fn.endswith(".json") or fn in ("manifest.json", "server_managed_tokens.json",
                                               "ns-state.json"):
            continue
        stem = fn[:-5]
        if _is_archive_stem(stem):
            continue
        tok = sc_stem_to_token.get(stem.lower()) or stem.lower()
        result.add(tok)
    return sorted(result)


def _archive_lump_stems():
    """Return sorted list of archive base stems (without .lump) found on disk.

    Includes both legacy <token>-vN and new <AbsName>_vN archives.
    """
    result = []
    for fn in os.listdir(LUMPS_DIR):
        if fn.endswith(".lump") and _is_archive_stem(fn[:-5]):
            result.append(fn[:-5])
    return sorted(result)


# ── Module-level parametrize targets ──────────────────────────────────────────

LUMP_TOKENS             = _lump_tokens()
JSON_TOKENS             = _json_tokens()
MANIFEST_ENTRIES_WITH_SIZE = [e for e in MANIFEST if e.get("lump_size")]
MANIFEST_ENTRIES_WITH_CW_OR_CC = [
    e for e in MANIFEST
    if e.get("cw") is not None or e.get("cc") is not None
]
ARCHIVE_LUMP_STEMS      = _archive_lump_stems()


# ═══════════════════════════════════════════════════════════════════════════════
# Test classes
# ═══════════════════════════════════════════════════════════════════════════════

class TestR1_ValidMagic:
    """R1: Every current .lump has valid header magic (0x1F)."""

    @pytest.mark.parametrize("token", LUMP_TOKENS)
    def test_header_magic(self, token):
        h = _read_header(token)
        assert h is not None, (
            f"{token}: lump file is too short to contain a header word."
        )
        assert h["valid"], (
            f"{token}: header magic = {h['magic']:#04x}, expected 0x1F.\n"
            "  bits[31:27] must equal 11111b. Repack the binary with the correct header."
        )


class TestR2_FileSizeMatchesHeader:
    """R2: Binary file size in words == header-declared lump_size."""

    @pytest.mark.parametrize("token", LUMP_TOKENS)
    def test_file_size(self, token):
        h = _read_header(token)
        actual = _word_count(token)
        assert actual == h["lump_sz"], (
            f"{token}: file has {actual} words but header declares "
            f"lump_size = {h['lump_sz']} (n_minus_6 encodes a different size).\n"
            "  Repack the binary or correct the n_minus_6 field in the header word."
        )


class TestR3_LumpHasManifestEntry:
    """R3: Every current .lump file is accounted for in manifest.json."""

    # Canonical source: server/lumps/server_managed_tokens.json — edit that file
    # (one place only) when a new server-managed token is added.
    _SERVER_MANAGED_TOKENS: frozenset = frozenset(
        t.lower()
        for t in json.load(
            open(os.path.join(LUMPS_DIR, "server_managed_tokens.json"))
        ).get("tokens", [])
    )

    def test_all_lumps_in_manifest(self):
        manifest_keys: set = set()
        for e in MANIFEST:
            manifest_keys.add(e.get("token", "").lower())
            fn = e.get("filename", "")
            if fn and fn.endswith(".lump"):
                manifest_keys.add(fn[:-5].lower())
        orphans = set(LUMP_TOKENS) - manifest_keys - self._SERVER_MANAGED_TOKENS
        assert not orphans, (
            f"Lump binaries with no manifest.json entry: {sorted(orphans)}\n"
            "  Add an entry to manifest.json or delete the stale .lump file.\n"
            f"  (Server-managed tokens exempt from R3: {sorted(self._SERVER_MANAGED_TOKENS)})"
        )


class TestR4_NoOrphanSidecars:
    """R4: No orphan sidecar .json without a matching current .lump."""

    def test_no_orphan_sidecars(self):
        orphans = set(JSON_TOKENS) - set(LUMP_TOKENS)
        assert not orphans, (
            f"Sidecar .json files with no matching .lump: {sorted(orphans)}\n"
            "  Either supply the missing .lump binary or delete the stale sidecar."
        )


class TestR5_ManifestMatchesBinary:
    """R5: manifest.cw / cc / lump_size == binary header values."""

    @pytest.mark.parametrize("entry", MANIFEST_ENTRIES_WITH_SIZE, ids=lambda e: e["token"])
    def test_manifest_cw(self, entry):
        token = entry["token"].lower()
        if not _lump_exists(token):
            pytest.skip(f"lump file absent for {token} (covered by R10)")
        h = _read_header(token)
        assert entry["cw"] == h["cw"], (
            f"{token}: manifest.cw = {entry['cw']} but binary header cw = {h['cw']}.\n"
            "  Update manifest.json to match the compiled binary, then bump CHANGELOG."
        )

    @pytest.mark.parametrize("entry", MANIFEST_ENTRIES_WITH_SIZE, ids=lambda e: e["token"])
    def test_manifest_cc(self, entry):
        token = entry["token"].lower()
        if not _lump_exists(token):
            pytest.skip(f"lump file absent for {token} (covered by R10)")
        h = _read_header(token)
        assert entry["cc"] == h["cc"], (
            f"{token}: manifest.cc = {entry['cc']} but binary header cc = {h['cc']}.\n"
            "  Update manifest.json to match the compiled binary, then bump CHANGELOG."
        )

    @pytest.mark.parametrize("entry", MANIFEST_ENTRIES_WITH_SIZE, ids=lambda e: e["token"])
    def test_manifest_lump_size(self, entry):
        token = entry["token"].lower()
        if not _lump_exists(token):
            pytest.skip(f"lump file absent for {token} (covered by R10)")
        h = _read_header(token)
        assert entry["lump_size"] == h["lump_sz"], (
            f"{token}: manifest.lump_size = {entry['lump_size']} but binary header "
            f"lump_size = {h['lump_sz']}.\n"
            "  Update manifest.json, then bump CHANGELOG."
        )


class TestR6_SidecarMatchesBinary:
    """R6: sidecar cw / cc / lump_size == binary header values."""

    @pytest.mark.parametrize("token", JSON_TOKENS)
    def test_sidecar_cw(self, token):
        if not _lump_exists(token):
            pytest.skip(f"lump file absent for {token}")
        sc = _load_sidecar(token)
        h  = _read_header(token)
        if sc and sc.get("cw") is not None:
            assert sc["cw"] == h["cw"], (
                f"{token}: sidecar.cw = {sc['cw']} but binary header cw = {h['cw']}.\n"
                "  Update the sidecar to match the compiled binary, then bump CHANGELOG."
            )

    @pytest.mark.parametrize("token", JSON_TOKENS)
    def test_sidecar_cc(self, token):
        if not _lump_exists(token):
            pytest.skip(f"lump file absent for {token}")
        sc = _load_sidecar(token)
        h  = _read_header(token)
        if sc and sc.get("cc") is not None:
            assert sc["cc"] == h["cc"], (
                f"{token}: sidecar.cc = {sc['cc']} but binary header cc = {h['cc']}.\n"
                "  Update the sidecar to match the compiled binary, then bump CHANGELOG."
            )

    @pytest.mark.parametrize("token", JSON_TOKENS)
    def test_sidecar_lump_size(self, token):
        if not _lump_exists(token):
            pytest.skip(f"lump file absent for {token}")
        sc = _load_sidecar(token)
        h  = _read_header(token)
        if sc and sc.get("lump_size") is not None:
            assert sc["lump_size"] == h["lump_sz"], (
                f"{token}: sidecar.lump_size = {sc['lump_size']} but binary header "
                f"lump_size = {h['lump_sz']}.\n"
                "  Update the sidecar, then bump CHANGELOG."
            )


def _resolve_ns_slot_policy(ns_slot, policy):
    """Semantic normalization of ns_slot_policy per the retired-R9 rule.

    For null slots: absent means 'dynamic' (R9 retired).
    For fixed slots: absent means 'static' (Resident/Lazy-load convention).
    """
    if policy is not None:
        return policy
    if ns_slot is None:
        return "dynamic"
    return "static"


class TestR7_SidecarMatchesManifest:
    """R7: sidecar fields agree with manifest where both are present.

    Checked fields: cw, cc, lump_size, ns_slot, abstraction, lump_version,
    and ns_slot_policy (with semantic normalization: absent = dynamic for null
    slots, absent = static for fixed slots — R9 retired).  boot_resident is
    manifest-owned: if a sidecar declares it, manifest.json must explicitly
    declare the same value so the boot-image generator cannot omit its body.
    """

    @pytest.mark.parametrize("entry", MANIFEST, ids=lambda e: e["token"])
    def test_sidecar_vs_manifest(self, entry):
        token = entry["token"].lower()
        sc = _load_sidecar(token)
        if sc is None:
            return
        for field in ("cw", "cc", "lump_size", "ns_slot", "abstraction", "lump_version"):
            m_val = entry.get(field)
            s_val = sc.get(field)
            if m_val is not None and s_val is not None:
                assert m_val == s_val, (
                    f"{token}: manifest.{field} = {m_val!r} but sidecar.{field} = {s_val!r}.\n"
                    "  The two must agree. Update whichever is stale, then bump CHANGELOG."
                )
        if "boot_resident" in sc:
            m_val = entry.get("boot_resident")
            s_val = sc["boot_resident"]
            abstraction = entry.get("abstraction") or entry.get("dot_name") or token
            assert "boot_resident" in entry and m_val == s_val, (
                f"{abstraction}: manifest.boot_resident = {m_val!r} but "
                f"sidecar.boot_resident = {s_val!r}.\n"
                "  boot_resident is read only from manifest.json when generating "
                "the boot image. Add the sidecar value to the manifest entry (or "
                "align the two values) so this LUMP body is not silently omitted."
            )
        # ns_slot_policy: always compare resolved values so absent-vs-static (null slot) is caught
        ns_slot = entry.get("ns_slot")
        if entry.get("ns_slot_policy") is not None or sc.get("ns_slot_policy") is not None:
            m_policy = _resolve_ns_slot_policy(ns_slot, entry.get("ns_slot_policy"))
            s_policy = _resolve_ns_slot_policy(sc.get("ns_slot"), sc.get("ns_slot_policy"))
            assert m_policy == s_policy, (
                f"{token}: manifest.ns_slot_policy resolves to {m_policy!r} but "
                f"sidecar.ns_slot_policy resolves to {s_policy!r}.\n"
                "  Align the two (add explicit ns_slot_policy to whichever is absent), "
                "then bump CHANGELOG."
            )


class TestR8_NoDuplicateNsSlots:
    """R8: No duplicate ns_slot values unless all claimants share the same non-null variant_group."""

    def test_ns_slot_uniqueness(self):
        slot_map: dict = {}
        for e in MANIFEST:
            slot = e.get("ns_slot")
            if slot is None:
                continue
            slot_map.setdefault(slot, []).append(e)

        conflicts = []
        for slot, entries in slot_map.items():
            if len(entries) <= 1:
                continue
            groups = {e.get("variant_group") for e in entries}
            if None in groups or len(groups) > 1:
                names = [
                    f"{e['token']} ({e.get('abstraction', '?')})"
                    for e in entries
                ]
                conflicts.append(
                    f"NS[{slot}]: {names} — add matching 'variant_group' to all claimants"
                )

        assert not conflicts, (
            "Duplicate ns_slot values without a shared variant_group:\n  " +
            "\n  ".join(conflicts)
        )


class TestR9_NullSlotPolicy:
    """R9: RETIRED — ns_slot=null is implicitly dynamic; policy field is optional."""

    def test_null_slot_has_policy(self):
        pass


class TestR7b_PolicySemanticNormalization:
    """Regression tests for _resolve_ns_slot_policy semantic normalization (R9 retirement).

    Ensures that absent-vs-static disagreement on null slots is caught, and that
    absent-vs-dynamic on null slots passes (both resolve to 'dynamic').
    """

    def test_null_slot_absent_policy_resolves_to_dynamic(self):
        """ns_slot=null + absent policy → 'dynamic' (R9 retired rule)."""
        assert _resolve_ns_slot_policy(None, None) == "dynamic"

    def test_null_slot_explicit_dynamic_policy(self):
        """ns_slot=null + 'dynamic' policy → 'dynamic'."""
        assert _resolve_ns_slot_policy(None, "dynamic") == "dynamic"

    def test_null_slot_explicit_static_policy(self):
        """ns_slot=null + 'static' policy → 'static' (NULL/token-only category)."""
        assert _resolve_ns_slot_policy(None, "static") == "static"

    def test_fixed_slot_absent_policy_resolves_to_static(self):
        """ns_slot=integer + absent policy → 'static' (Resident/Lazy-load convention)."""
        assert _resolve_ns_slot_policy(9, None) == "static"

    def test_absent_vs_dynamic_null_slot_agrees(self):
        """manifest='dynamic', sidecar=absent, null slot → resolved values agree (both dynamic)."""
        m = _resolve_ns_slot_policy(None, "dynamic")
        s = _resolve_ns_slot_policy(None, None)
        assert m == s, f"Expected both to resolve to 'dynamic', got manifest={m!r} sidecar={s!r}"

    def test_absent_vs_static_null_slot_disagrees(self):
        """manifest='static', sidecar=absent, null slot → resolved values disagree (NULL vs dynamic)."""
        m = _resolve_ns_slot_policy(None, "static")
        s = _resolve_ns_slot_policy(None, None)
        assert m != s, "Expected 'static' and absent null-slot to resolve differently, but they agreed"


class TestR10_LumpFilesExist:
    """R10: Every manifest entry with lump_size declared has a .lump file on disk."""

    def test_lump_files_present(self):
        missing = []
        for e in MANIFEST_ENTRIES_WITH_SIZE:
            token = e["token"].lower()
            if not _lump_exists(token):
                missing.append(
                    f"{token} ({e.get('abstraction', '?')}) — "
                    f"lump_size={e['lump_size']} declared but no .lump on disk at "
                    f"{_lump_path(token)}"
                )
        assert not missing, (
            "Manifest entries missing .lump binary:\n  " + "\n  ".join(missing)
        )


ABSTRACT_LED_GT = 0x07800100


class TestR12_LedPetName:
    """R12: Any lump whose c-list[0] is the Abstract LED GT must name it 'LED0' in pet_names.CR."""

    @pytest.mark.parametrize("token", JSON_TOKENS)
    def test_led_clist0_pet_name(self, token):
        if not _lump_exists(token):
            pytest.skip(f"lump absent for {token}")
        h = _read_header(token)
        if h["cc"] == 0:
            return
        path = _lump_path(token)
        with open(path, "rb") as f:
            raw = f.read()
        words = struct.unpack(f">{len(raw) // 4}I", raw)
        clist_start = h["lump_sz"] - h["cc"]
        if words[clist_start] != ABSTRACT_LED_GT:
            return
        sc = _load_sidecar(token)
        cr = (sc or {}).get("pet_names", {}).get("CR", {})
        assert cr.get("0") == "LED0", (
            f"{token}: c-list[0] = Abstract LED GT (0x07800100) but "
            f"pet_names.CR[\"0\"] = {cr.get('0')!r}, expected 'LED0'.\n"
            "  Add  \"0\": \"LED0\"  inside the pet_names.CR object in the sidecar."
        )


class TestR11_SidecarFilesExist:
    """R11: Every manifest entry with an explicit sidecar_file field has that file on disk.

    A second (warn-only) check flags entries that declare lump_size but omit
    sidecar_file entirely, so the gap remains visible in CI without blocking it.
    """

    def test_sidecar_files_present(self):
        """Hard fail: declared sidecar_file must exist on disk."""
        missing = []
        for e in MANIFEST_ENTRIES_WITH_SIZE:
            # Only check entries that explicitly declare a sidecar_file.
            # Entries without a sidecar_file are not required to have one.
            if not e.get("sidecar_file"):
                continue
            token = e["token"].lower()
            if not _sidecar_exists(token):
                missing.append(
                    f"{token} ({e.get('abstraction', '?')}) — no sidecar .json on disk at "
                    f"{_sidecar_path(token)}"
                )
        assert not missing, (
            "Manifest entries missing sidecar .json:\n  " + "\n  ".join(missing)
        )

    def test_sidecar_file_field_present(self):
        """Warn (not fail) when a manifest entry with lump_size has no sidecar_file field.

        This makes the gap visible in CI output without blocking merges for
        entries that legitimately have no sidecar yet.  Add a sidecar and wire
        up sidecar_file in manifest.json to silence the warning.
        """
        no_sidecar = []
        for e in MANIFEST_ENTRIES_WITH_SIZE:
            if not e.get("sidecar_file"):
                no_sidecar.append(
                    f"{e['token']} ({e.get('abstraction', '?')}) — "
                    f"lump_size={e['lump_size']} but no sidecar_file in manifest"
                )
        if no_sidecar:
            warnings.warn(
                "Manifest entries with lump_size but no sidecar_file field "
                f"({len(no_sidecar)} entries):\n  " + "\n  ".join(no_sidecar),
                UserWarning,
                stacklevel=2,
            )


def _read_clist_word(token: str, slot_index: int) -> int:
    """Return the raw 32-bit word at c-list[slot_index] for the named lump."""
    path = _lump_path(token)
    with open(path, "rb") as f:
        raw = f.read()
    words = struct.unpack(f">{len(raw) // 4}I", raw)
    h = _parse_header(words[0])
    clist_start = h["lump_sz"] - h["cc"]
    return words[clist_start + slot_index]


def _decode_gt(word):
    word    = word & 0xFFFFFFFF
    gt_type = (word >> 25) & 0x3   # v2.0: gt_type at [26:25], was [24:23]
    R       = (word >> 24) & 0x1   # v2.0: R flag at [24] (Abstract GT R-perm / gt_seq bit 8)
    W       = (word >> 23) & 0x1   # v2.0: W flag at [23] (Abstract GT W-perm / gt_seq bit 7)
    dom     = (word >> 27) & 0x1
    perm3   = (word >> 28) & 0x7
    gt_seq  = (word >> 16) & 0x1FF  # v2.0: 9-bit sequence counter at [24:16]
    slot_id =  word        & 0xFFFF
    if dom == 0:
        perms = {"R": (perm3 >> 0) & 1, "W": (perm3 >> 1) & 1, "X": (perm3 >> 2) & 1,
                 "L": 0, "S": 0, "E": 0}
    else:
        perms = {"R": 0, "W": 0, "X": 0,
                 "L": (perm3 >> 0) & 1, "S": (perm3 >> 1) & 1, "E": (perm3 >> 2) & 1}
    return {
        "type": gt_type,
        "type_name": ["NULL", "Inform", "Outform", "Abstract"][gt_type],
        "R": R,
        "W": W,
        "dom": dom,
        "dom_name": "Church" if dom else "Turing",
        "perm3": perm3,
        "gt_seq": gt_seq,
        "slot_id": slot_id,
        "perms": perms,
    }


BOOT_ABSTR_E_GT = 0x4A000003  # v2.0: Inform E-GT, gt_type at [26:25]=01, Church dom, slot 3
BOOT_NUCS_X_GT  = 0x42000001  # v2.0: Inform X-GT, gt_type at [26:25]=01, Turing dom, slot 1
SELFTEST_E_GT   = 0x4A000006  # SelfTest E-GT — NS slot 6, Church domain, E permission

# cc=8 lumps: Boot.Abstr E-GT at slot 3, Boot.Nucs X-GT at slot 7
SELFTEST_LUMP_CASES = [
    ("cb8739cf", "GT Encoding v1.1 Hardware Self-Test"),
]

# cc>=1 lumps: SelfTest E-GT at slot 0 (POLA redesign — no Boot.Nucs needed)
# PostFlashSelftest: CRC-32 token for the PostFlashSelftest binary (rebuilt alongside source)
#   The token is read from manifest.json so this guard cannot drift after a
#   source edit changes the CRC.
#     slot 0 = SelfTest E-GT (NS slot 6, Church domain, E perm)
#     slot 1 = Next.GT     (default = SelfTest self-loop; boot_image.py overrides)
# SelfTest: token 00000600, cc=2 (slot 0 = SelfTest E-GT; slot 1 = Next.GT for continuation)
# To regenerate PostFlashSelftest after editing the source:
#   node scripts/build_selftest_lump.js
#   Then update the token on the line below and commit .lump + .json + manifest.json.
_POSTFLASH_SELFTEST_TOKEN = next(
    (e["token"] for e in MANIFEST if e.get("abstraction") == "PostFlashSelftest"),
    None,
)
SELFTEST_LUMP_CASES_CC1 = [
    (_POSTFLASH_SELFTEST_TOKEN, "PostFlashSelftest"),
    ("00000600", "SelfTest"),
]


class TestR13_SelftestClistGTs:
    """R13: Selftest lumps carry the expected Boot.Abstr and Boot.Nucs GT values."""

    @pytest.mark.parametrize("token,label", SELFTEST_LUMP_CASES)
    def test_slot3_raw_value(self, token, label):
        actual = _read_clist_word(token, 3)
        assert actual == BOOT_ABSTR_E_GT, (
            f"{token} ({label}): c-list[3] = {actual:#010x}, "
            f"expected Boot.Abstr E-GT = {BOOT_ABSTR_E_GT:#010x}.\n"
            "  Repack the binary so that slot 3 holds the Boot.Abstr E capability."
        )

    @pytest.mark.parametrize("token,label", SELFTEST_LUMP_CASES)
    def test_slot7_raw_value(self, token, label):
        actual = _read_clist_word(token, 7)
        assert actual == BOOT_NUCS_X_GT, (
            f"{token} ({label}): c-list[7] = {actual:#010x}, "
            f"expected Boot.Nucs X-GT = {BOOT_NUCS_X_GT:#010x}.\n"
            "  Repack the binary so that slot 7 holds the Boot.Nucs X capability."
        )

    @pytest.mark.parametrize("token,label", SELFTEST_LUMP_CASES)
    def test_slot3_is_inform_type(self, token, label):
        word = _read_clist_word(token, 3)
        gt = _decode_gt(word)
        assert gt["type"] == 1, (
            f"{token} ({label}): c-list[3] = {word:#010x} decodes as "
            f"type={gt['type']} ({gt['type_name']}), expected Inform (1).\n"
            "  GT type bits[26:25] must equal 0b01 (v2.0 layout)."
        )

    @pytest.mark.parametrize("token,label", SELFTEST_LUMP_CASES)
    def test_slot7_is_inform_type(self, token, label):
        word = _read_clist_word(token, 7)
        gt = _decode_gt(word)
        assert gt["type"] == 1, (
            f"{token} ({label}): c-list[7] = {word:#010x} decodes as "
            f"type={gt['type']} ({gt['type_name']}), expected Inform (1).\n"
            "  GT type bits[26:25] must equal 0b01 (v2.0 layout)."
        )

    @pytest.mark.parametrize("token,label", SELFTEST_LUMP_CASES)
    def test_slot3_rw_bits_clear(self, token, label):
        word = _read_clist_word(token, 3)
        gt = _decode_gt(word)
        assert gt["R"] == 0 and gt["W"] == 0, (
            f"{token} ({label}): c-list[3] = {word:#010x}: R={gt['R']}, W={gt['W']}, "
            f"expected both 0 for a zero-gt_seq Inform GT.\n"
            "  v2.0 layout: bits[24:23] are the top two bits of gt_seq, not R/W flags "
            "for non-Abstract GTs.  Non-zero means a non-zero gt_seq was encoded."
        )

    @pytest.mark.parametrize("token,label", SELFTEST_LUMP_CASES)
    def test_slot7_rw_bits_clear(self, token, label):
        word = _read_clist_word(token, 7)
        gt = _decode_gt(word)
        assert gt["R"] == 0 and gt["W"] == 0, (
            f"{token} ({label}): c-list[7] = {word:#010x}: R={gt['R']}, W={gt['W']}, "
            f"expected both 0 for a zero-gt_seq Inform GT.\n"
            "  v2.0 layout: bits[24:23] are the top two bits of gt_seq, not R/W flags "
            "for non-Abstract GTs.  Non-zero means a non-zero gt_seq was encoded."
        )

    @pytest.mark.parametrize("token,label", SELFTEST_LUMP_CASES)
    def test_slot3_church_domain_e_permission(self, token, label):
        word = _read_clist_word(token, 3)
        gt = _decode_gt(word)
        assert gt["dom"] == 1, (
            f"{token} ({label}): c-list[3] = {word:#010x}: dom={gt['dom']} "
            f"({gt['dom_name']}), expected Church (1).\n"
            "  Boot.Abstr E-GT must have bit[27]=1 (Church domain)."
        )
        assert gt["perms"]["E"] == 1, (
            f"{token} ({label}): c-list[3] = {word:#010x}: E-permission is not set "
            f"(perm3={gt['perm3']:#05b}).\n"
            "  Boot.Abstr E-GT must carry E permission (perm3 bit[2]=1)."
        )
        assert gt["perms"]["L"] == 0 and gt["perms"]["S"] == 0, (
            f"{token} ({label}): c-list[3] = {word:#010x}: unexpected L or S permission "
            f"set alongside E (perm3={gt['perm3']:#05b}).\n"
            "  E-GTs must carry exactly one Church permission bit."
        )

    @pytest.mark.parametrize("token,label", SELFTEST_LUMP_CASES)
    def test_slot7_turing_domain_x_permission(self, token, label):
        word = _read_clist_word(token, 7)
        gt = _decode_gt(word)
        assert gt["dom"] == 0, (
            f"{token} ({label}): c-list[7] = {word:#010x}: dom={gt['dom']} "
            f"({gt['dom_name']}), expected Turing (0).\n"
            "  Boot.Nucs X-GT must have bit[27]=0 (Turing domain)."
        )
        assert gt["perms"]["X"] == 1, (
            f"{token} ({label}): c-list[7] = {word:#010x}: X-permission is not set "
            f"(perm3={gt['perm3']:#05b}).\n"
            "  Boot.Nucs X-GT must carry X permission (perm3 bit[2]=1)."
        )
        assert gt["perms"]["R"] == 0 and gt["perms"]["W"] == 0, (
            f"{token} ({label}): c-list[7] = {word:#010x}: unexpected R or W permission "
            f"set alongside X (perm3={gt['perm3']:#05b}).\n"
            "  Boot.Nucs X-GT must carry exactly X permission."
        )


class TestR13b_NewSelftestClistGT:
    """R13b: POLA-redesigned selftest lumps (cc>=1) carry the expected SelfTest E-GT
    at c-list slot 0 — Church domain, E permission, NS slot 6.

    These lumps dropped Boot.Nucs (no privileged CR14 needed) in favour of a
    minimal design: slot 0 is an E-GT pointing at the SelfTest NS slot.
    PostFlashSelftest is cc=2; slot 1 carries Next.GT (default = SelfTest self-loop).
    """

    @pytest.mark.parametrize("token,label", SELFTEST_LUMP_CASES_CC1)
    def test_slot0_raw_value(self, token, label):
        actual = _read_clist_word(token, 0)
        assert actual == SELFTEST_E_GT, (
            f"{token} ({label}): c-list[0] = {actual:#010x}, "
            f"expected SelfTest E-GT = {SELFTEST_E_GT:#010x}.\n"
            "  Repack the binary so that slot 0 holds the SelfTest E capability "
            "(NS slot 6, Church domain, E permission)."
        )

    @pytest.mark.parametrize("token,label", SELFTEST_LUMP_CASES_CC1)
    def test_slot0_church_domain_e_permission(self, token, label):
        word = _read_clist_word(token, 0)
        gt = _decode_gt(word)
        assert gt["dom"] == 1, (
            f"{token} ({label}): c-list[0] = {word:#010x}: dom={gt['dom']} "
            f"({gt['dom_name']}), expected Church (1).\n"
            "  SelfTest E-GT must have bit[27]=1 (Church domain)."
        )
        assert gt["perms"]["E"] == 1, (
            f"{token} ({label}): c-list[0] = {word:#010x}: E-permission is not set "
            f"(perm3={gt['perm3']:#05b}).\n"
            "  SelfTest E-GT must carry E permission (perm3 bit[2]=1)."
        )
        assert gt["perms"]["L"] == 0 and gt["perms"]["S"] == 0, (
            f"{token} ({label}): c-list[0] = {word:#010x}: unexpected L or S permission "
            f"set alongside E (perm3={gt['perm3']:#05b}).\n"
            "  E-GTs must carry exactly one Church permission bit."
        )


def _live_abstraction_names() -> set:
    """Return the set of abstraction names currently registered in
    simulator/abstractions.js by actually instantiating AbstractionRegistry
    under Node — never a hand-maintained/regex copy that can itself drift.
    """
    abstractions_js = os.path.normpath(
        os.path.join(os.path.dirname(__file__), "..", "..", "simulator", "abstractions.js")
    )
    script = (
        "const AbstractionRegistry = require(%r);"
        "const reg = new AbstractionRegistry();"
        "console.log(JSON.stringify(Object.values(reg.abstractions).map(a => a.name)));"
    ) % abstractions_js
    out = subprocess.run(
        ["node", "-e", script], capture_output=True, text=True, check=True
    ).stdout
    return set(json.loads(out))


LIVE_ABSTRACTION_NAMES = _live_abstraction_names()

# Lumps whose `abstraction` field intentionally does not (and never has)
# corresponded to a live simulator/abstractions.js registry entry, along
# with the reason. Add an entry here ONLY when the mismatch is deliberate
# (e.g. a variant lump that predates the registry, or a Haskell/alt-frontend
# sibling that is browsed via the LUMP repository rather than the
# Abstractions view). Anything else that fails R15 is real name drift —
# fix the sidecar/manifest `abstraction` field or the registry name instead
# of adding it here.
KNOWN_NON_REGISTRY_ABSTRACTIONS = {
    "PostFlashSelftest":   "Boot-resident hardware diagnostic lump; wired statically at "
                           "NS slot 6 by the boot image builder. Not a user-facing "
                           "abstraction — accessed only via the Builder tab (Run Self-Test) "
                           "and loadLumpBinary(), never via the Abstractions view/registry.",
    "SlideRule.Haskell":   "Haskell-frontend language variant of SlideRule (NS slot 16). "
                           "Browsable via the LUMP repository only — the registry registers "
                           "the base 'SlideRule' abstraction; this dot-name variant is "
                           "deliberately distinct and predates per-language registry entries.",
}


def _abstraction_check_targets():
    """Yield (source, token, abstraction_name) for every manifest/sidecar
    entry that is expected to correspond to a live abstraction registry
    entry: system-baseline (lump_version 0/absent) lumps with a real,
    non-null NS slot. Dynamic/NULL lumps (ns_slot is None) and
    user-compiled lumps (lump_version >= 1) are exempt — see replit.md
    "LUMP Metadata Integrity" for the four NS-slot categories and the
    lump_version convention.
    """
    targets = []
    for e in MANIFEST:
        abs_name = e.get("abstraction")
        if not abs_name:
            continue
        lv = e.get("lump_version")
        if lv is not None and lv >= 1:
            continue
        if e.get("ns_slot") is None:
            continue
        targets.append(("manifest", e.get("token", "?"), abs_name))

    for token in JSON_TOKENS:
        sc = _load_sidecar(token)
        if not sc:
            continue
        abs_name = sc.get("abstraction")
        if not abs_name:
            continue
        lv = sc.get("lump_version")
        if lv is not None and lv >= 1:
            continue
        if sc.get("ns_slot") is None:
            continue
        targets.append((f"sidecar:{token}", token, abs_name))
    return targets


ABSTRACTION_CHECK_TARGETS = _abstraction_check_targets()


class TestR16_AbstractionNameMatchesRegistry:
    """R16: A system-baseline, statically-slotted lump's `abstraction` field
    must name a currently-live entry in the simulator/abstractions.js
    registry (or be an explicitly documented, deliberate exception).

    This is the build/merge-time guard for abstraction-name drift: Task #1988
    proved the four Open-in jump functions (Abstraction<->Editor,
    LUMP<->Abstraction, Editor<->LUMP) degrade gracefully (toast, no crash)
    when a lump's `abstraction` field no longer matches any live abstraction
    name. This rule catches the drift itself — e.g. an abstraction rename in
    abstractions.js that a lump's sidecar/manifest was never updated to
    match — instead of only surfacing as a runtime toast the developer may
    never see.
    """

    @pytest.mark.parametrize(
        "source,token,abstraction_name", ABSTRACTION_CHECK_TARGETS,
        ids=[f"{t[0]}-{t[1]}" for t in ABSTRACTION_CHECK_TARGETS],
    )
    def test_abstraction_name_is_live(self, source, token, abstraction_name):
        if abstraction_name in KNOWN_NON_REGISTRY_ABSTRACTIONS:
            return
        assert abstraction_name in LIVE_ABSTRACTION_NAMES, (
            f"{token} ({source}): abstraction = {abstraction_name!r} does not match "
            "any live entry in simulator/abstractions.js.\n"
            "  This usually means the abstraction was renamed and this lump's "
            "manifest/sidecar `abstraction` field was not updated to match "
            "(abstraction-name drift) — update the field to the new name.\n"
            "  If this mismatch is deliberate (e.g. a pre-registry variant lump "
            "browsable only via the LUMP repository), add it to "
            "KNOWN_NON_REGISTRY_ABSTRACTIONS in tests/lump/test_lump_consistency.py "
            "with a reason."
        )

    @pytest.mark.parametrize(
        "allowlisted_name", sorted(KNOWN_NON_REGISTRY_ABSTRACTIONS),
    )
    def test_allowlist_entry_is_not_stale(self, allowlisted_name):
        """Companion guard for KNOWN_NON_REGISTRY_ABSTRACTIONS: every name in
        the allowlist must still appear as an `abstraction` field on at least
        one current manifest/sidecar entry (i.e. still be a real, checked
        target). If a lump is renamed, deleted, or its `abstraction` field
        changed, the allowlist entry stops matching anything and silently
        rots — worse, it could later "cover for" an unrelated future name
        collision that happens to reuse the same string. Remove stale
        entries instead of leaving them in place.
        """
        # Include all manifest entries (not just static-slot ones) so that
        # dynamic/NULL-slot lumps like PostFlashSelftest (ns_slot=null) are
        # counted — _abstraction_check_targets() deliberately excludes them
        # from the registry-match check, but they are still real, living lumps.
        all_manifest_names = {e.get("abstraction") for e in MANIFEST if e.get("abstraction")}
        current_abstraction_names = {t[2] for t in ABSTRACTION_CHECK_TARGETS} | all_manifest_names
        assert allowlisted_name in current_abstraction_names, (
            f"KNOWN_NON_REGISTRY_ABSTRACTIONS entry {allowlisted_name!r} no longer "
            "matches any current manifest/sidecar `abstraction` field.\n"
            "  The lump this entry was meant for was likely renamed, deleted, or "
            "had its `abstraction` field changed. This allowlist entry is now dead "
            "code and must be removed from KNOWN_NON_REGISTRY_ABSTRACTIONS in "
            "tests/lump/test_lump_consistency.py — leaving it in place risks "
            "silently masking an unrelated future name collision."
        )


class TestR14_ArchiveSidecarsExist:
    """R14: Every archive binary has a matching sidecar .json.

    Supports both legacy <token>-vN.lump and new <AbsName>_vN.lump archive patterns.
    """

    def test_archive_lumps_have_sidecars(self):
        missing = []
        for stem in ARCHIVE_LUMP_STEMS:
            sidecar = os.path.join(LUMPS_DIR, f"{stem}.json")
            if not os.path.exists(sidecar):
                missing.append(
                    f"{stem}.lump — no matching {stem}.json sidecar.\n"
                    "  Every archived LUMP binary must have a companion sidecar recording\n"
                    "  cw/cc/lump_size/compiled_at for that snapshot. Re-run the archive\n"
                    "  step or create the sidecar manually."
                )
        assert not missing, (
            "Archive binaries missing their sidecar .json:\n  " + "\n  ".join(missing)
        )


def _read_all_words(token: str):
    """Return all 32-bit big-endian words from a .lump binary."""
    path = _lump_path(token)
    with open(path, "rb") as f:
        data = f.read()
    n = len(data) // 4
    return list(struct.unpack_from(f">{n}I", data))


# ── R17/R18 helpers ────────────────────────────────────────────────────────────

def _example_tab_labels():
    """Extract display labels from example-tab buttons in simulator/index.html.

    For each <button class="example-tab" ...> element, returns a dict with:
        tooltip_label    — text before the first ' — ' (em-dash) in data-tooltip,
                           with trailing decorators (✦ ★) and whitespace stripped.
        button_text      — button inner text with trailing decorators and whitespace
                           stripped.
        raw_tooltip      — the full, unmodified data-tooltip attribute value.
        data_example     — value of the data-example attribute (or "").
        data_abstraction — value of the data-abstraction attribute (or "").
                           When non-empty this declares that the button is the
                           canonical demo for that named abstraction; R17
                           verifies both tooltip_label and button_text equal it.

    All buttons that carry class="example-tab" are returned, including those
    without a data-tooltip attribute (they may still carry data-abstraction).
    """
    with open(_INDEX_HTML, encoding="utf-8") as f:
        content = f.read()

    # Match every <button ...>...</button> that carries class="example-tab".
    # Each such button lives on its own line so DOTALL is not needed, but we
    # use it for safety in case of future multi-line reformatting.
    button_re = _re.compile(
        r'<button\b([^>]*class="[^"]*\bexample-tab\b[^"]*"[^>]*)>(.*?)</button>',
        _re.DOTALL,
    )
    tooltip_attr_re     = _re.compile(r'\bdata-tooltip="([^"]*)"')
    example_attr_re     = _re.compile(r'\bdata-example="([^"]*)"')
    abstraction_attr_re = _re.compile(r'\bdata-abstraction="([^"]*)"')

    results = []
    for m in button_re.finditer(content):
        attrs_str, inner = m.group(1), m.group(2)

        tm = tooltip_attr_re.search(attrs_str)
        raw_tooltip = tm.group(1) if tm else ""

        # The separator is a literal em-dash (U+2014) surrounded by spaces.
        em_sep = " \u2014 "
        sep_idx = raw_tooltip.find(em_sep)
        if sep_idx >= 0:
            tooltip_label = raw_tooltip[:sep_idx]
        else:
            tooltip_label = raw_tooltip
        tooltip_label = _DECORATOR_STRIP_RE.sub("", tooltip_label).strip()

        # Strip HTML tags from inner text (buttons don't have child elements
        # in practice, but be defensive) then strip decorators.
        button_text = _re.sub(r"<[^>]+>", "", inner).strip()
        button_text = _DECORATOR_STRIP_RE.sub("", button_text).strip()

        em = example_attr_re.search(attrs_str)
        am = abstraction_attr_re.search(attrs_str)

        results.append(
            dict(
                tooltip_label=tooltip_label,
                button_text=button_text,
                raw_tooltip=raw_tooltip,
                data_example=em.group(1) if em else "",
                data_abstraction=am.group(1) if am else "",
            )
        )
    return results


def _known_purposes_keys():
    """Return the ordered list of top-level keys of the knownPurposes dict in
    simulator/app-absdetail.js.

    Uses a Node.js subprocess to locate the dict, walk it with brace-depth
    tracking (correctly skipping string contents), and extract depth-1 keys —
    the same technique used by _live_abstraction_names() for abstractions.js.
    """
    script = r"""
const fs = require('fs');
const content = fs.readFileSync(%r, 'utf8');

const startMarker = 'const knownPurposes = {';
const startIdx = content.indexOf(startMarker);
if (startIdx < 0) { console.log('[]'); process.exit(0); }

// Walk from the opening '{' tracking brace depth, correctly skipping string
// literals so that braces inside method-doc strings are ignored.
let depth = 0;
let i = startIdx + startMarker.length - 1; // position of '{'
let inStr = false, strCh = '';
const blockStart = i;

while (i < content.length) {
    const c = content[i];
    if (inStr) {
        if (c === '\\') { i += 2; continue; }  // skip escaped char
        if (c === strCh) inStr = false;
    } else {
        if (c === '"' || c === "'" || c === '`') { inStr = true; strCh = c; }
        else if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) break; }
    }
    i++;
}
const block = content.slice(blockStart, i + 1);

// Direct (depth-1) keys are lines indented by exactly 8 spaces followed
// by a single-quoted identifier then a colon.  This matches the consistent
// formatting used throughout app-absdetail.js and avoids picking up the
// nested method-name keys (which are indented 12+ spaces).
const keyRe = /^        '([^']+)'\s*:/mg;
const keys = [];
let m;
while ((m = keyRe.exec(block)) !== null) keys.push(m[1]);
console.log(JSON.stringify(keys));
""" % _ABSDETAIL_JS
    out = subprocess.run(
        ["node", "-e", script], capture_output=True, text=True, check=True
    ).stdout
    return json.loads(out)


# Build module-level collections once so parametrize can use them.
_EXAMPLE_TAB_LABELS = _example_tab_labels()
_KNOWN_PURPOSES_KEYS = _known_purposes_keys()

# Build a case-folded lookup table  lower_name -> canonical_name  from the
# live abstraction registry, used by both R17 and R18.
_LIVE_NAMES_BY_LOWER = {name.lower(): name for name in LIVE_ABSTRACTION_NAMES}

# ── R17 allowlist ──────────────────────────────────────────────────────────────
# data-abstraction values that intentionally reference an abstraction name that
# is not (yet) live in the registry.  Add an entry here ONLY for a planned-but-
# not-yet-implemented abstraction whose demo button is being authored ahead of
# the registry entry.  Do NOT add an entry to suppress a casing mistake or a
# wrong name — fix the HTML instead.
# (Currently empty: all data-abstraction values match live registry names.)
KNOWN_NON_REGISTRY_EXAMPLE_LABELS: frozenset = frozenset()

# ── R18 allowlist ──────────────────────────────────────────────────────────────
# knownPurposes keys that intentionally do not (yet) correspond to a live
# simulator/abstractions.js registry entry.  Add an entry here ONLY when the
# mismatch is deliberate (e.g. a planned but not-yet-implemented abstraction
# whose method documentation is being authored ahead of the implementation).
# Fix the key name or add it to the registry rather than adding entries here
# for mere renames or typos.
KNOWN_NON_REGISTRY_PURPOSES = {
    "Negotiate": (
        "Planned dual-approval negotiation abstraction; method docs authored "
        "ahead of the registry entry.  Add to abstractions.js when implemented."
    ),
}


@pytest.mark.parametrize("token", LUMP_TOKENS)
class TestR15_DreadDwriteImmediateModeBit:
    """R15 (ECO-001B): Every DREAD (opcode=10) and DWRITE (opcode=11) instruction in
    the code region (words 1..cw) of every .lump binary must have bit14=1 (immediate mode).

    Background
    ----------
    ECO-001B added a mode-select bit (imm15[14]) to DREAD/DWRITE:
      • bit14=1 → immediate mode (backward-compatible; all pre-ECO-001B assembler output)
      • bit14=0 → indexed mode  (new 4-operand form: base + DR[imm[3:0]])

    All lumps assembled before ECO-001B have bit14=0 by construction (imm15 was always
    ≤ 14 bits). After migration those words must have bit14 set to 1 so that the
    new decoder does not mis-interpret them as indexed-mode instructions.

    This test is the CI gate that prevents regressions: any new DREAD/DWRITE instruction
    generated by the assembler without bit14 would be caught here immediately.
    """

    def test_dread_dwrite_bit14_set(self, token):
        words = _read_all_words(token)
        if not words:
            return
        hdr = _parse_header(words[0])
        assert hdr["valid"], f"{token}: invalid lump header magic"
        cw = hdr["cw"]
        violations = []
        for i in range(1, min(cw + 1, len(words))):
            w = words[i]
            opcode = (w >> 23) & 0x1F
            if opcode in (10, 11) and not (w & 0x4000):
                name = "DREAD" if opcode == 10 else "DWRITE"
                imm15 = w & 0x7FFF
                violations.append(
                    f"  word[{i}] {name} raw=0x{w:08X}  imm15=0x{imm15:04X}  "
                    f"(bit14=0 → decoded as indexed mode, must be 1 for immediate)"
                )
        assert not violations, (
            f"{token}: {len(violations)} DREAD/DWRITE instruction(s) in code region "
            f"[words 1..{cw}] have bit14=0 (legacy immediate, not migrated to ECO-001B).\n"
            + "\n".join(violations)
            + "\n  Fix: set bit14=1 (OR 0x4000) on each listed word in the binary."
        )


# ── R17: Example-tab display-name casing ───────────────────────────────────────

# ── R17a: casing-drift cases ───────────────────────────────────────────────────
# One entry per unique label string that is a case-insensitive match to a live
# abstraction name.  Labels with no case-insensitive match at all are silently
# ignored (they are plain example names, not abstraction names).
def _r17_casing_cases():
    cases = []
    seen: set = set()
    for entry in _EXAMPLE_TAB_LABELS:
        for kind, raw in (
            ("tooltip_label", entry["tooltip_label"]),
            ("button_text",   entry["button_text"]),
        ):
            if not raw or raw in seen:
                continue
            canonical = _LIVE_NAMES_BY_LOWER.get(raw.lower())
            if canonical is not None:
                seen.add(raw)
                cases.append((kind, raw, canonical))
    return cases


# ── R17b: data-abstraction semantic cases ──────────────────────────────────────
# One entry per button that carries a data-abstraction attribute.  These buttons
# explicitly declare which abstraction they demonstrate; R17b verifies that:
#   (a) the declared name is a live registry entry (or allowlisted exception),
#   (b) the tooltip label equals the declared name (catches wrong name like
#       "LED Control" when data-abstraction="LED Flash"),
#   (c) the button text (stripped) equals the declared name (same check on the
#       visible label the user actually reads).
# Checks (b) and (c) catch both semantic drift ("LED Control" vs "LED Flash")
# and casing drift ("LED flash" vs "LED Flash") on the declared buttons.
def _r17_abstraction_cases():
    cases = []
    seen_keys: set = set()
    for entry in _EXAMPLE_TAB_LABELS:
        da = entry["data_abstraction"]
        de = entry["data_example"] or entry["tooltip_label"] or da
        if not da or da in seen_keys:
            continue
        seen_keys.add(da)
        cases.append((de, da, entry["tooltip_label"], entry["button_text"]))
    return cases


_R17_CASING_CASES      = _r17_casing_cases()
_R17_ABSTRACTION_CASES = _r17_abstraction_cases()


class TestR17_ExampleTabDisplayNames:
    """R17: Example-tab button labels that reference a live abstraction must
    use its exact registered name and casing.

    Two complementary sub-checks
    ----------------------------
    R17a  (casing drift)  — For any tooltip label or button text that is a
          case-insensitive match to a live abstraction name, the string must be
          an *exact* match.  Catches "LED flash" vs "LED Flash".  Generic
          labels like "Capability Test" that have no case-insensitive match at
          all are silently ignored.

    R17b  (semantic + casing drift via data-abstraction)  — For buttons that
          carry a data-abstraction attribute (the authoritative declaration that
          a button is the canonical demo for a specific named abstraction):
            • the attribute value must be a live registry name (or be in
              KNOWN_NON_REGISTRY_EXAMPLE_LABELS),
            • the tooltip label must equal the attribute value exactly,
            • the button text (decorators stripped) must equal the attribute
              value exactly.
          Catches both a completely wrong name ("LED Control" when the
          abstraction is "LED Flash") and casing drift ("LED flash").

    How to fix a failure
    --------------------
    R17a: update the data-tooltip / button text in simulator/index.html to use
          the canonical casing shown in the error message.
    R17b (wrong abstraction name): update the data-tooltip and button text to
          match the data-abstraction value, or correct the data-abstraction
          value itself if it was set incorrectly.
    R17b (unrecognised data-abstraction value): either add the abstraction to
          abstractions.js or add it to KNOWN_NON_REGISTRY_EXAMPLE_LABELS with
          a documented reason.
    """

    # ── R17a ──────────────────────────────────────────────────────────────────

    @pytest.mark.parametrize(
        "label_kind,raw_label,canonical",
        _R17_CASING_CASES,
        ids=[f"{k}-{r}" for k, r, _ in _R17_CASING_CASES],
    )
    def test_label_casing_matches_registry(self, label_kind, raw_label, canonical):
        assert raw_label == canonical, (
            f"simulator/index.html example-tab {label_kind} = {raw_label!r} "
            f"matches live abstraction name case-insensitively "
            f"but is not an exact match.\n"
            f"  Found:    {raw_label!r}\n"
            f"  Expected: {canonical!r}  (the registered name in abstractions.js)\n"
            f"  Fix: update the data-tooltip / button text in simulator/index.html "
            f"to use the exact spelling shown above."
        )

    # ── R17b ──────────────────────────────────────────────────────────────────

    @pytest.mark.parametrize(
        "example_key,data_abstraction,tooltip_label,button_text",
        _R17_ABSTRACTION_CASES,
        ids=[f"{de}-{da}" for de, da, _, __ in _R17_ABSTRACTION_CASES],
    )
    def test_data_abstraction_label_matches(
        self, example_key, data_abstraction, tooltip_label, button_text
    ):
        """R17b: When data-abstraction is set on an example-tab button:
          (1) the declared abstraction name must be live in the registry.
          (2) the tooltip label must equal the declared name.
          (3) the button text (decorators stripped) must equal the declared name.
        """
        # (1) declared name must be a live registry entry or allowlisted
        assert (
            data_abstraction in LIVE_ABSTRACTION_NAMES
            or data_abstraction in KNOWN_NON_REGISTRY_EXAMPLE_LABELS
        ), (
            f"simulator/index.html: data-abstraction={data_abstraction!r} on "
            f"button data-example={example_key!r} is not a live abstraction name "
            f"in abstractions.js and is not in KNOWN_NON_REGISTRY_EXAMPLE_LABELS.\n"
            f"  Fix: correct the data-abstraction value to the canonical registry "
            f"name, add the abstraction to abstractions.js, or add it to "
            f"KNOWN_NON_REGISTRY_EXAMPLE_LABELS in this test file with a reason."
        )
        # (2) tooltip label must match the declared abstraction name exactly
        assert tooltip_label == data_abstraction, (
            f"simulator/index.html: button data-example={example_key!r} has "
            f"data-abstraction={data_abstraction!r} but its tooltip label is "
            f"{tooltip_label!r}.\n"
            f"  Found:    tooltip label = {tooltip_label!r}\n"
            f"  Expected: {data_abstraction!r}  (the data-abstraction value)\n"
            f"  Fix: update the data-tooltip in simulator/index.html so that the "
            f"text before ' \u2014 ' exactly matches the data-abstraction value."
        )
        # (3) visible button text (stripped) must match the declared name exactly
        assert button_text == data_abstraction, (
            f"simulator/index.html: button data-example={example_key!r} has "
            f"data-abstraction={data_abstraction!r} but its visible text is "
            f"{button_text!r}.\n"
            f"  Found:    button text = {button_text!r}\n"
            f"  Expected: {data_abstraction!r}  (the data-abstraction value)\n"
            f"  Fix: update the button inner text in simulator/index.html to "
            f"match the data-abstraction value (decorators like ✦ may remain)."
        )


# ── R18: knownPurposes keys match live abstraction names ───────────────────────

class TestR18_KnownPurposesKeys:
    """R18: Every top-level key of the knownPurposes dict in
    simulator/app-absdetail.js must name a currently-live entry in the
    abstraction registry (or appear in KNOWN_NON_REGISTRY_PURPOSES as a
    documented exception).

    Background
    ----------
    knownPurposes maps abstraction names to per-method documentation strings
    shown in the Abstractions panel.  When an abstraction is renamed, the
    corresponding knownPurposes key must be updated in the same commit — if it
    is not, the renamed abstraction silently loses all its method-doc tooltips
    at runtime (the lookup simply finds no entry and falls back to the generic
    "Dispatched via CALL" string).  This rule catches such drift at merge time.

    How to fix a failure
    --------------------
    • If the abstraction was renamed: update the key in knownPurposes to the
      new canonical name (shown in the "expected one of" list).
    • If the abstraction is planned but not yet in abstractions.js: add the key
      to KNOWN_NON_REGISTRY_PURPOSES in this test file with a reason.
    • If the abstraction was removed entirely: delete the key from knownPurposes.
    """

    def test_all_keys_are_live(self):
        failures = []
        for key in _KNOWN_PURPOSES_KEYS:
            if key in KNOWN_NON_REGISTRY_PURPOSES:
                continue
            if key not in LIVE_ABSTRACTION_NAMES:
                canonical = _LIVE_NAMES_BY_LOWER.get(key.lower())
                hint = (
                    f" (case-insensitive match: {canonical!r} — "
                    f"update the key casing)"
                    if canonical
                    else " (no case-insensitive match — "
                    "rename, add to abstractions.js, or delete the key)"
                )
                failures.append(
                    f"  knownPurposes key {key!r}{hint}"
                )
        assert not failures, (
            "simulator/app-absdetail.js: knownPurposes key(s) do not match any "
            "live abstraction name in simulator/abstractions.js:\n"
            + "\n".join(failures)
            + "\n\nFix: rename the key to the canonical abstraction name, "
            "add the abstraction to abstractions.js, or add it to "
            "KNOWN_NON_REGISTRY_PURPOSES in tests/lump/test_lump_consistency.py "
            "with a documented reason."
        )

    @pytest.mark.parametrize(
        "allowlisted_key", sorted(KNOWN_NON_REGISTRY_PURPOSES),
    )
    def test_allowlist_entry_is_not_stale(self, allowlisted_key):
        """Companion guard for KNOWN_NON_REGISTRY_PURPOSES: every entry must
        still correspond to an actual key in knownPurposes.  If the key has
        been removed or renamed, remove the stale allowlist entry too —
        leaving it in place risks silently masking a future collision.
        """
        assert allowlisted_key in _KNOWN_PURPOSES_KEYS, (
            f"KNOWN_NON_REGISTRY_PURPOSES entry {allowlisted_key!r} no longer "
            "matches any key in the knownPurposes dict in "
            "simulator/app-absdetail.js.\n"
            "  The key was likely renamed or removed.  Delete this allowlist "
            "entry from KNOWN_NON_REGISTRY_PURPOSES in "
            "tests/lump/test_lump_consistency.py to keep the guard clean."
        )


# ─── R19: No production lump is an all-stub LUMP ──────────────────────────────

def _lump_is_all_stub(data: bytes) -> bool:
    """Return True when every *non-zero* code word in the LUMP is a RETURN
    instruction AND at least one such word exists.

    Predicate: "every non-zero code word is a RETURN"

    Edge-case policy (mirrors simulator.js _lumpIsStub):
    - All-zero code region → False.  Zero words decode as opcode 0 (LOAD),
      not RETURN; an all-zero region is uninitialized/reserved, not a stub.
    - cw = 0 → False.  No callable surface.
    - Mixed RETURN + zero padding → True iff all non-zero words are RETURN.
      Compilers may pad unused code slots with 0x00000000.
    """
    if len(data) < 4:
        return False
    header = int.from_bytes(data[:4], "big")
    if ((header >> 27) & 0x1F) != 0x1F:  # magic check
        return False
    cw = (header >> 10) & 0x1FFF
    if cw == 0:
        return False
    has_return = False
    for word_idx in range(1, cw + 1):
        offset = word_idx * 4
        if offset + 4 > len(data):
            return False  # truncated / undersized binary
        word = int.from_bytes(data[offset : offset + 4], "big")
        if word == 0:
            continue                           # zero pad — skip
        if ((word >> 27) & 0x1F) != 3:        # 3 = RETURN opcode
            return False
        has_return = True
    return has_return


# R19 scope: registry lumps only (ns_slot is an integer, non-dynamic).
# WIP tokens are intentional placeholder stubs — also excluded.
# NULL/dynamic/floating lumps are never callable by slot, so stub detection
# doesn't apply to them; they are excluded from this rule.
_R19_WIP_TOKENS: set = {
    _me.get("token", "").lower()
    for _me in MANIFEST
    if _me.get("status", "") == "wip"
}
_R19_REGISTRY_TOKENS: set = {
    _me.get("token", "").lower()
    for _me in MANIFEST
    if isinstance(_me.get("ns_slot"), int)
    and _me.get("ns_slot_policy", "static") != "dynamic"
}
_R19_NON_WIP_TOKENS = sorted(
    t for t in _TOKEN_PATHS
    if t not in _R19_WIP_TOKENS and t in _R19_REGISTRY_TOKENS
)


def _parse_abstract_gt_v2(gt32):
    """Parse a 32-bit Abstract GT word using v2.0 bit positions.

    v2.0 layout:
      [31:27] ab_type      — Abstract category (0x00=I/O)
      [26:25] gt_type      — must be 0b11 (Abstract)
      [24]    R            — Read permission
      [23]    W            — Write permission
      [22:16] gt_seq       — Version/generation counter (7-bit in Abstract GTs)
      [15:0]  ab_data      — Device-specific payload
        [15:8]  device_class
        [7:0]   device_data

    Mirrors simulator.js parseAbstractGT() ★v2.0.
    """
    gt32 = gt32 & 0xFFFFFFFF
    ab_type      = (gt32 >> 27) & 0x1F
    gt_type      = (gt32 >> 25) & 0x3
    R            = (gt32 >> 24) & 1
    W            = (gt32 >> 23) & 1
    gt_seq       = (gt32 >> 16) & 0x7F
    ab_data      = gt32 & 0xFFFF
    device_class = (ab_data >> 8) & 0xFF
    device_data  = ab_data & 0xFF
    return dict(ab_type=ab_type, gt_type=gt_type, R=R, W=W,
                gt_seq=gt_seq, ab_data=ab_data,
                device_class=device_class, device_data=device_data)


# Known Abstract GT literals from the boot catalog (v2.0 bit positions).
# Layout: (gt_word, label, expected_fields)
# expected_fields: ab_type, gt_type, R, W, device_class, device_data
_ABSTRACT_GT_CASES = [
    (0x07800100, "LED[0]  R+W",  dict(ab_type=0, gt_type=3, R=1, W=1, device_class=1, device_data=0)),
    (0x07800101, "LED[1]  R+W",  dict(ab_type=0, gt_type=3, R=1, W=1, device_class=1, device_data=1)),
    (0x07800102, "LED[2]  R+W",  dict(ab_type=0, gt_type=3, R=1, W=1, device_class=1, device_data=2)),
    (0x07800103, "LED[3]  R+W",  dict(ab_type=0, gt_type=3, R=1, W=1, device_class=1, device_data=3)),
    (0x07800104, "LED[4]  R+W",  dict(ab_type=0, gt_type=3, R=1, W=1, device_class=1, device_data=4)),
    (0x07800105, "LED[5]  R+W",  dict(ab_type=0, gt_type=3, R=1, W=1, device_class=1, device_data=5)),
    (0x07800200, "UART[0] R+W",  dict(ab_type=0, gt_type=3, R=1, W=1, device_class=2, device_data=0)),
    (0x07000300, "BTN[0]  R",    dict(ab_type=0, gt_type=3, R=1, W=0, device_class=3, device_data=0)),
    (0x07800400, "TIMER[0] R+W", dict(ab_type=0, gt_type=3, R=1, W=1, device_class=4, device_data=0)),
]


class TestR20_BootCatalogAbstractGTRoundTrip:
    """R20: Boot-catalog Abstract GT literals round-trip through parseAbstractGT (v2.0 layout).

    Catches any future v3 layout change that silently produces wrong decoded fields.
    The Button literal (R-only) is the sentinel: v1 encoded 0x05800300 (gt_type at [24:23],
    R at [26]); v2.0 corrects it to 0x07000300 (gt_type at [26:25], R at [24]).
    """

    @pytest.mark.parametrize("gt_word,label,expected", _ABSTRACT_GT_CASES,
                             ids=[c[1] for c in _ABSTRACT_GT_CASES])
    def test_abstract_gt_decode(self, gt_word, label, expected):
        decoded = _parse_abstract_gt_v2(gt_word)
        for field, exp_val in expected.items():
            actual = decoded[field]
            assert actual == exp_val, (
                f"Abstract GT {label} (0x{gt_word:08X}): "
                f"{field} = {actual}, expected {exp_val}.\n"
                f"  Full decode: {decoded}\n"
                f"  If this fails after a layout change, update both the literal "
                f"  and this test table together — never update just one."
            )

    def test_button_gt_is_v2_not_v1(self):
        """Button R-only GT must be 0x07000300 (v2.0), not 0x05800300 (v1)."""
        v1_stale = 0x05800300
        v2_correct = 0x07000300
        v1_decoded = _parse_abstract_gt_v2(v1_stale)
        v2_decoded = _parse_abstract_gt_v2(v2_correct)
        assert v2_decoded["gt_type"] == 3, (
            f"v2.0 Button GT 0x{v2_correct:08X}: gt_type should be 3 (Abstract), "
            f"got {v2_decoded['gt_type']}."
        )
        assert v2_decoded["R"] == 1 and v2_decoded["W"] == 0, (
            f"v2.0 Button GT 0x{v2_correct:08X}: R=1, W=0 expected; "
            f"got R={v2_decoded['R']}, W={v2_decoded['W']}."
        )
        assert v1_decoded["gt_type"] != 3 or v1_decoded["R"] != 1 or v1_decoded["W"] != 0, (
            f"v1 stale literal 0x{v1_stale:08X} incorrectly passes v2.0 decode — "
            "sentinel check is no longer distinguishing v1 from v2."
        )


def _self_gt_expected(identity_string: str, *, enter_permission: bool = False) -> int:
    """Compute the expected self Inform GT word for a given identity_string.

    Formula (from server/app.py):
        hash32  = first 32 bits of sha256(identity_string.encode('utf-8'))
        hash25  = hash32 & 0x1FFFFFF          (low 25 bits)
        self_gt = 0x0A000000 | hash25

    Most compiler-owned SELF rows use 0x0A000000: perm3=0, dom=1 (Church),
    gt_type=1 (Inform). A sidecar may explicitly declare the Bank-style
    E-permission SELF, which uses 0x4A000000 instead. The 25-bit hash occupies
    bits[24:0] — slot_id / sequence fields.
    """
    h = hashlib.sha256(identity_string.encode("utf-8")).hexdigest()
    hash32  = int(h[:8], 16)
    hash25  = hash32 & 0x1FFFFFF
    # Bank's runtime validator requires its SELF row to be an exact Church E
    # capability, while ordinary compiler-owned SELF rows remain public
    # identity tokens with no authority.
    prefix = 0x4A000000 if enter_permission else 0x0A000000
    return (prefix | hash25) & 0xFFFFFFFF


def _self_gt_targets():
    """Return a sorted list of (token, identity_string) pairs for every production
    lump whose sidecar declares an identity_string.

    cc == 0 lumps are included: the test body asserts cc >= 1 so that an
    identity-bearing lump with an empty c-list is a hard failure, not a
    silent skip.  Lumps listed in KNOWN_SELF_GT_EXCEPTIONS are excluded from
    the parametrize set for the hash/dom/type checks but are still collected
    here so the stale-exception guard sees the complete target population.
    """
    targets = []
    for token in LUMP_TOKENS:
        sc = _load_sidecar(token)
        if not sc:
            continue
        id_str = sc.get("identity_string", "")
        if not id_str:
            continue
        # Declared capabilities own every c-list row. These LUMPs retain the
        # same identity_string/hash seal in the sidecar instead of overwriting
        # the first capability with an identity-shaped token.
        if sc.get("identity_seal_location") == "sidecar":
            continue
        if not _lump_exists(token):
            continue
        h = _read_header(token)
        if h is None:
            continue
        targets.append((token, id_str))
    return targets


_SELF_CAPABILITY_PLACEHOLDER = 0xFEED5E1F
_PRIVATE_DATA_CAPABILITY_PLACEHOLDER = 0xFEEDDA7A


def _declared_allocation_placeholder(token: str, row: int, word: int) -> bool:
    """Accept an exact allocation-time sentinel only when the sidecar declares it.

    Dynamic compiler-owned LUMPs cannot carry a live slot/sequence GT before Mint
    chooses their Namespace slot. Their immutable binary therefore carries exact
    sentinels that loadLumpBinary remints atomically at installation time.
    """
    sc = _load_sidecar(token)
    if not sc or sc.get("compiler_owned_self") is not True:
        return False
    if sc.get("ns_slot") is not None or sc.get("ns_slot_policy") != "dynamic":
        return False
    expected = {
        (0, "identity", _SELF_CAPABILITY_PLACEHOLDER),
        (1, "private_data", _PRIVATE_DATA_CAPABILITY_PLACEHOLDER),
    }
    declared = {
        (item.get("row"), item.get("role"), int(item.get("word", "0"), 0))
        for item in sc.get("allocation_time_placeholders", [])
        if isinstance(item, dict) and isinstance(item.get("word"), str)
    }
    candidate = next(
        (entry for entry in expected if entry[0] == row and entry[2] == (word & 0xFFFFFFFF)),
        None,
    )
    return candidate is not None and candidate in declared


# Tokens whose c-list[0] is deliberately NOT a self-identity GT.
# Add a token here ONLY when it has a structured reason — and reference the
# test class that does verify its c-list[0] instead.
#
# To add a new exception:
#   1. Provide a one-sentence reason.
#   2. Name the existing test that already verifies c-list[0] for this lump.
#   3. Do NOT add entries to suppress a genuine hash mismatch — fix the binary.
KNOWN_SELF_GT_EXCEPTIONS: dict = {
    # SelfTest (token 00000600) sidecar carries no identity_string — its c-list
    # is entirely occupied by executable GTs (SelfTest E-GT at slot 0, Next.GT
    # at slot 1) that are verified by TestR13b_NewSelftestClistGT.  No entry here
    # since _self_gt_targets() only collects lumps whose sidecar declares
    # identity_string — SelfTest does not, so it never reaches TestR22.
}

_SELF_GT_ALL_TARGETS = _self_gt_targets()
_SELF_GT_TARGETS = [
    (tok, id_str)
    for tok, id_str in _SELF_GT_ALL_TARGETS
    if tok not in KNOWN_SELF_GT_EXCEPTIONS
]


class TestR22_SelfGTCorrect:
    """R22: Every production LUMP that carries an identity_string in its sidecar
    must have c-list row 0 == 0x0A000000 | sha256(identity_string)[:25 bits].

    Background
    ----------
    When a LUMP is issued (compiled and saved to the namespace), app.py bakes a
    self Inform GT into c-list[0]:

        hash32  = first 32 bits of sha256(identity_string.encode('utf-8'))
        hash25  = hash32 & 0x1FFFFFF
        self_gt = 0x0A000000 | hash25

    The 0x0A000000 prefix encodes dom=1 (Church), gt_type=Inform, perm3=0
    (no capability permissions).  The low 25 bits are a public, secretless
    digest of who authored the LUMP and which issue number it carries.

    This test is the CI gate that catches:
      • A silent binary replacement that resets c-list[0] to a stale value.
      • A sidecar identity_string that drifted from the one used at compile time.
      • Any future patch that accidentally zeros or corrupts c-list[0].

    Lumps whose c-list[0] is deliberately used for a different purpose (e.g. a
    required capability GT) are listed in KNOWN_SELF_GT_EXCEPTIONS with a reason
    and a pointer to the test that does verify that slot.
    """

    @pytest.mark.parametrize(
        "token,identity_string",
        _SELF_GT_TARGETS,
        ids=[t[0] for t in _SELF_GT_TARGETS],
    )
    def test_clist0_matches_identity_hash(self, token, identity_string):
        h = _read_header(token)
        assert h["cc"] >= 1, (
            f"{token}: sidecar declares identity_string={identity_string!r} but "
            f"the binary has cc=0 (no c-list entries).\n"
            "  An identity-bearing LUMP must have at least one c-list slot so\n"
            "  that the self Inform GT can be stored at c-list[0].\n"
            "  Fix: recompile the LUMP so that cc >= 1."
        )
        sidecar = _load_sidecar(token) or {}
        self_rights = (
            sidecar.get("permissions", {})
            .get("c_list_row_0", {})
            .get("rights")
        )
        expected = _self_gt_expected(identity_string, enter_permission=self_rights == ["E"])
        actual   = _read_clist_word(token, 0)
        if _declared_allocation_placeholder(token, 0, actual):
            return
        assert actual == expected, (
            f"{token}: c-list[0] = {actual:#010x} but expected self Inform GT "
            f"{expected:#010x} for identity_string={identity_string!r}.\n"
            "  The 25-bit identity seal in c-list[0] must equal the low 25 bits\n"
            "  of sha256(identity_string.encode('utf-8')).\n"
            "  Possible causes:\n"
            "    • The binary was replaced without regenerating the self-GT.\n"
            "    • The sidecar identity_string drifted from the value used at\n"
            "      compile time.\n"
            "    • A patch accidentally overwrote c-list[0].\n"
            "  Fix: recompile the LUMP with the correct identity_string, or\n"
            f"  patch c-list[0] to {expected:#010x} (word at offset\n"
            f"  {(h['lump_sz'] - h['cc']) * 4:#x} bytes from file start)."
        )

    @pytest.mark.parametrize(
        "token,identity_string",
        _SELF_GT_TARGETS,
        ids=[t[0] for t in _SELF_GT_TARGETS],
    )
    def test_clist0_is_church_domain(self, token, identity_string):
        h = _read_header(token)
        assert h["cc"] >= 1, (
            f"{token}: identity_string present but cc=0; see test_clist0_matches_identity_hash."
        )
        word = _read_clist_word(token, 0)
        if _declared_allocation_placeholder(token, 0, word):
            return
        gt   = _decode_gt(word)
        assert gt["dom"] == 1, (
            f"{token}: c-list[0] = {word:#010x} has dom={gt['dom']} "
            f"({gt['dom_name']}), expected dom=1 (Church).\n"
            "  The self Inform GT must have bit[27]=1 (Church domain).\n"
            "  0x0A000000 prefix guarantees this; a different top byte means\n"
            "  c-list[0] was overwritten or the binary is corrupt."
        )

    @pytest.mark.parametrize(
        "token,identity_string",
        _SELF_GT_TARGETS,
        ids=[t[0] for t in _SELF_GT_TARGETS],
    )
    def test_clist0_is_inform_type(self, token, identity_string):
        h = _read_header(token)
        assert h["cc"] >= 1, (
            f"{token}: identity_string present but cc=0; see test_clist0_matches_identity_hash."
        )
        word = _read_clist_word(token, 0)
        if _declared_allocation_placeholder(token, 0, word):
            return
        gt   = _decode_gt(word)
        assert gt["type"] == 1, (
            f"{token}: c-list[0] = {word:#010x} decodes as gt_type={gt['type']} "
            f"({gt['type_name']}), expected Inform (1).\n"
            "  The self Inform GT must have bits[26:25]=0b01.\n"
            "  0x0A000000 prefix guarantees this; a different encoding means\n"
            "  c-list[0] was overwritten or the binary is corrupt."
        )

    def test_exception_allowlist_is_not_stale(self):
        """Every token in KNOWN_SELF_GT_EXCEPTIONS must still appear in the full
        set of self-GT targets (i.e. still have identity_string + cc >= 1).
        A token removed from the lump set or whose sidecar lost identity_string
        would silently leave a dead allowlist entry; remove it instead.
        """
        current_tokens = {tok for tok, _ in _SELF_GT_ALL_TARGETS}
        stale = set(KNOWN_SELF_GT_EXCEPTIONS) - current_tokens
        assert not stale, (
            "KNOWN_SELF_GT_EXCEPTIONS entries no longer match any lump with\n"
            "identity_string + cc >= 1:\n  " +
            "\n  ".join(sorted(stale)) +
            "\n  Remove stale entries from KNOWN_SELF_GT_EXCEPTIONS in\n"
            "  tests/lump/test_lump_consistency.py."
        )

    def test_sidecar_identity_seals_match_identity_string(self):
        """Capability-owning c-lists retain identity exclusively in metadata."""
        checked = 0
        for token in LUMP_TOKENS:
            sc = _load_sidecar(token)
            if not sc or sc.get("identity_seal_location") != "sidecar":
                continue
            identity_string = sc.get("identity_string", "")
            assert identity_string, (
                f"{token}: sidecar identity seal has no identity_string"
            )
            expected = hashlib.sha256(
                identity_string.encode("utf-8")
            ).hexdigest()
            assert sc.get("identity_hash") == expected, (
                f"{token}: sidecar identity_hash does not match identity_string"
            )
            checked += 1
        assert checked >= 1, "No production sidecar identity seal was found"


class TestR19_NoProductionStubLumps:
    """R19: No shipped .lump binary in server/lumps/ may have an all-RETURN code
    region.  An all-RETURN LUMP is a stub — every callable method returns
    immediately, which triggers STUB_METHOD faults at runtime.  This rule
    prevents accidentally merging a compiler placeholder as a real abstraction.
    (WIP-status lumps are excluded — they are allowed to be stubs while in
    development.)
    """

    @pytest.mark.parametrize("token", _R19_NON_WIP_TOKENS)
    def test_no_production_lump_is_all_stub(self, token):
        lump_path = _TOKEN_PATHS[token]["lump"]
        if not os.path.exists(lump_path):
            pytest.skip(f"lump file not on disk: {lump_path}")
        with open(lump_path, "rb") as _f:
            data = _f.read()
        name = os.path.basename(lump_path)
        cw = (int.from_bytes(data[:4], "big") >> 10) & 0x1FFF if len(data) >= 4 else 0
        assert not _lump_is_all_stub(data), (
            f"{name} (token {token}): all {cw} code word(s) are RETURN instructions "
            "— this is a stub LUMP.  Implement the methods or mark status='wip' "
            "if still in development."
        )


# ── R20: canonical filename Number must match recomputed hash ─────────────────
# Scope: ALL manifest entries that carry a dot_name field.
# Having dot_name means the entry is under the canonical naming regime, so:
#   1. filename must be set
#   2. filename must match the canonical pattern
#   3. the canonical file must exist on disk
#   4. recomputed sha256(dot_name_utf8 + lump_bytes)[:8] must equal the Number
#
# Tests use pytest.fail (not pytest.skip) for missing/malformed data so future
# regressions in migration coverage are hard failures, not silent omissions.

_CANONICAL_FN_RE = _re.compile(r'^.+\.(\d+)\.([0-9a-f]{8})\.lump$', _re.IGNORECASE)

# Parametrize on every entry that has dot_name (regardless of filename state).
_R20_TOKENS = [
    _me.get("token", "").lower()
    for _me in MANIFEST
    if _me.get("dot_name")
]
_R20_BY_TOKEN: dict = {
    _me.get("token", "").lower(): _me
    for _me in MANIFEST
    if _me.get("dot_name")
}


class TestR20_CanonicalFilenameIntegrity:
    """R20: Every manifest entry with a dot_name must have a canonical filename
    whose Number matches sha256(dot_name_utf8 + lump_bytes)[:8].

    dot_name present → entry is under canonical naming regime → all four
    sub-rules are REQUIRED (not optional/skippable):
      a. filename field is set
      b. filename is in Dot.Name.n.XXXXXXXX.lump format
      c. canonical file exists on disk
      d. recomputed Number equals the filename's Number segment

    A mismatch or missing file means migration did not complete correctly.
    Fix by re-running: python3 scripts/migrate_lump_names.py
    """

    @pytest.mark.parametrize("token", _R20_TOKENS)
    def test_canonical_filename_is_set_and_formatted(self, token):
        """(a + b) filename is present and in canonical format."""
        me = _R20_BY_TOKEN[token]
        dot_name = me.get("dot_name", "")
        filename = me.get("filename", "")
        assert filename, (
            f"token {token} (dot_name={dot_name!r}) has no filename in manifest.json.\n"
            "A dot_name entry MUST have a canonical filename.\n"
            "Fix: run scripts/migrate_lump_names.py"
        )
        assert _CANONICAL_FN_RE.match(filename), (
            f"token {token} (dot_name={dot_name!r}): filename {filename!r} is not in\n"
            "canonical Dot.Name.n.XXXXXXXX.lump format.\n"
            "Fix: run scripts/migrate_lump_names.py"
        )

    @pytest.mark.parametrize("token", _R20_TOKENS)
    def test_canonical_file_exists_on_disk(self, token):
        """(c) The canonical file referenced by filename must exist on disk."""
        me = _R20_BY_TOKEN[token]
        dot_name = me.get("dot_name", "")
        filename = me.get("filename", "")
        if not filename or not _CANONICAL_FN_RE.match(filename):
            pytest.fail(
                f"token {token}: cannot check disk presence — filename {filename!r} "
                "is absent or non-canonical (see test_canonical_filename_is_set_and_formatted)."
            )
        lump_path = os.path.join(LUMPS_DIR, filename)
        assert os.path.isfile(lump_path), (
            f"token {token} (dot_name={dot_name!r}): canonical file {filename!r} is "
            "not on disk.\n"
            "Fix: run scripts/migrate_lump_names.py"
        )

    @pytest.mark.parametrize("token", _R20_TOKENS)
    def test_filename_number_matches_content(self, token):
        """(d) Recomputed sha256(dot_name_utf8 + lump_bytes)[:8] must equal filename Number."""
        me = _R20_BY_TOKEN[token]
        dot_name = me.get("dot_name", "")
        filename  = me.get("filename", "")
        if not filename or not _CANONICAL_FN_RE.match(filename):
            pytest.fail(
                f"token {token}: cannot validate hash — filename {filename!r} is "
                "absent or non-canonical (see test_canonical_filename_is_set_and_formatted)."
            )
        lump_path = os.path.join(LUMPS_DIR, filename)
        if not os.path.isfile(lump_path):
            pytest.fail(
                f"token {token}: canonical file {filename!r} missing on disk "
                "(see test_canonical_file_exists_on_disk)."
            )
        with open(lump_path, "rb") as _f:
            raw = _f.read()
        n_words = len(raw) // 4
        lump_bytes = raw[: n_words * 4]

        _m = _CANONICAL_FN_RE.match(filename)
        expected_number = _m.group(2).lower()

        h = hashlib.sha256()
        h.update(dot_name.encode("utf-8"))
        h.update(lump_bytes)
        actual_number = h.hexdigest()[:8]

        assert actual_number == expected_number, (
            f"Filename integrity failure for {filename} (token {token}):\n"
            f"  dot_name        : {dot_name!r}\n"
            f"  expected Number : {expected_number}  (from filename)\n"
            f"  actual Number   : {actual_number}  (sha256({dot_name!r} + {len(lump_bytes)}b)[:8])\n"
            "The file was renamed without updating its content or its content was\n"
            "replaced without renaming.  Fix by re-running:\n"
            "  python3 scripts/migrate_lump_names.py"
        )

    def test_validation_helper_detects_tampered_hash(self, tmp_path):
        """The server's check_lump_canonical_integrity helper must return an
        error string (not True or None) when content or metadata is wrong.

        Imports the real function from server/lump_integrity.py — not a
        duplicate — so defects in the actual implementation are caught here.
        Covers: good content, tampered bytes, wrong Number in filename, wrong
        name segment, wrong issue_n, missing filename field, and legacy entry
        (no dot_name → returns None).
        """
        import sys, json as _json, hashlib as _hl, struct as _st

        # Make server/lump_integrity importable without triggering Flask startup
        _server_dir = os.path.normpath(
            os.path.join(os.path.dirname(__file__), "..", "..", "server")
        )
        if _server_dir not in sys.path:
            sys.path.insert(0, _server_dir)
        from lump_integrity import check_lump_canonical_integrity as _check

        # Build a minimal synthetic lump dir + manifest
        dot_name = "TestAbstraction"
        issue_n  = 1
        lump_words = [0xF8000401, 0x1F000000] + [0] * 62  # 64-word lump
        lump_bytes = _st.pack(">64I", *lump_words)
        number = _hl.sha256(dot_name.encode("utf-8") + lump_bytes).hexdigest()[:8]
        canonical_fname = f"{dot_name}.{issue_n}.{number}.lump"

        (tmp_path / canonical_fname).write_bytes(lump_bytes)

        def _write_manifest(entries):
            (tmp_path / "manifest.json").write_text(_json.dumps(entries))

        _write_manifest([{
            "token": "deadcafe", "dot_name": dot_name,
            "issue_n": issue_n, "filename": canonical_fname,
        }])

        # --- Good bytes → True
        result = _check(str(tmp_path), "deadcafe", lump_bytes)
        assert result is True, f"Expected True for valid content, got {result!r}"

        # --- Tampered bytes → error string
        tampered = bytearray(lump_bytes)
        tampered[8] ^= 0xFF
        result = _check(str(tmp_path), "deadcafe", bytes(tampered))
        assert isinstance(result, str), (
            f"Expected an error string for tampered content, got {result!r}"
        )

        # --- Wrong Number in filename → error string
        wrong_number_fname = f"{dot_name}.{issue_n}.00000000.lump"
        (tmp_path / wrong_number_fname).write_bytes(lump_bytes)
        _write_manifest([{
            "token": "deadcafe", "dot_name": dot_name,
            "issue_n": issue_n, "filename": wrong_number_fname,
        }])
        result = _check(str(tmp_path), "deadcafe", lump_bytes)
        assert isinstance(result, str), (
            f"Expected error for mismatched Number in filename, got {result!r}"
        )

        # --- Wrong name segment in filename → error string
        wrong_name_fname = f"WrongName.{issue_n}.{number}.lump"
        (tmp_path / wrong_name_fname).write_bytes(lump_bytes)
        _write_manifest([{
            "token": "deadcafe", "dot_name": dot_name,
            "issue_n": issue_n, "filename": wrong_name_fname,
        }])
        result = _check(str(tmp_path), "deadcafe", lump_bytes)
        assert isinstance(result, str), (
            f"Expected error for mismatched name segment in filename, got {result!r}"
        )

        # --- Wrong issue_n in filename → error string
        wrong_issue_fname = f"{dot_name}.99.{number}.lump"
        (tmp_path / wrong_issue_fname).write_bytes(lump_bytes)
        _write_manifest([{
            "token": "deadcafe", "dot_name": dot_name,
            "issue_n": issue_n, "filename": wrong_issue_fname,
        }])
        result = _check(str(tmp_path), "deadcafe", lump_bytes)
        assert isinstance(result, str), (
            f"Expected error for mismatched issue_n in filename, got {result!r}"
        )

        # --- No filename field → error string
        _write_manifest([{"token": "deadcafe", "dot_name": dot_name, "issue_n": issue_n}])
        result = _check(str(tmp_path), "deadcafe", lump_bytes)
        assert isinstance(result, str), (
            f"Expected error when filename is absent, got {result!r}"
        )

        # --- Missing issue_n field → error string (required for every dot_name entry)
        _write_manifest([{
            "token": "deadcafe", "dot_name": dot_name, "filename": canonical_fname,
        }])
        result = _check(str(tmp_path), "deadcafe", lump_bytes)
        assert isinstance(result, str), (
            f"Expected error when issue_n is absent from a dot_name entry, got {result!r}"
        )

        # --- issue_n = 0 (non-positive) → error string
        zero_issue_fname = f"{dot_name}.0.{number}.lump"
        (tmp_path / zero_issue_fname).write_bytes(lump_bytes)
        _write_manifest([{
            "token": "deadcafe", "dot_name": dot_name,
            "issue_n": 0, "filename": zero_issue_fname,
        }])
        result = _check(str(tmp_path), "deadcafe", lump_bytes)
        assert isinstance(result, str), (
            f"Expected error for issue_n=0 (non-positive), got {result!r}"
        )

        # --- issue_n is a non-numeric string → error string
        _write_manifest([{
            "token": "deadcafe", "dot_name": dot_name,
            "issue_n": "NaN", "filename": canonical_fname,
        }])
        result = _check(str(tmp_path), "deadcafe", lump_bytes)
        assert isinstance(result, str), (
            f"Expected error for non-numeric issue_n='NaN', got {result!r}"
        )

        # --- Legacy entry (no dot_name) → None (no validation)
        _write_manifest([{"token": "deadcafe"}])
        result = _check(str(tmp_path), "deadcafe", lump_bytes)
        assert result is None, (
            f"Expected None for legacy entry with no dot_name, got {result!r}"
        )

        # --- Token not in manifest → None (not applicable)
        _write_manifest([{"token": "othertok", "dot_name": dot_name,
                          "issue_n": issue_n, "filename": canonical_fname}])
        result = _check(str(tmp_path), "deadcafe", lump_bytes)
        assert result is None, (
            f"Expected None for token not in manifest, got {result!r}"
        )


# ══════════════════════════════════════════════════════════════════════════════
# R21 — Freespace zero-fill
# ══════════════════════════════════════════════════════════════════════════════

_R21_FREESPACE_EXCEPTIONS: frozenset = frozenset([])
_V13_CONTENT_FRAME_FLAGS: frozenset = frozenset({0x00, 0x01, 0x03, 0x05, 0x07})


def _validate_v13_content_frame(words, fs_start: int, fs_end: int, token: str) -> int:
    """Validate the V1.3 0xAB frame at *fs_start* and return its end word.

    The caller has already established that the frame header is present.  The
    returned index is the first trailing zero-fill word, or ``fs_end`` when the
    frame consumes all remaining freespace.
    """
    frame_header = words[fs_start]
    flags = (frame_header >> 16) & 0xFF
    api_len = frame_header & 0xFFFF
    assert flags in _V13_CONTENT_FRAME_FLAGS, (
        f"{token}: V1.3 content frame at word {fs_start} has unsupported "
        f"flags 0x{flags:02X}; expected one of "
        f"{', '.join(f'0x{value:02X}' for value in sorted(_V13_CONTENT_FRAME_FLAGS))}."
    )
    assert api_len > 0, (
        f"{token}: V1.3 content frame at word {fs_start} has an empty API "
        "definition. Rebuild the LUMP with a non-empty API JSON object."
    )

    api_words = (api_len + 3) // 4
    frame_end = fs_start + 1 + api_words
    assert frame_end <= fs_end, (
        f"{token}: V1.3 content frame API extends through word "
        f"{frame_end - 1}, beyond freespace ending at word {fs_end - 1}."
    )
    api_remainder = api_len % 4
    if api_remainder:
        api_padding_mask = (1 << (8 * (4 - api_remainder))) - 1
        assert words[frame_end - 1] & api_padding_mask == 0, (
            f"{token}: V1.3 content frame API has non-zero padding bytes in "
            f"word {frame_end - 1}."
        )

    if flags & 0x01:
        assert frame_end < fs_end, (
            f"{token}: V1.3 content frame declares source bytes but has "
            "no source-length word in freespace."
        )
        source_len = words[frame_end]
        assert source_len > 0, (
            f"{token}: V1.3 content frame declares source bytes but its "
            "source length is zero."
        )
        source_words = (source_len + 3) // 4
        frame_end += 1 + source_words
        assert frame_end <= fs_end, (
            f"{token}: V1.3 content frame source extends through word "
            f"{frame_end - 1}, beyond freespace ending at word {fs_end - 1}."
        )
        source_remainder = source_len % 4
        if source_remainder:
            source_padding_mask = (1 << (8 * (4 - source_remainder))) - 1
            assert words[frame_end - 1] & source_padding_mask == 0, (
                f"{token}: V1.3 content frame source has non-zero padding bytes "
                f"in word {frame_end - 1}."
            )

    return frame_end


class TestR21_FreespaceZeroFill:
    """R21: Freespace is zero-filled outside a valid V1.3 content frame.

    Pre-V1.3 LUMPs have an entirely zero-filled freespace zone.  V1.3 catalog
    LUMPs may begin that zone with one bounded 0xAB self-definition frame
    containing compact API JSON and optional source bytes.  The remainder must
    remain zero-filled.  Exceptions documented in
    _R21_FREESPACE_EXCEPTIONS are exempt.
    """

    @pytest.mark.parametrize("token", LUMP_TOKENS)
    def test_freespace_is_zero(self, token):
        if token in _R21_FREESPACE_EXCEPTIONS:
            pytest.skip(
                f"{token}: freespace exempted — see _R21_FREESPACE_EXCEPTIONS "
                "for rationale (SPEC-EXCEPTION)"
            )
        if not _lump_exists(token):
            pytest.skip(f"lump file absent for {token} (covered by R10)")

        path = _lump_path(token)
        with open(path, "rb") as f:
            raw = f.read()
        words = struct.unpack(f">{len(raw) // 4}I", raw)
        h = _parse_header(words[0])

        if not h["valid"]:
            pytest.skip(f"{token}: invalid header magic — covered by R1")
        if len(words) != h["lump_sz"]:
            pytest.skip(f"{token}: file-size mismatch — covered by R2")

        cw      = h["cw"]
        cc      = h["cc"]
        typ     = h["typ"]
        lump_sz = h["lump_sz"]

        # Namespace LUMPs (typ=10, cw=0): body is the NS Table — binary data,
        # not freespace.  Skip R21 (scanning NS entries as padding is invalid).
        if typ == 0b10 and cw == 0:
            pytest.skip(
                f"{token}: Namespace LUMP (typ=10, cw=0) — body is the NS Table, "
                "not freespace; R21 does not apply (CM_LUMP_SPECIFICATION.md Appendix B)"
            )

        # Data LUMPs (typ=01): entire body is programmer-defined payload, not
        # freespace.  The concept of a zero-fill freespace zone does not apply.
        if typ == 0b01:
            pytest.skip(
                f"{token}: data LUMP (typ=01) — body is programmer payload, "
                "not freespace; R21 does not apply"
            )

        # Thread LUMPs (typ=10, cw>0): freespace is the collision zone between
        # the heap (grows ↑ from word 17+heapWords) and the stack (grows ↓ to
        # word lumpSize-12-sw).  Use Thread-specific geometry, not generic cw/cc.
        # (CM_LUMP_SPECIFICATION.md Appendix A, "Zone Constants" table.)
        if typ == 0b10 and cw > 0:
            sw      = cw   # cw field is sw (stack words) for Thread LUMPs
            hw      = cc   # cc field is heapWords for Thread LUMPs
            fs_start = 17 + hw          # first word after heap zone
            fs_end   = lump_sz - 12 - sw  # first stack word (exclusive end)
        else:
            # Executable data words follow code and are not freespace.  The
            # header does not encode dw, so recover it from the manifest.
            manifest_entry = next(
                (entry for entry in MANIFEST
                 if entry.get("token", "").lower() == token.lower()),
                {},
            )
            dw = int(manifest_entry.get("dw", 0) or 0)
            fs_start = 1 + cw + dw
            fs_end   = lump_sz - cc

        if fs_start >= fs_end:
            return  # no freespace zone (fully packed or empty collision zone)

        frame_end = fs_start
        frame_header = words[fs_start]
        if (frame_header >> 24) & 0xFF == 0xAB:
            frame_end = _validate_v13_content_frame(
                words, fs_start, fs_end, token
            )

        dirty = [
            (i, words[i])
            for i in range(frame_end, fs_end)
            if words[i] != 0
        ]

        assert not dirty, (
            f"{token}: {len(dirty)} non-zero word(s) after its V1.3 content frame "
            "in freespace zone "
            f"(words {fs_start}–{fs_end - 1}); "
            f"first dirty word: [word {dirty[0][0]}] = 0x{dirty[0][1]:08X}.\n"
            "  Mint step 7 permits only the bounded V1.3 0xAB content frame; "
            "all remaining freespace must be 0x00000000.\n"
            "  Re-pack the binary so the content frame is bounded and remaining "
            "freespace is zero-filled, or add\n"
            "  a SPEC-EXCEPTION entry to _R21_FREESPACE_EXCEPTIONS with rationale."
        )


def _r21_test_frame_words(flags: int, api: bytes = b'{}', source: bytes | None = None):
    """Build a small valid V1.3 frame and its free-space boundary for unit tests."""
    def _pack(data: bytes):
        return [
            int.from_bytes(data[pos:pos + 4].ljust(4, b'\0'), 'big')
            for pos in range(0, len(data), 4)
        ]

    words = [((0xAB << 24) | (flags << 16) | len(api)), *_pack(api)]
    if flags & 0x01:
        assert source is not None
        words.extend([len(source), *_pack(source)])
    words.extend([0, 0])
    return words, len(words)


class TestR21V13ContentFrameValidation:
    """Focused V1.3 framing regression checks for the consistency validator."""

    def test_compressed_tier_one_frame_is_valid(self):
        words, fs_end = _r21_test_frame_words(0x05, source=b'x')
        assert _validate_v13_content_frame(words, 0, fs_end, "test") == fs_end - 2

    def test_rejects_zero_source_length(self):
        words, fs_end = _r21_test_frame_words(0x01, source=b'')
        with pytest.raises(AssertionError, match="source length is zero"):
            _validate_v13_content_frame(words, 0, fs_end, "test")

    def test_rejects_nonzero_api_padding(self):
        words, fs_end = _r21_test_frame_words(0x00)
        words[1] |= 0x01
        with pytest.raises(AssertionError, match="API has non-zero padding"):
            _validate_v13_content_frame(words, 0, fs_end, "test")

    def test_rejects_nonzero_source_padding(self):
        words, fs_end = _r21_test_frame_words(0x01, source=b'x')
        words[3] |= 0x01
        with pytest.raises(AssertionError, match="source has non-zero padding"):
            _validate_v13_content_frame(words, 0, fs_end, "test")


# ══════════════════════════════════════════════════════════════════════════════
# R22 — C-list GT Word 0 format
# ══════════════════════════════════════════════════════════════════════════════

def _rgt_check_word(w: int) -> str | None:
    """Return an error string if GT Word 0 `w` is structurally malformed, else None.

    Rules per CM_LUMP_SPECIFICATION.md v1.2 §"Word 0 — The Golden Token":
      - Null GT (all-zero) is always valid.
      - For all non-null GTs: spare bit 26 must be 0.
        Mint step 8 rejects any GT Word 0 where bit 26 is set.
    """
    w = w & 0xFFFFFFFF
    if w == 0:
        return None  # null GT always valid

    spare = (w >> 26) & 0x1
    if spare != 0:
        return (
            f"spare bit 26 = 1 in GT Word 0 = 0x{w:08X} "
            "(CM_LUMP_SPECIFICATION.md v1.2 §\"Word 0\" requires bit 26 = 0; "
            "Mint step 8 will reject this lump)"
        )

    return None


# SPEC-EXCEPTION: Ethernet.1.b169bba4.lump (token b169bba4) and
# Tunnel.1.8770bf03.lump (token 00001f00) carry Abstract GTs in v2.0
# hardware encoding where bits[26:25]=11 encodes the Abstract type.
# That places bit 26 = 1, violating the spec v1.2 spare-bit requirement
# (the spec puts gt_type at bits[24:23] and reserves bit 26 as spare=0).
# Both binaries were compiled against v2.0 hardware before the canonical
# spec was frozen at v1.2.  Rebuilding with spec v1.2 GT format is pending.
#
# SPEC-EXCEPTION: WukongCallHome.1.71c2809c.lump (token 00000700) has
# c-list[1] = 0xFEED0000, the legacy simulator pending-capability marker.
# It is deferred-resolution state, not an issued GT, and is retained so the
# historical Wukong boot binary remains executable. Newly saved LUMPs reject
# pending markers before Mint, so this exception does not relax the format
# contract for newly issued artifacts.
_R22_CLIST_GT_EXCEPTIONS: frozenset = frozenset([
    "00001f00",  # Tunnel.1 — c-list[0]=0x07800200: v2.0 Abstract GT, bit26=1.
                 # SPEC-EXCEPTION: predates spec v1.2 GT Word 0 layout; rebuild pending.
    "b169bba4",  # Ethernet.1 — c-list[0]=0x07800400: v2.0 Abstract GT, bit26=1.
                 # SPEC-EXCEPTION: predates spec v1.2 GT Word 0 layout; rebuild pending.
    "00000700",  # WukongCallHome — c-list[1]=0xFEED0000: legacy pending capability.
                 # SPEC-EXCEPTION: deferred resolution marker, not an issued GT.
])


class TestR22_ClistGtFormat:
    """R22: Every non-null c-list slot must contain a well-formed GT Word 0.

    Mint step 8 validates every c-list entry before issuing any GT for the
    lump.  A malformed GT Word 0 — e.g. spare bit 26 set in a non-Abstract
    GT — will cause Mint to reject the entire lump.

    Null GTs (0x00000000) are always valid; they are the compile-time
    placeholder for capabilities injected at deployment time.

    Abstract GTs (v2.0 gt_type bits[26:25]=11) are exempt from the
    spare-bit check because bit 26 is part of their type encoding in
    v2.0 hardware format.

    Tokens in _R22_CLIST_GT_EXCEPTIONS are fully exempt (document reason
    with a SPEC-EXCEPTION comment when adding).
    """

    @pytest.mark.parametrize("token", LUMP_TOKENS)
    def test_clist_gt_format(self, token):
        if token in _R22_CLIST_GT_EXCEPTIONS:
            pytest.skip(
                f"{token}: c-list GT format exempted — see _R22_CLIST_GT_EXCEPTIONS "
                "for rationale (SPEC-EXCEPTION)"
            )
        if not _lump_exists(token):
            pytest.skip(f"lump file absent for {token} (covered by R10)")

        path = _lump_path(token)
        with open(path, "rb") as f:
            raw = f.read()
        words = struct.unpack(f">{len(raw) // 4}I", raw)
        h = _parse_header(words[0])

        if not h["valid"]:
            pytest.skip(f"{token}: invalid header magic — covered by R1")
        if len(words) != h["lump_sz"]:
            pytest.skip(f"{token}: file-size mismatch — covered by R2")

        cc     = h["cc"]
        cw     = h["cw"]
        typ    = h["typ"]
        lump_sz = h["lump_sz"]

        # Namespace LUMPs (typ=10, cw=0): body is the NS Table — no GT c-list.
        # Scanning NS Table entries as GT Word 0 values would produce false errors.
        # Skip R22 for Namespace LUMPs.
        if typ == 0b10 and cw == 0:
            pytest.skip(
                f"{token}: Namespace LUMP (typ=10, cw=0) — body is the NS Table, "
                "not a GT c-list; R22 does not apply (CM_LUMP_SPECIFICATION.md Appendix B)"
            )

        # Data LUMPs (typ=01): no c-list; body is programmer payload.  Skip R22.
        if typ == 0b01:
            pytest.skip(
                f"{token}: data LUMP (typ=01) — no c-list; R22 does not apply"
            )

        # Thread LUMPs (typ=10, cw>0): the caps zone is architecture-fixed at
        # the last 12 words (lumpSize-12..lumpSize-1), regardless of cc (heapWords).
        # (CM_LUMP_SPECIFICATION.md Appendix A, "C-List at the Tail — Zone ①".)
        if typ == 0b10 and cw > 0:
            caps_count = 12      # architecture-fixed caps zone
            clist_start = lump_sz - caps_count
        else:
            if cc == 0:
                return  # no c-list to check
            caps_count  = cc
            clist_start = lump_sz - cc

        violations = []
        for i in range(caps_count):
            w = words[clist_start + i] & 0xFFFFFFFF
            if _declared_allocation_placeholder(token, i, w):
                continue
            err = _rgt_check_word(w)
            if err is not None:
                slot_label = "caps" if (typ == 0b10 and cw > 0) else "c-list"
                violations.append(f"  {slot_label} [{i}]: {err}")

        assert not violations, (
            f"{token}: {len(violations)} malformed GT Word 0 value(s) in "
            f"{'caps zone' if (typ == 0b10 and cw > 0) else 'c-list'} "
            f"(Mint step 8 will reject this lump):\n" + "\n".join(violations) + "\n"
            "  Correct the GT values in the binary, or add a SPEC-EXCEPTION entry\n"
            "  to _R22_CLIST_GT_EXCEPTIONS with a documented rationale."
        )


# ══════════════════════════════════════════════════════════════════════════════
# R21/R22 — Synthetic unit fixtures for Thread and data LUMP geometry
# ══════════════════════════════════════════════════════════════════════════════
#
# No Thread or data LUMPs exist in server/lumps/ at this time, so the
# parametrised R21/R22 classes above cannot exercise Thread- and data-lump
# code paths against real binaries.  The unit fixtures below construct
# synthetic word arrays and call the same validation logic directly, ensuring
# the geometry branches are regression-tested even without stored binaries.

import math as _math


def _build_thread_hdr(lump_sz: int, sw: int, hw: int) -> int:
    """Encode a Thread LUMP header word (typ=10, cw=sw, cc=hw)."""
    n_m6 = lump_sz.bit_length() - 7  # lump_sz = 2^(n_m6+6)
    return (0x1F << 27) | (n_m6 << 23) | (sw << 10) | (0b10 << 8) | hw


def _build_data_hdr(lump_sz: int) -> int:
    """Encode a data LUMP header word (typ=01, cw=0, cc=0)."""
    n_m6 = lump_sz.bit_length() - 7
    return (0x1F << 27) | (n_m6 << 23) | (0 << 10) | (0b01 << 8) | 0


def _thread_freespace_range(lump_sz: int, sw: int, hw: int):
    """Return (fs_start, fs_end) for Thread LUMP freespace (exclusive end)."""
    return (17 + hw, lump_sz - 12 - sw)


def _thread_caps_range(lump_sz: int):
    """Return (caps_start, caps_end) — 12 architecture-fixed cap words."""
    return (lump_sz - 12, lump_sz)


def _parse_words(words):
    """Run R21/R22 logic on a synthetic word list; return (freespace_dirty, cap_violations)."""
    h = _parse_header(words[0])
    cw = h["cw"]; cc = h["cc"]; typ = h["typ"]; lump_sz = h["lump_sz"]
    # R21 freespace
    freespace_dirty = []
    if typ == 0b10 and cw > 0:  # Thread
        fs_start, fs_end = _thread_freespace_range(lump_sz, cw, cc)
        freespace_dirty = [i for i in range(fs_start, fs_end) if words[i] != 0]
    elif typ not in (0b01, 0b10):  # standard (skip Namespace/data)
        fs_start = 1 + cw; fs_end = lump_sz - cc
        freespace_dirty = [i for i in range(fs_start, fs_end) if words[i] != 0]
    # R22 caps/c-list
    cap_violations = []
    if typ == 0b10 and cw > 0:  # Thread: 12 fixed caps
        caps_start, caps_end = _thread_caps_range(lump_sz)
        for i in range(caps_start, caps_end):
            err = _rgt_check_word(words[i])
            if err:
                cap_violations.append((i - caps_start, err))
    elif typ not in (0b01, 0b10):  # standard: cc tail words
        for si in range(cc):
            err = _rgt_check_word(words[lump_sz - cc + si])
            if err:
                cap_violations.append((si, err))
    return freespace_dirty, cap_violations


class TestR21_ThreadGeometryUnit:
    """Synthetic unit tests: R21 freespace geometry for Thread LUMPs.

    A 64-word Thread (sw=4, hw=4) has:
      header[0], DR[1..16], heap[17..20], freespace[21..47], stack[48..51], caps[52..63].
    Non-zero DR, heap, and stack words must NOT be flagged as freespace dirt.
    Non-zero words inside [21..47] must be flagged.
    """

    LUMP_SZ = 64
    SW       = 4
    HW       = 4

    def _make_thread(self, dirty_word: int | None = None,
                     bad_cap: int | None = None) -> list[int]:
        """Build a 64-word Thread LUMP word array.

        dirty_word: word offset within the lump to set to 0xDEADBEEF (freespace dirt).
        bad_cap: caps-zone index (0-11) to fill with a malformed GT (bit26=1).
        """
        words = [0] * self.LUMP_SZ
        words[0] = _build_thread_hdr(self.LUMP_SZ, self.SW, self.HW)
        # Non-zero live thread state (must NOT be flagged by R21)
        for i in range(1, 17):              # DRs
            words[i] = 0x12340000 + i
        for i in range(17, 17 + self.HW):  # heap
            words[i] = 0xBEEF0000 + i
        stack_base = self.LUMP_SZ - 12 - self.SW
        for i in range(stack_base, stack_base + self.SW):  # stack
            words[i] = 0xCAFE0000 + i
        # Freespace [21..47] is all-zero by default
        if dirty_word is not None:
            words[dirty_word] = 0xDEADBEEF
        # Caps zone [52..63]: valid null GTs by default
        if bad_cap is not None:
            words[self.LUMP_SZ - 12 + bad_cap] = 0x04000001  # bit26=1
        return words

    def test_valid_thread_no_freespace_dirt(self):
        """Non-zero DRs, heap, and stack are NOT treated as freespace dirt."""
        words = self._make_thread()
        dirty, _ = _parse_words(words)
        assert not dirty, (
            f"R21 incorrectly flagged {len(dirty)} non-freespace word(s) as dirt: "
            f"{[f'[{i}]=0x{words[i]:08X}' for i in dirty[:5]]}"
        )

    def test_dirty_freespace_detected(self):
        """A non-zero word in the collision zone is detected by R21."""
        fs_start, _ = _thread_freespace_range(self.LUMP_SZ, self.SW, self.HW)
        dirty_idx = fs_start + 3   # arbitrary freespace word
        words = self._make_thread(dirty_word=dirty_idx)
        dirty, _ = _parse_words(words)
        assert dirty_idx in dirty, (
            f"R21 failed to detect dirty freespace at word {dirty_idx}"
        )

    def test_heap_not_scanned_as_freespace(self):
        """Non-zero heap words are before fs_start and must not appear in dirty list."""
        words = self._make_thread()
        # fs_start = 17 + HW = 21; heap is 17..20 → outside freespace range
        dirty, _ = _parse_words(words)
        heap_idxs_in_dirty = [i for i in dirty if 17 <= i < 17 + self.HW]
        assert not heap_idxs_in_dirty, (
            f"R21 incorrectly included heap word(s) {heap_idxs_in_dirty} in dirty list"
        )

    def test_stack_not_scanned_as_freespace(self):
        """Non-zero stack words are at/after fs_end and must not appear in dirty list."""
        words = self._make_thread()
        _, fs_end = _thread_freespace_range(self.LUMP_SZ, self.SW, self.HW)
        dirty, _ = _parse_words(words)
        stack_idxs_in_dirty = [i for i in dirty if i >= fs_end]
        assert not stack_idxs_in_dirty, (
            f"R21 incorrectly included stack word(s) {stack_idxs_in_dirty} in dirty list"
        )


class TestR22_ThreadCapsUnit:
    """Synthetic unit tests: R22 scans the final 12 words for Thread LUMPs.

    A valid Thread cap is 0x00000000 (null) or any GT Word 0 with bit26=0.
    A malformed Thread cap has bit26=1.
    """

    LUMP_SZ = 64
    SW       = 4
    HW       = 4

    def _make_thread(self, bad_cap: int | None = None) -> list[int]:
        words = [0] * self.LUMP_SZ
        words[0] = _build_thread_hdr(self.LUMP_SZ, self.SW, self.HW)
        if bad_cap is not None:
            words[self.LUMP_SZ - 12 + bad_cap] = 0x04000001  # bit26=1
        return words

    def test_all_null_caps_pass(self):
        """All-zero caps zone (null GTs) is valid for R22."""
        words = self._make_thread()
        _, violations = _parse_words(words)
        assert not violations, f"R22 false-positive on null caps: {violations}"

    def test_valid_inform_gt_passes(self):
        """A valid Inform GT (bit26=0) in the caps zone passes R22."""
        words = self._make_thread()
        words[self.LUMP_SZ - 12] = 0x4A000006  # valid GT Word 0: bit26=0
        _, violations = _parse_words(words)
        assert not violations, f"R22 false-positive on valid GT: {violations}"

    def test_malformed_cap_gt_detected(self):
        """A GT with bit26=1 in the caps zone is flagged by R22."""
        words = self._make_thread(bad_cap=0)
        _, violations = _parse_words(words)
        assert violations, "R22 failed to detect malformed cap GT (bit26=1)"
        assert violations[0][0] == 0, f"Wrong violation slot index: {violations[0][0]}"

    def test_non_cap_words_not_scanned(self):
        """R22 only scans the final 12 words; non-zero heap/stack words are ignored."""
        words = self._make_thread()
        # Put a non-zero value with bit26=1 in the heap (word 17) — outside caps
        words[17] = 0x04000001  # bit26=1, but this is heap, not a cap
        _, violations = _parse_words(words)
        heap_violations = [v for v in violations if v[0] < 0 or v[0] >= 12]
        assert not heap_violations, (
            f"R22 scanned beyond the final-12-word caps zone: {heap_violations}"
        )


class TestR21_DataLumpUnit:
    """Synthetic unit tests: R21 skips data LUMPs entirely.

    A data LUMP body is programmer-defined payload, not required-zero freespace.
    Non-zero body words must not be reported as freespace dirt.
    """

    LUMP_SZ = 64

    def _make_data_lump(self) -> list[int]:
        words = [0] * self.LUMP_SZ
        words[0] = _build_data_hdr(self.LUMP_SZ)
        # Programmer payload — non-zero values throughout the body
        for i in range(1, self.LUMP_SZ):
            words[i] = 0xDA7A0000 + i
        return words

    def test_data_body_not_scanned_as_freespace(self):
        """Non-zero data LUMP body words are never treated as freespace dirt."""
        words = self._make_data_lump()
        h = _parse_header(words[0])
        assert h["typ"] == 0b01, f"Expected typ=01, got {h['typ']}"
        # The _parse_words helper skips data LUMPs entirely (freespace_dirty=[])
        dirty, violations = _parse_words(words)
        assert not dirty, (
            f"R21 incorrectly scanned {len(dirty)} data LUMP body word(s) as freespace dirt"
        )
        assert not violations, (
            f"R22 incorrectly flagged {len(violations)} data LUMP body word(s) as bad GTs"
        )


# ── R23: binary_hash integrity ─────────────────────────────────────────────────

import hashlib as _hashlib

_R23_MANIFEST_ENTRIES = [
    e for e in MANIFEST
    if len(e.get("binary_hash", "")) == 64
]

_R23_SIDECAR_TOKENS = [
    tok for tok in JSON_TOKENS
    if (lambda sc: sc is not None and len(sc.get("binary_hash", "")) == 64)(
        _load_sidecar(tok)
    )
]


class TestR23_BinaryHashIntegrity:
    """R23: manifest/sidecar binary_hash (full SHA-256) must equal sha256 of the .lump file.

    Only checked when binary_hash is exactly 64 hex characters.  8-character
    filename-number entries are not the full SHA-256 contract and are skipped.
    """

    @pytest.mark.parametrize("entry", _R23_MANIFEST_ENTRIES, ids=lambda e: e["token"])
    def test_manifest_binary_hash(self, entry):
        token = entry["token"].lower()
        if not _lump_exists(token):
            pytest.skip(f"lump file absent for {token} (covered by R10)")
        with open(_lump_path(token), "rb") as fh:
            actual = _hashlib.sha256(fh.read()).hexdigest()
        assert entry["binary_hash"] == actual, (
            f"{token}: manifest.binary_hash = {entry['binary_hash']!r}\n"
            f"  but sha256({_lump_path(token)}) = {actual!r}.\n"
            "  Update manifest.json binary_hash to the value above, then bump CHANGELOG."
        )

    @pytest.mark.parametrize("token", _R23_SIDECAR_TOKENS)
    def test_sidecar_binary_hash(self, token):
        if not _lump_exists(token):
            pytest.skip(f"lump file absent for {token}")
        sc = _load_sidecar(token)
        with open(_lump_path(token), "rb") as fh:
            actual = _hashlib.sha256(fh.read()).hexdigest()
        assert sc["binary_hash"] == actual, (
            f"{token}: sidecar.binary_hash = {sc['binary_hash']!r}\n"
            f"  but sha256({_lump_path(token)}) = {actual!r}.\n"
            "  Update the sidecar binary_hash to the value above, then bump CHANGELOG."
        )


# ── R24 / R24b: No broken symlinks in the lumps directory ──────────────────────

def _all_lump_filenames():
    """Return sorted list of all .lump filenames (not stems) in LUMPS_DIR."""
    return sorted(fn for fn in os.listdir(LUMPS_DIR) if fn.endswith(".lump"))


def _all_json_filenames():
    """Return sorted list of all .json filenames in LUMPS_DIR (sidecars + manifest)."""
    return sorted(fn for fn in os.listdir(LUMPS_DIR) if fn.endswith(".json"))


_ALL_LUMP_FILENAMES = _all_lump_filenames()
_ALL_JSON_FILENAMES = _all_json_filenames()


class TestR24_NobrokenSymlinks:
    """R24: Every .lump symlink in server/lumps/ must resolve to a real regular file.

    A dangling (broken) symlink produces confusing FileNotFoundError and false
    "missing binary" failures in every other rule instead of a clear diagnostic.
    This rule catches the problem at the earliest possible moment.

    Additionally, symlinks whose target resolves outside the lumps directory are
    flagged as a pytest warning so the gap stays visible without blocking CI.
    """

    @pytest.mark.parametrize("filename", _ALL_LUMP_FILENAMES)
    def test_no_dangling_symlinks(self, filename):
        """Hard fail: a .lump that is a symlink must resolve to a real file."""
        path = os.path.join(LUMPS_DIR, filename)
        if not os.path.islink(path):
            return  # not a symlink — nothing to check here
        target = os.readlink(path)
        resolved = os.path.realpath(path)
        assert os.path.isfile(resolved), (
            f"{filename}: dangling symlink — points to {target!r} which does not exist "
            f"(resolved path: {resolved!r}).\n"
            "  Either restore the missing target file or delete this symlink.\n"
            "  Broken symlinks cause confusing FileNotFoundError failures in every "
            "other lump-consistency rule instead of a clear diagnostic."
        )

    @pytest.mark.parametrize("filename", _ALL_LUMP_FILENAMES)
    def test_symlink_target_inside_lumps_dir(self, filename):
        """Warn (not fail) when a resolving symlink points outside the lumps directory."""
        path = os.path.join(LUMPS_DIR, filename)
        if not os.path.islink(path):
            return  # not a symlink
        resolved = os.path.realpath(path)
        if not os.path.isfile(resolved):
            return  # dangling — already caught by test_no_dangling_symlinks
        lumps_real = os.path.realpath(LUMPS_DIR)
        if not resolved.startswith(lumps_real + os.sep) and resolved != lumps_real:
            target = os.readlink(path)
            warnings.warn(
                f"{filename}: symlink target {target!r} resolves outside the lumps "
                f"directory (resolved: {resolved!r}).\n"
                "  Consider replacing it with a copy or a relative symlink inside "
                "server/lumps/ to avoid accidental dependency on external paths.",
                UserWarning,
                stacklevel=2,
            )


class TestRetiredWukongCallHomeAliases:
    """Historical WukongCallHome aliases must stay retired.

    These files were superseded by the manifest-designated canonical artifact,
    but were later retargeted to one another and formed a symlink cycle.  Their
    historical sidecars describe different binaries, so they cannot safely
    alias the current file.  The archived WukongCallHome_v* binaries preserve
    supported historical versions instead.
    """

    _RETIRED_FILENAMES = (
        "WukongCallHome.1.78f1c4e0.lump",
        "WukongCallHome.1.78f1c4e0.json",
        "WukongCallHome.1.e0c7b11e.lump",
        "WukongCallHome.1.e0c7b11e.json",
        "WukongCallHome.1.f563bc1f.lump",
        "WukongCallHome.1.f563bc1f.json",
    )

    def test_retired_aliases_are_not_discoverable(self):
        """Prevent obsolete aliases from returning to the startup scan."""
        present = sorted(
            filename for filename in self._RETIRED_FILENAMES
            if os.path.lexists(os.path.join(LUMPS_DIR, filename))
        )
        assert not present, (
            "Retired WukongCallHome aliases must not be restored to server/lumps: "
            f"{present}. The manifest canonical file is the supported artifact; "
            "use an explicit archive for preserved historical binaries."
        )


class TestR21_ManifestCwCcMatchBinaryAllEntries:
    """R21: Every manifest entry with a declared cw or cc field whose .lump file
    is present on disk must have those values match the decoded binary header.

    R5 only runs for entries that declare lump_size.  This rule closes the gap
    by checking *all* manifest entries — including those that omit lump_size —
    so that a cw=0 (or any other corrupt value) in the manifest is caught even
    when lump_size was never added to that entry.

    The check is skipped (not failed) when the .lump file is absent on disk so
    that WIP / not-yet-compiled entries do not break CI.
    """

    @pytest.mark.parametrize(
        "entry", MANIFEST_ENTRIES_WITH_CW_OR_CC, ids=lambda e: e["token"]
    )
    def test_manifest_cw_matches_binary(self, entry):
        """manifest.cw must equal the cw decoded from the binary header word."""
        if entry.get("cw") is None:
            return  # entry only declares cc — nothing to check here
        token = entry["token"].lower()
        if not _lump_exists(token):
            pytest.skip(f"lump file absent for {token} (WIP entry — skipped by R21)")
        h = _read_header(token)
        assert entry["cw"] == h["cw"], (
            f"{token}: manifest.cw = {entry['cw']} but binary header cw = {h['cw']}.\n"
            "  The manifest entry's cw field does not match what is encoded in the\n"
            "  .lump binary header word (bits[22:10]).  This mismatch is often caused\n"
            "  by a manual edit to manifest.json that set cw=0 (or another wrong\n"
            "  value) without recompiling the binary, or by a binary replacement\n"
            "  that was not paired with a manifest update.\n"
            "  Update manifest.json to match the compiled binary, then bump CHANGELOG."
        )

    @pytest.mark.parametrize(
        "entry", MANIFEST_ENTRIES_WITH_CW_OR_CC, ids=lambda e: e["token"]
    )
    def test_manifest_cc_matches_binary(self, entry):
        """manifest.cc must equal the cc decoded from the binary header word."""
        if entry.get("cc") is None:
            return  # entry only declares cw — nothing to check here
        token = entry["token"].lower()
        if not _lump_exists(token):
            pytest.skip(f"lump file absent for {token} (WIP entry — skipped by R21)")
        h = _read_header(token)
        assert entry["cc"] == h["cc"], (
            f"{token}: manifest.cc = {entry['cc']} but binary header cc = {h['cc']}.\n"
            "  The manifest entry's cc field does not match what is encoded in the\n"
            "  .lump binary header word (bits[7:0]).  Update manifest.json to match\n"
            "  the compiled binary, then bump CHANGELOG."
        )


class TestR25_GitTrackedLumpsInManifest:
    """R25: Every git-tracked .lump file with a valid header must appear in manifest.json.

    This catches the exact failure mode where a cleanup sweep silently deletes a
    valid LUMP binary because its sidecar used a legacy naming scheme and the file
    had no matching entry under the new canonical filename.

    A git-tracked .lump file that:
      - has valid header magic (bits[31:27] == 0x1F), AND
      - is not listed in manifest.json (by filename or token), AND
      - is not a recognised archive (legacy <token>-vN or new <Name>_vN form)
    is a hard failure — the binary existed in the repo and should have been preserved.

    Files with invalid/corrupt headers are skipped (they were never valid LUMP
    binaries and may be deleted freely).  Server-managed tokens are also exempt.
    """

    # Re-use the server-managed-tokens exempt set from R3.
    _SERVER_MANAGED_TOKENS: frozenset = frozenset(
        t.lower()
        for t in json.load(
            open(os.path.join(LUMPS_DIR, "server_managed_tokens.json"))
        ).get("tokens", [])
    )

    @staticmethod
    def _git_tracked_lump_filenames() -> list:
        """Return basenames of all .lump files currently tracked by git in server/lumps/."""
        try:
            result = subprocess.run(
                ["git", "ls-files", "server/lumps/"],
                capture_output=True, text=True, check=True,
                cwd=os.path.normpath(os.path.join(LUMPS_DIR, "..", "..")),
            )
        except (subprocess.CalledProcessError, FileNotFoundError):
            return []
        names = []
        for line in result.stdout.splitlines():
            line = line.strip()
            if line.endswith(".lump"):
                names.append(os.path.basename(line))
        return sorted(names)

    @staticmethod
    def _build_manifest_filename_set() -> set:
        """Build the complete set of filenames (and token stems) the manifest covers.

        Delegates to ``lump_manifest_utils.build_manifest_filename_set`` so this
        method and ``scripts/check_staged_lumps._staged_manifest_filenames`` share
        a single implementation and can never drift apart.
        """
        return _build_manifest_filename_set_util(MANIFEST)

    def test_git_tracked_lumps_in_manifest(self):
        """Every git-tracked .lump with a valid header must appear in manifest.json."""
        tracked = self._git_tracked_lump_filenames()
        if not tracked:
            pytest.skip("No git-tracked .lump files found (not inside a git repo?)")

        manifest_filenames = self._build_manifest_filename_set()

        orphans = []
        for basename in tracked:
            bl = basename.lower()
            stem = basename[:-5]           # strip .lump

            # Already covered by manifest?
            if bl in manifest_filenames:
                continue

            # Is it a recognised archive? (legacy <token>-vN or new <Name>_vN)
            if _is_archive_stem(stem):
                continue

            # Is it a server-managed token?
            if stem.lower() in self._SERVER_MANAGED_TOKENS:
                continue

            # Resolve the path and validate the binary header.
            path = os.path.join(LUMPS_DIR, basename)
            if not os.path.isfile(path):
                continue                   # broken/dangling — R24 catches it

            try:
                with open(path, "rb") as fh:
                    raw = fh.read(4)
                if len(raw) < 4:
                    continue               # too short to be a valid LUMP
                import struct as _struct
                word = _struct.unpack(">I", raw)[0]
                magic = (word >> 27) & 0x1F
                cw    = (word >> 10) & 0x1FFF
                cc    =  word        & 0xFF
            except OSError:
                continue                   # unreadable — not a guard concern

            if magic != 0x1F:
                continue                   # invalid header — not a LUMP binary

            # Valid header, not in manifest, not an archive, not server-managed.
            orphans.append(
                f"  {basename}  (magic=0x1F, cw={cw}, cc={cc}) — "
                "git-tracked but absent from manifest.json"
            )

        assert not orphans, (
            "Git-tracked .lump files with valid headers that are missing from "
            "manifest.json:\n"
            + "\n".join(orphans)
            + "\n\n"
            "These files were committed to the repository and carry a valid LUMP\n"
            "header, so they should not have been removed from the manifest.\n"
            "Either:\n"
            "  • Add them back to manifest.json (with correct metadata), or\n"
            "  • Delete them from git history with `git rm` if they are truly\n"
            "    obsolete (use `--force` on the orphan-cleanup tool to confirm).\n"
            "Do NOT silently delete or rename them without updating manifest.json."
        )


class TestR25b_GitTrackedArchiveLumpsWarning:
    """R25b: Git-tracked archive .lump files with valid headers emit a pytest warning.

    Archives (<token>-vN.lump and <Name>_vN.lump) are intentional historical
    copies, exempt from the manifest-coverage requirement enforced by R25.
    However, a git-tracked archive that carries a valid LUMP header was once
    a "current" binary; a logged warning keeps it visible to reviewers and
    reminds operators to use ``--archive-cleanup`` before any sweep removes it.

    An archive that is NOT currently tracked by git (never committed, or already
    removed from the index) is silently ignored — only committed archives that
    could still be deleted by a naive cleanup sweep are surfaced here.

    This is a WARNING (not a hard failure) because archives are intentionally
    exempt from the manifest.  The goal is visibility, not a CI block.
    """

    @staticmethod
    def _git_tracked_lump_filenames() -> list:
        """Return basenames of all .lump files currently tracked by git in server/lumps/."""
        try:
            result = subprocess.run(
                ["git", "ls-files", "server/lumps/"],
                capture_output=True, text=True, check=True,
                cwd=os.path.normpath(os.path.join(LUMPS_DIR, "..", "..")),
            )
        except (subprocess.CalledProcessError, FileNotFoundError):
            return []
        names = []
        for line in result.stdout.splitlines():
            line = line.strip()
            if line.endswith(".lump"):
                names.append(os.path.basename(line))
        return sorted(names)

    def test_git_tracked_archive_lumps_warn(self):
        """Git-tracked archive .lump files with valid headers emit a pytest warning.

        This does not block CI — it surfaces archives that were once current
        binaries so reviewers can confirm they are intentionally obsolete before
        any cleanup sweep removes them.
        """
        tracked = set(self._git_tracked_lump_filenames())
        if not tracked:
            pytest.skip("No git-tracked .lump files found (not inside a git repo?)")

        for basename in sorted(tracked):
            stem = basename[:-5]  # strip .lump
            if not _is_archive_stem(stem):
                continue  # non-archives are handled by R25

            path = os.path.join(LUMPS_DIR, basename)
            if not os.path.isfile(path):
                continue  # dangling — R24 catches it

            try:
                with open(path, "rb") as fh:
                    raw = fh.read(4)
                if len(raw) < 4:
                    continue
                import struct as _struct
                word = _struct.unpack(">I", raw)[0]
                magic = (word >> 27) & 0x1F
                cw    = (word >> 10) & 0x1FFF
                cc    =  word        & 0xFF
            except OSError:
                continue

            if magic != 0x1F:
                continue  # invalid header — safe to ignore

            warnings.warn(
                f"R25b: git-tracked archive {basename!r} carries a valid LUMP header "
                f"(magic=0x1F, cw={cw}, cc={cc}) and is absent from manifest.json.\n"
                "  This archive was once a current binary.  Confirm it is intentionally\n"
                "  demoted before any cleanup sweep removes it.\n"
                "  To review all such archives:  "
                "python3 scripts/migrate_lump_names.py --archive-cleanup [--dry-run]",
                UserWarning,
                stacklevel=2,
            )


class TestR24b_NoBrokenJsonSymlinks:
    """R24b: Every .json symlink in server/lumps/ must resolve to a real regular file.

    Covers archive sidecar .json files and manifest.json.  A dangling symlink
    in any of these files produces confusing FileNotFoundError failures in R14
    and other rules rather than a clear diagnostic.

    Additionally, symlinks whose target resolves outside the lumps directory are
    flagged as a pytest warning so the gap stays visible without blocking CI.
    """

    @pytest.mark.parametrize("filename", _ALL_JSON_FILENAMES)
    def test_no_dangling_json_symlinks(self, filename):
        """Hard fail: a .json that is a symlink must resolve to a real file."""
        path = os.path.join(LUMPS_DIR, filename)
        if not os.path.islink(path):
            return  # not a symlink — nothing to check here
        target = os.readlink(path)
        resolved = os.path.realpath(path)
        assert os.path.isfile(resolved), (
            f"{filename}: dangling symlink — points to {target!r} which does not exist "
            f"(resolved path: {resolved!r}).\n"
            "  Either restore the missing target file or delete this symlink.\n"
            "  Broken .json symlinks cause confusing FileNotFoundError failures in R14 "
            "and other lump-consistency rules instead of a clear diagnostic."
        )

    @pytest.mark.parametrize("filename", _ALL_JSON_FILENAMES)
    def test_json_symlink_target_inside_lumps_dir(self, filename):
        """Warn (not fail) when a resolving .json symlink points outside the lumps directory."""
        path = os.path.join(LUMPS_DIR, filename)
        if not os.path.islink(path):
            return  # not a symlink
        resolved = os.path.realpath(path)
        if not os.path.isfile(resolved):
            return  # dangling — already caught by test_no_dangling_json_symlinks
        lumps_real = os.path.realpath(LUMPS_DIR)
        if not resolved.startswith(lumps_real + os.sep) and resolved != lumps_real:
            target = os.readlink(path)
            warnings.warn(
                f"{filename}: symlink target {target!r} resolves outside the lumps "
                f"directory (resolved: {resolved!r}).\n"
                "  Consider replacing it with a copy or a relative symlink inside "
                "server/lumps/ to avoid accidental dependency on external paths.",
                UserWarning,
                stacklevel=2,
            )
