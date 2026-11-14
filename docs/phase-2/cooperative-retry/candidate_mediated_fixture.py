"""Offline CALL -> regulator -> SWITCH qualification with local resident copies.

This diagnostic preloads AppSystem and prepares Thread homes. It does not
represent final lazy startup, proof/audit admission or the Mallory acceptance
image. No saved artifacts or physical hardware are read or written.
"""
import hashlib
import struct
from pathlib import Path

from hardware.configured_m_control import MControlRecipient
from hardware.fault_entry import FaultBootBinding
from hardware.integrity32 import integrity32
from hardware.test_phase2_guarded_llr import GUARD, SYSTEM_EGT, SYSTEM_GT as LEGACY_SYSTEM_GT, USER_GT
from .candidate_amoeba_fixture import prepare as loader_fixture
from .amoeba_fixture import run_compile

SYSTEM_GT = 0x02000002


def compile_source(source):
    result = run_compile(dict(source=source, language="assembly", tier=0,
                              _candidate_namespace_handoff=True))
    if not result.get("ok") or result.get("warnings"):
        raise ValueError(result)
    return result


def prepare():
    words, _, record, _ = loader_fixture()
    # SWITCH enters Slot 2 with version zero. The older single-root fixture
    # deliberately probes a nonzero version; it is not this new image's guard.
    for address in (0x33fc, 0x9ffc):  # USER home and old loader's C-list data
        if words[address//4] != LEGACY_SYSTEM_GT:
            raise ValueError("Diagnostic capability data changed; requalify the template")
        words[address//4] = SYSTEM_GT
    # The other old references belong to bodies/handoff data replaced in full
    # below. Never scan-and-rewrite words that might be instruction encodings.
    here = Path(__file__).parent
    original = (here / "candidate_amoeba.cloomc").read_text()
    ensure = original[original.index("    method EnsureResident()"):original.rfind("}")]
    amoeba = compile_source("""abstraction candidate.Amoeba {
    capabilities {
        SELF E, candidate.Targets L, candidate.Receiver RW, candidate.Handoff RW, candidate.UserThread, candidate.SystemThread, candidate.NextNamespace, candidate.SecurityRegulator E
    }
    main method Run() {
    Serve:
        LOAD CR2, CR6, #0
        CALL CR2, #2
        LOAD CR8, CR6, #3
        DREAD DR7, CR8, #6
        ISUB DR8, DR7, #0
        BRANCHNE Completed
        DREAD DR1, CR8, #5
        LOAD CR2, CR6, #0
        CALL CR2, #1
        BRANCH Serve
    Completed:
        CHANGE CR12
        BRANCH Completed
    }
""" + ensure + """
    method Switch() {
        LOAD CR2, CR6, #7
        CALL CR2, #0
        RETURN
    }
}
""")
    app = compile_source("""abstraction candidate.AppSystem {
    capabilities {
        SELF E, candidate.Amoeba E, candidate.Handoff RW, candidate.UserThread, candidate.SystemThread
    }
    main method Run() {
    Dispatch:
        LOAD CR1, CR6, #3
        ISUB DR8, DR0, #1
        CHANGE CR1
        BRANCHNE UserFinished
        LOAD CR8, CR6, #2
        DWRITE DR5, CR8, #5
        DWRITE DR6, CR8, #3
        LOAD CR2, CR6, #1
        CALL CR2, #2
        BRANCH Dispatch
    UserFinished:
        LOAD CR8, CR6, #2
        IADD DR7, DR0, #1
        DWRITE DR7, CR8, #6
        LOAD CR2, CR6, #1
        CALL CR2, #2
        BRANCH UserFinished
    }
    main method UserStart() {
        CALL CR1, #0
        LOAD CR11, CR6, #4
    Finished:
        CHANGE CR11
        BRANCH Finished
    }
}
""")
    regulator = compile_source((here / "candidate_regulator_switch.cloomc").read_text())
    amoeba_words, app_words, sr_words = [
        list(r["words"]) for r in (amoeba, app, regulator)]
    if (len(amoeba_words) > 2048 or len(app_words) > 1024 or len(sr_words) > 1024
            or amoeba_words[0] & 255 != 8 or app_words[0] & 255 != 5
            or sr_words[0] & 255 != 4):
        raise ValueError("Mediated component exceeds its exact fixture reservation")
    amoeba_words[-8:] = [SYSTEM_EGT, 0x1a000008, 0x32000007, 0x32000009,
                        USER_GT, SYSTEM_GT, 0x022f000a, 0x4a000017]
    app_words[-5:] = [0x4a000018, SYSTEM_EGT, 0x32000009, USER_GT, SYSTEM_GT]
    sr_words[-4:] = [0x4a000017, 0x2200000d, 0x022f000a, 0x32000019]
    app_root, app_system, app_user, target = 0x10000, 0x11000, 0x11400, 0x12000

    def put(base, body):
        words[base//4:base//4+len(body)] = body

    def descriptor(root, slot, base, size, seq=0, device=False):
        location = base if device else base//4
        authority = size-1 | seq << 21
        put(root+slot*16, [location, authority, integrity32(location, authority), 0])

    put(app_root, words[:256])
    words[app_root//4+1] = app_root
    words[app_root//4] = (words[app_root//4] & ~(15 << 23)) | (1 << 23)
    for root, amoeba_base, sr_base in ((0, 0x8000, 0xa000),
                                     (app_root, 0x16000, 0x18000)):
        local_amoeba, local_sr = list(amoeba_words), list(sr_words)
        local_amoeba[-2] = local_sr[-2] = 0x022e000a if root else 0x022f000a
        put(amoeba_base, local_amoeba)
        put(sr_base, local_sr)
        descriptor(root, 1, root, 256, 47 if root else 46)
        descriptor(root, 3, amoeba_base, len(amoeba_words), 73)
        descriptor(root, 9, 0x5400, 64)
        descriptor(root, 13, 0xffffff1c, 1, device=True)
        descriptor(root, 23, sr_base, len(sr_words))
        descriptor(root, 25, 0x40000130, 3, device=True)
        descriptor(root, 40, target, record["sizeWords"])
        descriptor(root, 44, target, record["sizeWords"])
    descriptor(0, 10, app_root, 256, 47)
    descriptor(app_root, 10, 0, 256, 46)
    descriptor(0, 2, 0x1000, 256)
    descriptor(app_root, 2, app_system, 256)
    descriptor(app_root, 4, app_user, 256, 7)
    descriptor(app_root, 24, 0x19000, len(app_words))
    put(0x19000, app_words)
    put(app_system, words[0x1000//4:0x1000//4+256])
    put(app_user, words[0x3000//4:0x3000//4+256])
    # Fresh diagnostic templates, not runtime recovery or host execution.
    for base, method in ((app_system, 0), (app_user, 1)):
        words[base//4+242] = 0x4a000018
        words[base//4+244] = 0x4a000018
        words[base//4+243] = (0x0ffff0f3 if method == 0 else 0x10f3) | (
            (app_words[method+1]-1) << 13)
    words[app_user//4+245] = 0x4a000028
    words[app_user//4+255] = SYSTEM_GT
    app_namespace = 0x022f000a | app_root << 32 | words[app_root//4+5] << 64
    put(0x5400, [app_namespace & 0xffffffff, app_root, app_namespace >> 64,
                 USER_GT, 0x4a000028, 0, 0])
    words[target//4] = record["words"][0] & ~(8191 << 10)
    record = dict(record, namespace=app_namespace, baseByte=target)
    image_hash = hashlib.sha256(struct.pack("<32768I", *words)).hexdigest()
    binding = FaultBootBinding.from_image(
        words, namespace=0x022e0001 | words[5] << 64, thread_gt=SYSTEM_GT,
        image_sha256=image_hash, resident_words=True, boot_guard=GUARD & ~511, memory_bytes=131072)
    recipients = tuple(MControlRecipient.from_image(
        words, namespace_base=root, slot=23) for root in (0, app_root))
    return words, binding, record, dict(
        amoeba=amoeba, app=app, regulator=regulator, m_control_recipients=recipients)
