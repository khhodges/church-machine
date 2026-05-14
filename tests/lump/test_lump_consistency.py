"""Three-way LUMP consistency check: binary header <-> manifest.json <-> per-lump sidecar .json

CHANGE CONTROL GATE — this test must pass before any lump binary or metadata change is merged.

Rules enforced
--------------
R1   Every .lump has valid header magic (bits[31:27] = 0x1F).
R2   Binary file size in words == header-declared lump_size.
R3   Every .lump token has a manifest.json entry.
R4   No orphan sidecar .json (every <token>.json needs a matching .lump).
R5   manifest.cw / cc / lump_size == binary header values.
R6   sidecar.cw / cc / lump_size == binary header values (for sidecars that exist).
R7   sidecar fields agree with manifest where both exist.
R8   No duplicate ns_slot values unless all claimants share the same non-null variant_group.
R9   Manifest entries with ns_slot=null MUST carry ns_slot_policy='dynamic'.
R10  Every manifest entry with lump_size declared has a .lump file on disk.
R11  Every manifest entry with lump_size declared has a sidecar .json on disk.

Failure messages are written to be self-diagnosing: they state what was found,
what was expected, and which file to correct.
"""

import json
import os
import struct

import pytest

LUMPS_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "server", "lumps")
)


def _parse_header(word):
    magic   = (word >> 27) & 0x1F
    n_m6    = (word >> 23) & 0xF
    cw      = (word >> 10) & 0x1FFF
    typ     = (word >>  8) & 0x3
    cc      =  word        & 0xFF
    lump_sz = 1 << (n_m6 + 6)
    return dict(magic=magic, cw=cw, typ=typ, cc=cc, lump_sz=lump_sz, valid=(magic == 0x1F))


def _read_header(token):
    path = os.path.join(LUMPS_DIR, f"{token}.lump")
    with open(path, "rb") as f:
        raw = f.read(4)
    if len(raw) < 4:
        return None
    return _parse_header(struct.unpack(">I", raw)[0])


def _word_count(token):
    path = os.path.join(LUMPS_DIR, f"{token}.lump")
    return os.path.getsize(path) // 4


def _load_manifest():
    with open(os.path.join(LUMPS_DIR, "manifest.json")) as f:
        return json.load(f)


def _load_sidecar(token):
    path = os.path.join(LUMPS_DIR, f"{token}.json")
    if not os.path.exists(path):
        return None
    with open(path) as f:
        return json.load(f)


def _lump_tokens():
    return sorted(
        fn[:-5].lower()
        for fn in os.listdir(LUMPS_DIR)
        if fn.endswith(".lump")
    )


def _json_tokens():
    return sorted(
        fn[:-5].lower()
        for fn in os.listdir(LUMPS_DIR)
        if fn.endswith(".json") and fn != "manifest.json"
    )


MANIFEST = _load_manifest()
LUMP_TOKENS = _lump_tokens()
JSON_TOKENS = _json_tokens()
MANIFEST_ENTRIES_WITH_SIZE = [e for e in MANIFEST if e.get("lump_size")]


class TestR1_ValidMagic:
    """R1: Every .lump has valid header magic (0x1F)."""

    @pytest.mark.parametrize("token", LUMP_TOKENS)
    def test_header_magic(self, token):
        h = _read_header(token)
        assert h is not None, (
            f"{token}.lump is too short to contain a header word."
        )
        assert h["valid"], (
            f"{token}.lump: header magic = {h['magic']:#04x}, expected 0x1F.\n"
            "  bits[31:27] must equal 11111b. Repack the binary with the correct header."
        )


class TestR2_FileSizeMatchesHeader:
    """R2: Binary file size in words == header-declared lump_size."""

    @pytest.mark.parametrize("token", LUMP_TOKENS)
    def test_file_size(self, token):
        h = _read_header(token)
        actual = _word_count(token)
        assert actual == h["lump_sz"], (
            f"{token}.lump: file has {actual} words but header declares "
            f"lump_size = {h['lump_sz']} (n_minus_6 encodes a different size).\n"
            "  Repack the binary or correct the n_minus_6 field in the header word."
        )


class TestR3_LumpHasManifestEntry:
    """R3: Every .lump token has a manifest.json entry."""

    def test_all_lumps_in_manifest(self):
        manifest_tokens = {e["token"].lower() for e in MANIFEST}
        orphans = set(LUMP_TOKENS) - manifest_tokens
        assert not orphans, (
            f"Lump binaries with no manifest.json entry: {sorted(orphans)}\n"
            "  Add an entry to manifest.json or delete the stale .lump file."
        )


