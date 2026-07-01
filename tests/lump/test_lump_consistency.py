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
R7   sidecar fields agree with manifest where both exist.
R8   No duplicate ns_slot values unless all claimants share the same non-null variant_group.
R9   RETIRED — ns_slot=null is implicitly dynamic; ns_slot_policy is optional/informational only.
R10  Every manifest entry with lump_size declared has a .lump file on disk.
R11  Every manifest entry with lump_size declared has a sidecar .json on disk.
R14  Every archive binary has a matching sidecar .json (both old <token>-vN and new <Name>_vN).

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

import json
import os
import re as _re
import struct

import pytest

LUMPS_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "server", "lumps")
)


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
        if not fn.endswith(".json") or fn == "manifest.json":
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

    # Tokens managed entirely by the server at runtime — generated/rewritten on
    # every save and intentionally absent from the public manifest.json.
    # 00000600 = Boot.Abstr (ns_slot 6, regenerated by /api/lumps/save)
    # 00000003 = legacy Boot.Abstr token kept for backward-compat reads
    _SERVER_MANAGED_TOKENS: frozenset = frozenset({"00000600", "00000003"})

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


class TestR7_SidecarMatchesManifest:
    """R7: sidecar fields agree with manifest where both are present.

    Checked fields: cw, cc, lump_size, ns_slot, abstraction, lump_version.
    lump_version is the integer LUMP version (0 = system baseline, 1+ = user-compiled).
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
    """R11: Every manifest entry with lump_size declared has a sidecar .json on disk."""

    def test_sidecar_files_present(self):
        missing = []
        for e in MANIFEST_ENTRIES_WITH_SIZE:
            token = e["token"].lower()
            if not _sidecar_exists(token):
                missing.append(
                    f"{token} ({e.get('abstraction', '?')}) — no sidecar .json on disk at "
                    f"{_sidecar_path(token)}"
                )
        assert not missing, (
            "Manifest entries missing sidecar .json:\n  " + "\n  ".join(missing)
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
    word = word & 0xFFFFFFFF
    gt_type = (word >> 23) & 0x3
    dom     = (word >> 27) & 0x1
    perm3   = (word >> 28) & 0x7
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
        "dom": dom,
        "dom_name": "Church" if dom else "Turing",
        "perm3": perm3,
        "slot_id": slot_id,
        "perms": perms,
    }


BOOT_ABSTR_E_GT = 0x48800003
BOOT_NUCS_X_GT  = 0x40800001

SELFTEST_LUMP_CASES = [
    ("d906a27f", "PostFlashSelftest"),
    ("cb8739cf", "GT Encoding v1.1 Hardware Self-Test"),
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
            "  GT type bits[24:23] must equal 0b01."
        )

    @pytest.mark.parametrize("token,label", SELFTEST_LUMP_CASES)
    def test_slot7_is_inform_type(self, token, label):
        word = _read_clist_word(token, 7)
        gt = _decode_gt(word)
        assert gt["type"] == 1, (
            f"{token} ({label}): c-list[7] = {word:#010x} decodes as "
            f"type={gt['type']} ({gt['type_name']}), expected Inform (1).\n"
            "  GT type bits[24:23] must equal 0b01."
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
