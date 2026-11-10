"""Prepare exact REVIEW-ONLY inputs; no allowlist edit, vendor or board operation."""
import hashlib
import json
from pathlib import Path
import struct
import subprocess

from prepare_starter import APPLICATIONS, HERE, IMAGE_HASHES, ROOT


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def seal(location, authority):
    def rol(v, n):
        return ((v << n) | (v >> (32 - n))) & 0xffffffff
    return rol(location, 7) ^ rol(authority & 0x3fffffff, 13) ^ 0xdeadbeef


def constant(reg, value):
    # Ordinary compiler input, not post-compile instruction translation.
    chunks = [(value >> shift) & 255 for shift in (24, 16, 8, 0)]
    out = [f"IADD DR{reg}, DR0, #{chunks[0]}"]
    for chunk in chunks[1:]:
        out += [f"SHL DR{reg}, DR{reg}, #8", f"IADD DR{reg}, DR{reg}, #{chunk}"]
    return out


def system_source(records, other_user):
    program = ["CHANGE CR1"]  # USER A's original CALL enters lazy handoff.
    for selector, target in enumerate(records):
        tag = "old" if selector == 0 else "new"
        writer = 3 if selector == 0 else 7
        program += [
            f"wait_{tag}:",
            "DREAD DR7, CR4, #1", "ISUB DR8, DR7, #4",
            f"BRANCHEQ ready_{tag}",
            f"CHANGE CR{10 if other_user else 11}", f"BRANCH wait_{tag}",
            f"ready_{tag}:",
            "DREAD DR7, CR4, #2", f"ISUB DR8, DR7, #{selector}",
            f"BRANCHEQ copy_{tag}", "WORD 0xf7000000",
            f"copy_{tag}:",
        ]
        if selector == 0:
            # The boot image authorizes the absent old target in advance.
            # Keep cw=0 until its complete received body is copied.
            program += ["DREAD DR9, CR4, #0", "IADD DR6, DR0, #1"]
        else:
            program += ["IADD DR6, DR0, #0"]
        program += [
            f"loop_{tag}:", "DREAD DR7, CR4, #0",
            f"DWRITE DR7, CR{writer}, DR6",
            "IADD DR6, DR6, #1", f"ISUB DR8, DR6, #{target['sizeWords']}",
            f"BRANCHNE loop_{tag}",
        ]
        if selector == 0:
            program += ["DWRITE DR9, CR3, #0"]
        else:
            # New E slot is initially all-zero. Publish integrity last, not a
            # novel valid bit. Every earlier tuple is checked separately.
            for index in (0, 1, 3, 2):
                program += constant(7, target["descriptor"][index])
                program += [f"DWRITE DR7, CR8, #{index}"]
        program += [
            "DREAD DR7, CR4, #3", "DWRITE DR7, CR9, #0", "CHANGE CR1",
        ]
    # New body published while old method is suspended after CHANGE CR11.
    # The preceding CHANGE completes that old RETURN and caller observation.
    program += [
        "CHANGE CR2",     # explicitly granted new-caller Thread
        "CHANGE CR1",     # old caller again: method yields before RETURN
        "CHANGE CR1",     # finish old RETURN and caller observation
        "done:", "CHANGE CR11", "BRANCH done",
    ]
    return "\n".join(program)