class TestR4_NoOrphanSidecars:
    """R4: No orphan sidecar .json without a matching .lump."""

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
        if not os.path.exists(os.path.join(LUMPS_DIR, f"{token}.lump")):
            pytest.skip(f"{token}.lump absent (covered by R10)")
        h = _read_header(token)
        assert entry["cw"] == h["cw"], (
            f"{token}: manifest.cw = {entry['cw']} but binary header cw = {h['cw']}.\n"
            "  Update manifest.json to match the compiled binary, then bump CHANGELOG."
        )

    @pytest.mark.parametrize("entry", MANIFEST_ENTRIES_WITH_SIZE, ids=lambda e: e["token"])
    def test_manifest_cc(self, entry):
        token = entry["token"].lower()
        if not os.path.exists(os.path.join(LUMPS_DIR, f"{token}.lump")):
            pytest.skip(f"{token}.lump absent (covered by R10)")
        h = _read_header(token)
        assert entry["cc"] == h["cc"], (
            f"{token}: manifest.cc = {entry['cc']} but binary header cc = {h['cc']}.\n"
            "  Update manifest.json to match the compiled binary, then bump CHANGELOG."
        )

    @pytest.mark.parametrize("entry", MANIFEST_ENTRIES_WITH_SIZE, ids=lambda e: e["token"])
    def test_manifest_lump_size(self, entry):
        token = entry["token"].lower()
        if not os.path.exists(os.path.join(LUMPS_DIR, f"{token}.lump")):
            pytest.skip(f"{token}.lump absent (covered by R10)")
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
        if not os.path.exists(os.path.join(LUMPS_DIR, f"{token}.lump")):
            pytest.skip(f"{token}.lump absent")
        sc = _load_sidecar(token)
        h  = _read_header(token)
        if sc.get("cw") is not None:
            assert sc["cw"] == h["cw"], (
                f"{token}.json: sidecar.cw = {sc['cw']} but binary header cw = {h['cw']}.\n"
                "  Update the sidecar to match the compiled binary, then bump CHANGELOG."
            )

    @pytest.mark.parametrize("token", JSON_TOKENS)
    def test_sidecar_cc(self, token):
        if not os.path.exists(os.path.join(LUMPS_DIR, f"{token}.lump")):
            pytest.skip(f"{token}.lump absent")
        sc = _load_sidecar(token)
        h  = _read_header(token)
        if sc.get("cc") is not None:
            assert sc["cc"] == h["cc"], (
                f"{token}.json: sidecar.cc = {sc['cc']} but binary header cc = {h['cc']}.\n"
                "  Update the sidecar to match the compiled binary, then bump CHANGELOG."
            )

    @pytest.mark.parametrize("token", JSON_TOKENS)
    def test_sidecar_lump_size(self, token):
        if not os.path.exists(os.path.join(LUMPS_DIR, f"{token}.lump")):
            pytest.skip(f"{token}.lump absent")
        sc = _load_sidecar(token)
        h  = _read_header(token)
        if sc.get("lump_size") is not None:
            assert sc["lump_size"] == h["lump_sz"], (
                f"{token}.json: sidecar.lump_size = {sc['lump_size']} but binary header "
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
    """R9: ns_slot=null entries MUST carry ns_slot_policy='dynamic'."""

    def test_null_slot_has_policy(self):
        bad = []
        for e in MANIFEST:
            if e.get("ns_slot") is None:
                if e.get("ns_slot_policy") != "dynamic":
                    bad.append(
                        f"{e['token']} ({e.get('abstraction', '?')}) — "
                        "add ns_slot_policy: 'dynamic', or assign an ns_slot integer"
                    )
        assert not bad, (
            "Entries with ns_slot=null but no ns_slot_policy='dynamic':\n  " +
            "\n  ".join(bad)
        )


class TestR10_LumpFilesExist:
    """R10: Every manifest entry with lump_size declared has a .lump file on disk."""

    def test_lump_files_present(self):
        missing = []
        for e in MANIFEST_ENTRIES_WITH_SIZE:
            token = e["token"].lower()
            if not os.path.exists(os.path.join(LUMPS_DIR, f"{token}.lump")):
                missing.append(
                    f"{token} ({e.get('abstraction', '?')}) — "
                    f"lump_size={e['lump_size']} declared but no .lump on disk"
                )
        assert not missing, (
            "Manifest entries missing .lump binary:\n  " + "\n  ".join(missing)
        )


ABSTRACT_LED_GT = 0x07800100


class TestR12_LedPetName:
    """R12: Any lump whose c-list[0] is the Abstract LED GT must name it 'LED0' in pet_names.CR.

    The Abstract LED GT (0x07800100) is a self-defining capability — it carries no NS slot.
    When a lump holds it at c-list[0], the sidecar must document that slot as 'LED0' so the
    IDE can display the correct pet name rather than the bare GT hex value.
    """

    @pytest.mark.parametrize("token", JSON_TOKENS)
    def test_led_clist0_pet_name(self, token):
        path = os.path.join(LUMPS_DIR, f"{token}.lump")
        if not os.path.exists(path):
            pytest.skip(f"{token}.lump absent")
        h = _read_header(token)
        if h["cc"] == 0:
            return
        with open(path, "rb") as f:
            raw = f.read()
        words = struct.unpack(f">{len(raw) // 4}I", raw)
        clist_start = h["lump_sz"] - h["cc"]
        if words[clist_start] != ABSTRACT_LED_GT:
            return
        sc = _load_sidecar(token)
        cr = sc.get("pet_names", {}).get("CR", {})
        assert cr.get("0") == "LED0", (
            f"{token}.json: c-list[0] = Abstract LED GT (0x07800100) but "
            f"pet_names.CR[\"0\"] = {cr.get('0')!r}, expected 'LED0'.\n"
            "  Add  \"0\": \"LED0\"  inside the pet_names.CR object in the sidecar."
        )


class TestR11_SidecarFilesExist:
    """R11: Every manifest entry with lump_size declared has a sidecar .json on disk."""

    def test_sidecar_files_present(self):
        missing = []
        for e in MANIFEST_ENTRIES_WITH_SIZE:
            token = e["token"].lower()
            if not os.path.exists(os.path.join(LUMPS_DIR, f"{token}.json")):
                missing.append(
                    f"{token} ({e.get('abstraction', '?')}) — no sidecar .json on disk"
                )
        assert not missing, (
            "Manifest entries missing sidecar .json:\n  " + "\n  ".join(missing)
        )
