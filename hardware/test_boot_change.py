"""Boot CHANGE: full-capability assertions and failure-before-publication."""
import hashlib
import json
from pathlib import Path
import tarfile

import pytest
from amaranth.sim import Simulator

from hardware.change import ChurchChange
from hardware.integrity32 import integrity32
from scripts.verify_sparse_initializer_synthesis import retained_pairs


def cap(gt, base, limit):
    return gt | base << 32 | limit << 64


def fixture():
    mem = {}

    def descriptor(slot, base, limit):
        mem.update({slot * 16: base, slot * 16 + 4: limit,
                    slot * 16 + 8: integrity32(base, limit), slot * 16 + 12: 0})

    descriptor(1, 0x2600, 255)
    descriptor(10, 0x2E00, 1023)
    mem[0x2600] = 0xF900820C
    mem[0x2644] = 0x10F1
    mem[0x29C8] = 0x4A00000A
    mem[0x29CC] = (0x7FFF << 13) | 0x10F3
    mem[0x29D0] = 0x4A00000A
    mem[0x2E00] = (31 << 27) | (4 << 23) | (20 << 10) | 2
    mem[0x2E00 + 1022 * 4] = 0x4A00000A
    # Abstract locks remain unresolved, but are not runtime Inform authority.
    mem[0x2E00 + 1023 * 4] = 0x06000042
    return mem


def prepare_synthetic_boot(dmem, entry_slot=6):
    """Prepare only a caller-owned synthetic test image, never release inputs."""
    thread_word = dmem[4] // 4
    entry_word = dmem[entry_slot * 4] // 4
    entry_gt = 0x4A000000 | entry_slot
    header = dmem[entry_word]
    words = 1 << (((header >> 23) & 15) + 6)
    # The scheduler tests use tiny programs in a 512-word allocation; their
    # inherited catalog descriptor must agree with that synthetic header.
    dmem[entry_slot * 4 + 1] = words - 1
    dmem[entry_slot * 4 + 2] = integrity32(entry_word * 4, words - 1)
    dmem[entry_word + words - (header & 255)] = entry_gt
    for i in range(1, header & 255):
        dmem[entry_word + words - (header & 255) + i] = 0
    dmem[thread_word + 17] = 0x10F1
    dmem[thread_word + 242] = entry_gt
    dmem[thread_word + 243] = (0x7FFF << 13) | 0x10F3
    dmem[thread_word + 244] = entry_gt


def replay(mem, thread_gt=0x02000001, namespace_limit=63, archived_boundary=False):
    """Exact memory input, synchronous shared read port, actual ChurchChange."""
    dut = ChurchChange()
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    crs = [cap(0x02000000 + i, 0x8000 + i * 256, i + 17) for i in range(16)]
    if archived_boundary:
        # Full post-Namespace-LOAD register boundary retained in the review.
        crs = [0] * 16
        crs[6] = cap(0x1A000002, 0x400, 0x3F)
        crs[14] = cap(0x42000001, 0, 0)
    crs[12] = cap(thread_gt, 0, 0)
    # Deliberately reproduce the archived first LOAD's null-GT Namespace root.
    crs[15] = cap(0, 0, namespace_limit)
    before = list(crs)
    result = {"writes": [], "memory_writes": [], "dr_writes": [], "flags": [],
              "nia": [], "before": before}
    pending = None

    async def bench(ctx):
        nonlocal pending
        ctx.set(dut.cr_src, 15)
        ctx.set(dut.cr_dst, 12)
        ctx.set(dut.index, 1)  # unchanged ROM instruction operands
        ctx.set(dut.boot_window, 1)
        ctx.set(dut.m_elevated, 1)
        ctx.set(dut.mem_wr_done, 1)
        ctx.set(dut.active_thread_owned, 1)  # boot must not save even if asserted
        for cycle in range(4000):
            ctx.set(dut.change_start, cycle == 0)
            ctx.set(dut.cr12_thread.as_value(), crs[12])
            ctx.set(dut.cr15_namespace.as_value(), crs[15])
            ctx.set(dut.mem_rd_valid, pending is not None)
            ctx.set(dut.mem_rd_data, mem.get(pending, 0))
            await ctx.delay(1e-9)
            ctx.set(dut.cr_rd_data.as_value(), crs[ctx.get(dut.cr_rd_addr)])
            await ctx.delay(1e-9)
            next_read = ctx.get(dut.mem_rd_addr) if ctx.get(dut.mem_rd_en) else None
            write = None
            if ctx.get(dut.cr_wr_en):
                write = (ctx.get(dut.cr_wr_addr), ctx.get(dut.cr_wr_data.as_value()))
            if ctx.get(dut.mem_wr_en):
                result["memory_writes"].append(ctx.get(dut.mem_wr_addr))
            if ctx.get(dut.dr_wr_en):
                result["dr_writes"].append(ctx.get(dut.dr_wr_addr))
            if ctx.get(dut.flags_restore_en):
                result["flags"].append(ctx.get(dut.flags_restore_data.as_value()))
            if ctx.get(dut.nia_restore_en):
                result["nia"].append(ctx.get(dut.nia_restore_val))
            if ctx.get(dut.change_fault) or ctx.get(dut.change_complete):
                result.update(fault=ctx.get(dut.change_fault),
                              fault_type=ctx.get(dut.fault_type),
                              complete=ctx.get(dut.change_complete),
                              after=list(crs), cycles=cycle,
                              thread_base=ctx.get(dut.thread_base_restore_val),
                              thread_base_en=ctx.get(dut.thread_base_restore_en))
                return
            await ctx.tick()
            pending = next_read
            if write:
                result["writes"].append(write)
                crs[write[0]] = write[1]
        pytest.fail("boot CHANGE did not terminate")

    sim.add_testbench(bench)
    sim.run()
    assert not result["memory_writes"]
    assert not result["dr_writes"]
    assert not result["flags"]
    assert not result["nia"]
    assert all(index != 8 for index, _ in result["writes"])
    return result


