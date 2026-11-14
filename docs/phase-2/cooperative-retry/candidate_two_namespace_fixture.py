"""Two-root native Lazy route, disposable and not the final containment image."""
import hashlib
import struct
from pathlib import Path
from hardware.fault_entry import FaultBootBinding
from hardware.integrity32 import integrity32
from hardware.test_phase2_guarded_llr import GUARD, SYSTEM_EGT, SYSTEM_GT, USER_GT
from .candidate_amoeba_fixture import prepare as loader_fixture
from .amoeba_fixture import run_compile


def prepare():
    words, _, record, _ = loader_fixture()
    here = Path(__file__).parent
    source = (here / "candidate_amoeba.cloomc").read_text()
    fragment = (here / "candidate_scheduler_methods.cloomc").read_text()
    start = source.index("    main method Run()")
    ensure = source.index("    method EnsureResident()")
    app = fragment.index("    main method AppSystem()")
    boot = fragment.index("    main method Run()")
    source = (source[:start] + fragment[boot:app] +
              source[ensure:source.rfind("}")] + fragment[app:] + "}\n")
    source = source.replace("candidate.Handoff R", "candidate.Handoff RW")
    source = source.replace("candidate.SystemThread",
        "candidate.SystemThread, candidate.NamespaceLinks L, candidate.MBits W")
    compiled = run_compile(dict(source=source, language="assembly", tier=0,
                               _candidate_namespace_handoff=True))
    if not compiled.get("ok") or compiled.get("warnings"):
        raise ValueError(compiled)
    code = list(compiled["words"])
    if len(code) > 2048 or code[0] & 255 != 8:
        raise ValueError("Two-root Amoeba exceeds its reservation")
    code[-8:] = [SYSTEM_EGT, 0x1a000008, 0x32000007, 0x32000009,
                 USER_GT, SYSTEM_GT, 0x1a00000b, 0x2200000d]
    words[0x8000//4:0x8000//4+len(code)] = code
    app_root, app_system, app_user, target = 0x10000, 0x11000, 0x11400, 0x12000

    def descriptor(root, slot, base, size, seq=0, device=False):
        location = base if device else base//4
        auth = size-1 | seq << 21
        a = root//4 + slot*4
        words[a:a+4] = [location, auth, integrity32(location, auth), 0]

    # A common immutable Amoeba body is reachable through explicit local
    # descriptors. Its c-list tokens resolve only in the current Namespace.
    words[app_root//4:app_root//4+256] = words[:256]
    words[app_root//4+1] = app_root
    for root in (0, app_root):
        descriptor(root, 1, root, 256, 46)
        descriptor(root, 3, 0x8000, len(code), 73)
        descriptor(root, 9, 0x5400, 64)
        descriptor(root, 13, 0xffffff1c, 1, device=True)
        descriptor(root, 40, target, record["sizeWords"])
        descriptor(root, 44, target, record["sizeWords"])
    descriptor(0, 10, app_root, 256, 46)
    descriptor(app_root, 10, 0, 256, 46)
    descriptor(0, 11, 0x5800, 64)
    descriptor(app_root, 11, 0x5900, 64)
    words[0x5800//4] = words[0x5900//4] = 0x022e000a
    descriptor(app_root, 2, app_system, 256, 419)
    descriptor(app_root, 4, app_user, 256, 7)
    # Private templates are copied before execution, not used to emulate CHANGE.
    words[app_system//4:app_system//4+256] = words[0x1000//4:0x1000//4+256]
    words[app_user//4:app_user//4+256] = words[0x3000//4:0x3000//4+256]
    words[app_system//4+243] = 0x0ffff0f3 | ((code[3]-1) << 13)
    words[app_user//4+243] = 0x10f3 | ((code[4]-1) << 13)
    words[app_user//4+245] = 0x4a000028
    words[app_user//4+255] = SYSTEM_GT
    # SWITCH installs the exact incoming GT, not a synthesized slot-1 token.
    app_namespace = 0x022e000a | app_root << 32 | words[5] << 64
    words[0x5400//4:0x5400//4+7] = [
        app_namespace & 0xffffffff, app_root, app_namespace >> 64,
        USER_GT, 0x4a000028, 0, 0]
    words[target//4] = record["words"][0] & ~(8191 << 10)
    record = dict(record, namespace=app_namespace, baseByte=target)
    digest = hashlib.sha256(struct.pack("<32768I", *words)).hexdigest()
    binding = FaultBootBinding.from_image(words, namespace=0x022e0001 | words[5] << 64,
        thread_gt=SYSTEM_GT, image_sha256=digest, resident_words=True,
        boot_guard=GUARD, memory_bytes=131072)
    return words, binding, record, compiled
