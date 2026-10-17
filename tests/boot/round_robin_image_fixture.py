"""Disposable, authenticated image inputs for the JS Thread regression.

No live catalog/config is read or repaired. stdout is exclusively image bytes.
"""
import contextlib
import hashlib
import json
import os
from pathlib import Path
import struct
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from server import boot_image as bi
from server.lump_approvals import configured_compiler_tcb_key, sign_compiler_record, write_approvals
from server.lump_integrity import compute_number


def instruction(opcode, dst=0, src=0, imm=0):
    return (opcode << 27) | (14 << 23) | (dst << 19) | (src << 15) | imm


def write_fixture(directory, count=3, thread_words=512, total=16384):
    """Construct exact selected residents and explicit, non-overlapping Threads."""
    cfg = {"step1": {
        "totalNamespaceWords": total, "namespaceLumpWords": 64,
        "threadLumpWords": thread_words, "threadCount": count,
    }}
    threads = [(1, 1, 16)] + [
        (ordinal, slot, 0x1800 + i * thread_words)
        for i, (ordinal, slot) in enumerate(
            zip(range(2, count + 1), bi.generated_thread_slots(count)))
    ]
    rows = [
        {"name": f"Thread.{ordinal}", "slot": slot, "type": "Thread",
         "location": location, "resident": True, "load_policy": "Resident"}
        for ordinal, slot, location in threads
    ]
    rows.extend({"name": f"Device.{slot}", "slot": slot, "type": "Device"}
                for slot in bi._MMIO_SLOT_SPECS)
    manifest, approvals = [], {}
    # Test-only evidence, never the workspace compiler key.
    key = "round-robin-fixture-only-" + "a" * 32
    os.environ["COMPILER_SIGNING_SECRET"] = key
    for slot, name, location, size in [
        (6, "SelfTest", 0x600, 64),
        (7, "RoundRobinConflict", 0x1000, 1024),
        (10, "CapabilityTest", 0x640, 64),
        (220, "RoundRobinCaller", 0x680, 64),
        (221, "RoundRobinCallee", 0x6C0, 64),
    ]:
        gt = bi.create_gt(0, slot, {"E": 1}, 1)
        caps = [gt]
        # Harmless IADD DR1, DR1, #1 words; all saved test NIAs are executable.
        words = [0] * size
        words[1:17] = [instruction(21, 1, 1, 0x4001)] * 16
        if slot == 220:
            caps.append(bi.create_gt(0, 221, {"E": 1}, 1))
            # Separate continuation probe at logical NIA 8.
            # Compact LOAD encodes literal row 1 as magnitude 1 + DR0.
            words[9:12] = [instruction(0, 1, 6, 1 << 4), instruction(2, 1, imm=1),
                           instruction(21, 4, 4, 0x4001)]
        if slot == 221:
            caps.append(bi.create_gt(0, 11, {}, 1))
            words[1] = instruction(23, imm=8)  # method 1 dispatch
            words[9:13] = [
                instruction(21, 3, 3, 0x4001),
                instruction(0, 2, 6, 1 << 4),
                instruction(4, 2, 2),   # CHANGE CR2; resumes at RETURN
                instruction(3),
            ]
        words[0] = bi.pack_lump_header(size.bit_length() - 7, 16, len(caps), 0)
        words[-len(caps):] = caps
        raw = struct.pack(f">{size}I", *words)
        digest = hashlib.sha256(raw).hexdigest()
        filename = f"{name}.1.{compute_number(name, raw)}.lump"
        (directory / filename).write_bytes(raw)
        record = {
            "binary_hash": digest, "source_hash": "0" * 64,
            "language": "assembly", "compiler_identity": "Thread fixture",
            "compiler_version": "test",
        }
        approvals[digest] = {
            "binary_hash": digest,
            "compiler_identity": record["compiler_identity"],
            "compiler_version": record["compiler_version"],
            "filename": filename, "dot_name": name, "issue_n": 1,
            "identity_hash": hashlib.sha256(f"{name}#1".encode()).hexdigest(),
            "trust_origin": "trusted-home-ide",
            "compiler_record": sign_compiler_record(
                record, signing_key=configured_compiler_tcb_key()),
        }
        row = {
            "name": name, "slot": slot, "seq": 0, "type": "Inform",
            "location": location, "token": f"{gt:08x}",
            "filename": filename, "binary_hash": digest,
            "resident": True, "load_policy": "Resident", "boot": slot == 220,
        }
        rows.append(row)
        manifest.append({
            "abstraction": name, "ns_slot": slot, "token": row["token"],
            "filename": filename, "boot_resident": True,
        })
    (directory / "manifest.json").write_text(json.dumps(manifest))
    (directory / "ns-state.json").write_text(json.dumps({"abstractions": rows}))
    write_approvals(str(directory / "approvals.json"), approvals)
    return cfg


def main():
    with tempfile.TemporaryDirectory(prefix="round-robin-image-") as temp:
        directory = Path(temp)
        cfg = (write_fixture(directory, 10, 256, 32768)
               if "--max-threads" in sys.argv else write_fixture(directory))
        conflict = "--selected-conflict" in sys.argv
        if conflict:
            state_path = directory / "ns-state.json"
            state = json.loads(state_path.read_text())
            next(row for row in state["abstractions"] if row["slot"] == 7)["location"] = 0x110
            state_path.write_text(json.dumps(state))
        before = {p.name: p.read_bytes() for p in directory.iterdir()}
        config_before = json.dumps(cfg, sort_keys=True)
        try:
            with contextlib.redirect_stdout(sys.stderr):
                image = bi.generate_boot_image(cfg, str(directory))
            assert not conflict, "overlapping selected image must be rejected"
        except ValueError as error:
            if not conflict:
                raise
            assert ("NS[7] saved Namespace allocation [0x110,0x510) "
                    "overlaps NS[1] [0x10,0x210)") in str(error), str(error)
            print("PASS selected-image conflict rejected without repairs", file=sys.stderr)
        finally:
            assert before == {p.name: p.read_bytes() for p in directory.iterdir()}, \
                "image generation must not rewrite selected inputs on success or rejection"
            assert json.dumps(cfg, sort_keys=True) == config_before
    if not conflict:
        sys.stdout.buffer.write(image)


if __name__ == "__main__":
    main()