def test_boot_installs_complete_thread_without_scratch_or_context_save():
    r = replay(fixture())
    assert r["complete"] and not r["fault"]
    expected = list(r["before"])
    expected[12] = cap(0x02000001, 0x2600, 255)
    expected[0] = cap(0x4A00000A, 0x2E00, 1023)
    expected[5] = cap(0x32000000, 0x2648, 193)
    assert r["after"] == expected  # all 16 full GT/base/W2 triples
    assert [index for index, _ in r["writes"]] == [12, 0, 5]
    assert r["thread_base_en"] and r["thread_base"] == 0x2600


def test_factory_capability_test_full_core_boot():
    from hardware import boot_rom as b
    from hardware.test_boot_rom_no_false_halt import BootRomHarness, _build_dmem_init

    memory = _build_dmem_init()
    assert b.WUKONG_CAPABILITY_TEST_WORDS, "factory entry must be available"
    start = b.WUKONG_CAPABILITY_TEST_BASE_WORD
    memory[start:start + len(b.WUKONG_CAPABILITY_TEST_IMAGE_WORDS)] = b.WUKONG_CAPABILITY_TEST_IMAGE_WORDS
    entry_gt = 0x4A000000 | b.CAPABILITY_TEST_NS_SLOT
    b.initialize_factory_thread_root(memory, entry_gt)
    dut = BootRomHarness(memory)
    sim = Simulator(dut)
    sim.add_clock(1e-6)

    async def bench(ctx):
        before = None
        retired = []

        def registers():
            return [[ctx.get(w) for w in row] for row in dut.core.debug_cr_words]

        for _ in range(4000):
            if ctx.get(dut.core.retire_valid):
                assert not ctx.get(dut.core.retire_fault_valid), ctx.get(dut.core.retire_fault_code)
                nia = ctx.get(dut.core.retire_nia)
                retired.append(nia)
                if nia == 0:
                    # Retirement and the final LOAD write share this edge.
                    await ctx.tick()
                    before = registers()
                    continue
                if nia == 4:
                    expected = [list(row) for row in before]
                    expected[12] = [0x02000001, b.WUKONG_THREAD_BASE_WORD * 4, 255]
                    expected[0] = [entry_gt, start * 4, b.WUKONG_CAPABILITY_TEST_ALLOC - 1]
                    expected[5] = [0x32000000, b.WUKONG_THREAD_BASE_WORD * 4 + 72, 193]
                    assert registers() == expected
                if nia == 8:
                    assert retired == [0, 4, 8]
                    return
            await ctx.tick()
        pytest.fail("factory LOAD/CHANGE/CALL boot did not finish")

    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("corruption", [
    "null", "abstract", "outform", "permission1", "permission2", "permission4",
    "stale", "ns_bounds", "seal", "absent", "unaligned", "short",
    "header", "type", "cc", "stack_size", "indicator", "root_gt", "root_frame",
    "home_stale", "home_outform", "entry_header", "entry_size", "entry_cc",
    "self", "clist_stale", "clist_outform",
])
def test_boot_errors_hard_fault_without_any_partial_publication(corruption):
    mem = fixture()
    gt, limit = 0x02000001, 63
    if corruption == "null":
        gt = 1
    elif corruption == "abstract":
        gt = 0x06000001
    elif corruption == "outform":
        gt = 0x04000001
    elif corruption.startswith("permission"):
        gt |= int(corruption[-1]) << 28
    elif corruption == "stale":
        gt |= 1 << 16
    elif corruption == "ns_bounds":
        limit = 0
    elif corruption == "seal":
        mem[24] ^= 1
    elif corruption in ("absent", "unaligned", "short"):
        if corruption == "absent":
            mem[20] |= 1 << 31
        elif corruption == "unaligned":
            mem[16] += 1
        else:
            mem[20] = 127
        mem[24] = integrity32(mem[16], mem[20])
    else:
        address, value = {
            "header": (0x2600, 0),
            "type": (0x2600, mem[0x2600] & ~(3 << 8)),
            "cc": (0x2600, mem[0x2600] ^ 1),
            "stack_size": (0x2600, (mem[0x2600] & ~(8191 << 10)) | (255 << 10)),
            "indicator": (0x2644, 243),
            "root_gt": (0x29C8, 0),
            "root_frame": (0x29CC, 0),
            "home_stale": (0x29D4, 0x4A01000A),
            "home_outform": (0x29D4, 0x4400000A),
            "entry_header": (0x2E00, 0),
            "entry_size": (0x2E00, mem[0x2E00] ^ (1 << 23)),
            "entry_cc": (0x2E00, mem[0x2E00] & ~255),
            "self": (0x2E00 + 1022 * 4, 0),
            "clist_stale": (0x2E00 + 1023 * 4, 0x4A01000A),
            "clist_outform": (0x2E00 + 1023 * 4, 0x4400000A),
        }[corruption]
        mem[address] = value
    r = replay(mem, gt, limit)
    assert r["fault"] and not r["complete"], corruption
    assert r["fault_type"] != 0
    assert r["writes"] == []
    assert r["after"] == r["before"]
    assert not r["thread_base_en"]


