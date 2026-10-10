"""Prepare and replay a private candidate without changing approved/live inputs.

This is behavioral evidence, not hardware approval or a board operation.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare(output):
    from server import boot_image as b
    from hardware.test_boot_change import cap, replay

    live = ROOT / "server/lumps"
    config_path = ROOT / "server/boot-config.json"
    history = ROOT / "server/build-snapshots/revisions/namespace"
    protected = [p for p in live.rglob("*") if p.is_file()]
    protected += [p for p in history.rglob("*") if p.is_file()]
    protected.append(config_path)
    before = {str(p.relative_to(ROOT)): sha(p) for p in protected}
    output.mkdir(parents=True, exist_ok=False)
    evidence = {"status": "unapproved", "before": before}
    try:
        private = output / "lumps"
        shutil.copytree(live, private)
        shutil.copy2(config_path, output / "boot-config.json")
        config = json.loads((output / "boot-config.json").read_text())
        state = json.loads((private / "ns-state.json").read_text())
        rows = state["abstractions"]
        selected = next(r for r in rows if r.get("boot") is True)
        identities = []
        for row in rows:
            if row.get("filename") and row.get("binary_hash"):
                path = private / row["filename"]
                assert sha(path) == row["binary_hash"], row["name"]
                identities.append({key: row.get(key) for key in
                                   ("slot", "name", "filename", "binary_hash", "token")})
        evidence["selected_lumps"] = identities
        candidate = b.generate_boot_image(
            config, str(private), boot_entry_slot=selected["slot"],
            require_entry_resident=True)
        b.validate_boot_image(candidate)
        b.validate_resident_artifact_bindings(candidate, str(private))
        (output / "candidate.bin").write_bytes(candidate)
        evidence["candidate_sha256"] = sha(output / "candidate.bin")
        words = struct.unpack(f"<{len(candidate) // 4}I", candidate)
        threads = []
        for slot in (1, *b.generated_thread_slots(
                b.configured_thread_count(config["step1"]))):
            base = words[len(words) - (slot + 1) * 4]
            header = words[base]
            size = 1 << (((header >> 23) & 15) + 6)
            layout = b.thread_layout(size, (header >> 10) & 8191)
            sto = words[base + 17] & 4095
            gt = words[base + layout["caps_start"]]
            threads.append({"slot": slot, "base": base, "home": gt,
                            "indicator": words[base + 17],
                            "frame": list(words[base + sto + 1:base + sto + 3])})
            assert (gt & 65535) == (selected["slot"] if slot == 1 else 10)
        evidence["threads"] = threads
        projected, projection = b.build_wukong_upload_image(candidate, config)
        (output / "candidate-wukong.bin").write_bytes(projected)
        evidence["projection"] = projection
        hw_words = struct.unpack(f"<{len(projected) // 4}I", projected)
        thread_base, thread_authority = hw_words[4:6]
        thread_limit = b._ns_word1_get(thread_authority, "limit_offset")
        thread_header = hw_words[thread_base // 4]
        layout = b.thread_layout(
            1 << (((thread_header >> 23) & 15) + 6),
            (thread_header >> 10) & 8191)
        entry = hw_words[thread_base // 4 + layout["caps_start"]]
        entry_slot = entry & 65535
        entry_base, entry_authority = hw_words[entry_slot * 4:entry_slot * 4 + 2]
        entry_limit = b._ns_word1_get(entry_authority, "limit_offset")
        entry_header = hw_words[entry_base // 4]
        evidence["entry_geometry"] = {
            "slot": entry_slot, "limit": entry_limit,
            "allocation": 1 << (((entry_header >> 23) & 15) + 6),
            "clist_words": entry_header & 255,
        }
        memory = {i * 4: word for i, word in enumerate(hw_words)}
        result = replay(memory, archived_boundary=True)
        evidence["boot_change"] = result
        assert result["complete"] and not result["fault"], result
        expected = list(result["before"])
        expected[12] = cap(0x02000001, thread_base, thread_limit)
        expected[0] = cap(entry, entry_base, entry_limit)
        expected[5] = cap(0x32000000, thread_base + layout["heap_start"] * 4,
                          layout["heap_words"] - 1)
        assert result["after"] == expected, "complete register triples differ"
        assert [r for r, _ in result["writes"]] == [12, 0, 5]
        evidence["status"] = "behaviorally-verified-unapproved"
    except Exception as exc:
        evidence["error"] = str(exc)
        raise
    finally:
        evidence["after"] = {str(p.relative_to(ROOT)): sha(p) for p in protected}
        evidence["protected_inputs_unchanged"] = evidence["before"] == evidence["after"]
        (output / "evidence.json").write_text(json.dumps(evidence, indent=2) + "\n")
        assert evidence["protected_inputs_unchanged"], "protected input changed"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    prepare(args.output.resolve())
