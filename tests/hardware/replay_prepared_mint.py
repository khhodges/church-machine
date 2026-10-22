"""Diagnostic replay of the saved private trial; nonzero means no acceptance.

Usage: python -m tests.hardware.replay_prepared_mint PATH_TO_TRIAL_DIRECTORY
No saved input is modified. Only a disposable caller and the reserved Thread
are provisioned in RAM. All prepared Mint/PkVerify/state/pool/table bytes remain
unchanged apart from the explicitly listed caller descriptor.
"""
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys

from hardware.boot_rom import BOOT_PROGRAM
from hardware.integrity32 import integrity32
from tests.hardware.test_mint_create_core import ROOT, gt, replay


def run(directory):
    raw = (directory / "candidate.bin").read_bytes()
    design = json.loads((directory / "saved-design.json").read_text())
    evidence = json.loads((directory / "evidence.json").read_text())
    digest = hashlib.sha256(raw).hexdigest()
    assert digest == evidence["imageSha256"], "candidate/evidence hash mismatch"
    assert design["format"] == "mint-private-fpga-create-trial-v1"
    words = struct.unpack(f">{len(raw) // 4}I", raw)
    memory = {i * 4: word for i, word in enumerate(words)}
    original = memory.copy()
    images = json.loads(subprocess.check_output(
        ["node", str(ROOT / "tests/hardware/mint_create_image.js")], text=True))
    caller_slot, caller, thread = 21, 0x7000, 24576
    bindings = design["bindings"]
    mint = bindings["ide.Mint"]
    state = bindings["ide.MintState"]
    verify = bindings["ide.PkVerify"]
    assert design["threadRangeBytes"] == [thread, thread + 1024]
    assert not any(memory[caller_slot * 16 + i * 4] for i in range(4))
    assert not any(memory[caller + i * 4] for i in range(256))

    def put(base, values):
        for i, value in enumerate(values):
            memory[base + i * 4] = value

    body = images["callers"][0]
    put(caller, [(31 << 27) | (2 << 23) | ((len(body) - 1) << 10) | 3] + body[1:])
    put(caller + 253 * 4, [gt(caller_slot, 32),
                          gt(mint["slot"], 32, b=1), gt(state["slot"], 1, b=1)])
    put(caller_slot * 16, [caller, 255, integrity32(caller, 255), 0])
    put(thread + 17 * 4, [0x10F1])
    put(thread + 242 * 4, [gt(caller_slot, 32),
                          (0x7FFF << 13) | 0x10F3, gt(caller_slot, 32)])
    allowed = set(range(caller, caller + 1024, 4))
    allowed |= set(range(caller_slot * 16, caller_slot * 16 + 16, 4))
    allowed |= set(range(thread, thread + 1024, 4))
    assert all(memory[a] == v for a, v in original.items() if a not in allowed)
    # Candidate has metadata at slot zero, root at one, Thread at two.
    # Test bootstrap: NOP; CHANGE CR12, CR15[1]; CALL CR0. Boot CHANGE
    # validates the preloaded CR12 identity (slot 2), not its encoded index.
    # These are
    # harness instructions, not rewritten Mint or PkVerify instructions.
    boot = [0xAF004000, BOOT_PROGRAM[1], BOOT_PROGRAM[2]]
    result = replay(images, prepared_memory=memory, boot_words=boot,
                    namespace_limit=design["namespace"]["slots"] - 1,
                    caller_base=caller, bootstrap_thread=2)
    report = {
        "candidateSha256": digest,
        "fault": result["fault"],
        "mintFirstTableWord": f"0x{original[mint['baseBytes'] + 4]:08x}",
        "mintInstructionBytesUnchanged": all(
            result["mem"][a] == original[a]
            for a in range(mint["baseBytes"], mint["baseBytes"] + mint["words"] * 4, 4)),
        "mintRetiredInstructions": sum(mint["baseBytes"] <= pc <
            mint["baseBytes"] + mint["words"] * 4 for pc, _ in result["retired"]),
        "verifierEntered": any(verify["baseBytes"] <= pc <
            verify["baseBytes"] + verify["words"] * 4 for pc, _ in result["retired"]),
        "returned": result["returned"],
        "lastReadBytes": result["reads"][-8:],
        "acceptance": False,
    }
    print(json.dumps(report, indent=2))
    # This is a diagnostic, not a green acceptance test. Even a fault-free
    # run needs the complete downstream assertions before acceptance.
    return 1 if result["fault"] else 2


if __name__ == "__main__":
    sys.exit(run(Path(sys.argv[1])))