def test_unchanged_archived_inputs_are_not_silently_repaired():
    root = Path(__file__).resolve().parents[1]
    snapshot = root / "server/build-snapshots/revisions/namespace/3a53c8ebe99bcccb3eb1c4371c8c897851853d60cd7d64d66c0343f69b502166"
    bundle = root / "reports/sparse-initializer-followup-evidence-2026-10-07.tar.gz"
    if not bundle.exists() or not snapshot.exists():
        pytest.skip("retained approved snapshot not present")
    files = [p for p in snapshot.rglob("*") if p.is_file()] + [bundle]
    before = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    revision = json.loads((snapshot / "revision.json").read_text())
    for name, digest in revision["files"].items():
        assert hashlib.sha256((snapshot / name).read_bytes()).hexdigest() == digest
    with tarfile.open(bundle) as archive:
        pairs = json.load(archive.extractfile("pairs.json"))
    assert pairs == list(map(list, retained_pairs(
        (snapshot / "church_wukong_xc7a100t.il").read_text())))
    memory = {word * 4: value for word, value in pairs}
    r = replay(memory, archived_boundary=True)
    assert r["fault"] and not r["complete"]
    # The retained descriptor validates, but its empty stack is not a
    # validated incoming root frame. Never silently repair those bytes.
    assert r["fault_type"] == 0x12
    assert not r["writes"]
    after = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    assert before == after
    out = root / "generated-artifacts/boot-change"
    out.mkdir(parents=True, exist_ok=True)
    (out / "replay.json").write_text(json.dumps({
        "scope": "Current ChurchChange Amaranth behavioral model; not mapped netlist or FPGA",
        "initializer_pairs": len(pairs), "before_hashes": before, "after_hashes": after,
        "source_hashes": {
            name: hashlib.sha256((root / name).read_bytes()).hexdigest()
            for name in ("hardware/change.py", "hardware/boot_change.py",
                         "hardware/ns_gate.py", "hardware/test_boot_change.py")
        },
        "result": r,
    }, indent=2) + "\n")