def build(old_size=64, new_size=256):
    if (old_size, new_size) not in ((64, 256), (256, 64)):
        raise ValueError("only the declared two size orders are supported")
    inputs = json.loads(subprocess.check_output(
        ["node", str(HERE / "combined_inputs.js"), "cooperative",
         "shrink" if old_size == 256 else "grow"], text=True))
    records = inputs["records"]
    revisions = [records[0], records[2]]
    result = {}
    for name, other in (("user-b", True), ("all-waiting", False)):
        raw = (APPLICATIONS / "user-b/candidate-le.bin").read_bytes()
        if sha(raw) != IMAGE_HASHES["user-b"]:
            raise ValueError("retained source image changed")
        words = list(struct.unpack("<16384I", raw))
        def put(address, values):
            words[address // 4:address // 4 + len(values)] = values
        def descriptor(slot, base_byte, size_words, seq=0):
            location, authority = base_byte // 4, size_words - 1 | seq << 21
            put(slot * 16, [location, authority, seal(location, authority), 0])
        def gt(slot, perm=0, seq=0):
            return perm | 0x02000000 | seq << 16 | slot
        system = json.loads(subprocess.check_output(
            ["node", str(HERE / "combined_inputs.js"), "system"],
            input=system_source(revisions, other), text=True))
        if len(system["words"]) != 256:
            raise ValueError("SYSTEM exceeds reserved allocation")
        put(0x8400, system["words"])
        descriptor(3, 0x8400, 256, 73)
        # Explicit initial homes, never writes into an executing Thread.
        homes = {
            1: gt(4, seq=7), 2: gt(10), 3: gt(44, 0x20000000),
            4: gt(7, 0x10000000), 7: gt(45, 0x20000000),
            8: gt(46, 0x20000000), 9: gt(47, 0x20000000),
            10: gt(8), 11: gt(2, seq=419),
        }
        for reg, value in homes.items():
            words[0x1000 // 4 + 244 + reg] = value
        # Data port covers four read-only words; commit has its own W grant.
        put(7 * 16, [0x4000001c, 3, seal(0x4000001c, 3), 0])
        put(47 * 16, [0x40000028, 0, seal(0x40000028, 0), 0])
        descriptor(44, revisions[0]["baseByte"], revisions[0]["sizeWords"])
        descriptor(45, revisions[1]["baseByte"], revisions[1]["sizeWords"])
        descriptor(46, revisions[1]["slot"] * 16, 4)
        # New Thread is a private initial copy, not a mutation of a live caller.
        put(0x8000, words[0x3000 // 4:0x3000 // 4 + 256])
        descriptor(10, 0x8000, 256)
        for record in (records[1], records[3]):
            put(record["baseByte"], record["words"])
            put(record["slot"] * 16, record["descriptor"])
        for base, caller in ((0x3000, records[1]), (0x8000, records[3])):
            words[base // 4 + 242] = caller["gt"]
            words[base // 4 + 244] = caller["gt"]
            words[base // 4 + 255] = gt(2, seq=419)
        words[0x6000 // 4 + 255] = gt(2, seq=419)
        # USER B yields via a persistent home, not scratch CR5.
        from_body = "progress:\nIADD DR11, DR11, #1\nCHANGE CR11\nBRANCH progress"
        # Use compiler-produced body, never local opcode conversion.
        b = json.loads(subprocess.check_output(
            ["node", str(HERE / "combined_inputs.js"), "system"],
            input=from_body, text=True))
        put(0x7000 + 2 * 4, b["words"][2:5])
        put(revisions[0]["slot"] * 16, revisions[0]["descriptor"])
        # Valid absent old allocation: immutable descriptor; header-last body.
        words[revisions[0]["baseByte"] // 4] = revisions[0]["words"][0] & ~(0x1fff << 10)
        put(revisions[1]["slot"] * 16, [0, 0, 0, 0])
        blob = struct.pack("<16384I", *words)
        result[name] = {"bytes": blob, "sha256": sha(blob), "system": system}
    return inputs, result


def prepare(output):
    output = Path(output).resolve()
    if not output.is_relative_to(ROOT / "generated-artifacts") or output.exists():
        raise ValueError("choose a fresh generated-artifacts child")
    inputs, images = build()
    output.mkdir(parents=True)
    for name, record in images.items():
        (output / f"{name}.bin").write_bytes(record["bytes"])
        (output / f"{name}-system.cloomc").write_text(record["system"]["sourceBody"] + "\n")
    manifest = {
        "schema": "church.combined-review/v1", "status": "UNAPPROVED_REVIEW_ONLY",
        "images": {name: r["sha256"] for name, r in images.items()},
        "inputs": inputs,
        "grants": {
            "systemHomes": {"CR1": "old caller Thread", "CR2": "new caller Thread",
                "CR3": "old body W", "CR4": "receiver R", "CR7": "new body W",
                "CR8": "new E descriptor W", "CR9": "receiver commit W",
                "CR10": "USER B Thread", "CR11": "SYSTEM Thread"},
            "newEntryPublicationOrder": [0, 1, 3, 2],
            "oldLazyPublication": "preauthorized descriptor, cw=0 until header-last copy",
        },
        "memoryBytes": 65536, "stagingByteRange": [0xa000, 0xa400],
        "newThreadByteRange": [0x8000, 0x8400],
        "systemByteRange": [0x8400, 0x8800],
        "imageAllowlistChanged": False, "vendorBuild": False, "physicalOperations": False,
        "fullTopAccepted": False,
    }
    (output / "review-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return output


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    print(prepare(parser.parse_args().output))
