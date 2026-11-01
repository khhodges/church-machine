"""Generated Thread bodies replayed unchanged in an isolated RTL fixture.

The production Wukong projection supplies the native image. Alice/Mallory are
explicit fixture-only residents (that projection only copies the boot target).
No simulator execution, upload, live preparation, or physical claim is made.
"""
import contextlib
import copy
import hashlib
import io
import json
from pathlib import Path
import shutil
import struct

import pytest
from amaranth.sim import Simulator

from hardware.change import ChurchChange
from hardware.thread_design import thread_layout
from server import boot_image as boot
from server.built_thread_view import inspect_threads


ROOT = Path(__file__).resolve().parents[2]


def unpack(raw):
    return list(struct.unpack(f"<{len(raw) // 4}I", raw))


def pack(words):
    return struct.pack(f"<{len(words)}I", *words)


def body(words, slot):
    base = words[len(words) - (slot + 1) * 4]
    size = 1 << (((words[base] >> 23) & 15) + 6)
    return words[base:base + size]


@pytest.fixture
def generated(tmp_path):
    catalog = tmp_path / "lumps"
    shutil.copytree(ROOT / "server/lumps", catalog)
    cfg = json.loads((ROOT / "server/boot-config.json").read_text())
    cfg.pop("threadInitialDesigns", None)
    cfg["step1"].update(threadCount=3, threadLumpWords=256, threadStackWords=32)
    state_path = catalog / "ns-state.json"
    state = json.loads(state_path.read_text())
    rows = state["abstractions"]
    # These are fixture-only grants, not adoption into the user's Namespace.
    assert not any(r["slot"] in (14, 15) for r in rows)
    rows.extend([
        {"slot": 14, "name": "ide.Alice", "type": "Inform", "seq": 3,
         "filename": "ide.Alice.1.4f5f9b06.lump", "resident": True,
         "load_policy": "Resident", "token": "07eae44c"},
        {"slot": 15, "name": "ide.Mallory", "type": "Inform", "seq": 4,
         "filename": "ide.Mallory.1.3a5e7373.lump", "resident": True,
         "load_policy": "Resident", "token": "0fe63f75"},
    ])
    for row in rows[-2:]:
        row["binary_hash"] = hashlib.sha256((catalog / row["filename"]).read_bytes()).hexdigest()
        row["location"] = 11264 if row["slot"] == 14 else 13312
    state_path.write_text(json.dumps(state))
    by_slot = {r["slot"]: r for r in rows}

    def generate(config, **kwargs):
        with contextlib.redirect_stdout(io.StringIO()):
            return boot.generate_boot_image(config, str(catalog), **kwargs)

    baseline = generate(cfg)
    designs = []
    for slot, size, stack, actor, seed in [
        (11, 256, 32, 14, 0xA1100000),
        (12, 512, 64, 15, 0xBA110000),
    ]:
        caps = [None] * 12
        caps[1] = boot.create_gt(by_slot[actor]["seq"], actor, {"E": 1}, 1)
        if slot == 12:
            caps[0] = boot.create_gt(by_slot[6]["seq"], 6, {"E": 1}, 1)
        designs.append({
            "target": {"slot": slot, "sequence": by_slot[slot]["seq"],
                       "name": by_slot[slot]["name"],
                       "namespaceName": by_slot[0]["name"],
                       "namespaceSequence": by_slot[0]["seq"]},
            "sizeWords": size, "stackWords": stack,
            "initialization": {
                "dataRegisters": [seed + i for i in range(16)],
                "capabilityRegisters": caps},
            "tuples": [{"name": "Private", "offset": 0, "policy": "initialize",
                        "fields": [{"name": "counter", "type": "uint32",
                                    "size": 1, "initial": seed + 123},
                                   {"name": "tag", "type": "uint32",
                                    "size": 1, "initial": seed + 456}]}],
        })
    cfg["threadInitialDesigns"] = designs
    image = generate(cfg)
    parsed = boot.parse_ns_table_raw(image)
    entries = [dict(e, name=by_slot.get(e["slot"], {}).get("name"))
               for e in parsed["entries"]]
    views = {v["slot"]: v for v in inspect_threads(
        image, entries, parsed["nsTableBase"])}
    return cfg, catalog, baseline, image, designs, views, generate


def test_generated_design_projection_and_preserved_preparation(generated):
    cfg, catalog, baseline, image, designs, views, generate = generated
    old, new = unpack(baseline), unpack(image)
    assert body(old, 1) == body(new, 1), "unrelated Boot.Thread changed"
    for design in designs:
        slot = design["target"]["slot"]
        view = views[slot]
        assert view["error"] is None
        assert (view["sizeWords"], view["stackWords"]) == (
            design["sizeWords"], design["stackWords"])
        assert [r["value"] for r in view["dataRegisters"]] == (
            design["initialization"]["dataRegisters"])
        assert view["heap"]["initialWords"][:2] == [
            f["initial"] for f in design["tuples"][0]["fields"]]
        assert view["capabilities"][1]["targetName"] == (
            "ide.Alice" if slot == 11 else "ide.Mallory")
        layout = thread_layout(view["sizeWords"], view["stackWords"])
        words = body(new, slot)
        gt = view["capabilities"][0]["value"]
        assert words[layout["stack_end"] - 3] == gt
        assert words[layout["stack_end"] - 1] == gt

    # Authenticate only this disposable preparation. It has old geometry,
    # default entries, and no authored values. The public generation path
    # must not import any of those over approved initial designs.
    provenance = boot.build_boot_image_provenance(baseline, str(catalog))
    (catalog / "boot-image.provenance.json").write_text(json.dumps(provenance))
    preserved = generate(cfg, prepared_thread_image=baseline)
    assert preserved == image
    assert (catalog / "boot-image.bin").read_bytes() != preserved


def test_single_design_leaves_other_threads_unchanged(generated):
    cfg, catalog, baseline, _, designs, _, generate = generated
    cfg = copy.deepcopy(cfg)
    cfg["threadInitialDesigns"] = [designs[1]]
    candidate = generate(cfg)
    old, new = unpack(baseline), unpack(candidate)
    for slot in (1, 11):
        assert body(old, slot) == body(new, slot)
    # An unowned continuation is still preserved, but runtime DRs are not.
    base = old[len(old) - 12 * 4]
    layout = thread_layout(256, 32)
    for offset in (layout["caps_start"], layout["stack_end"] - 3,
                   layout["stack_end"] - 1):
        old[base + offset] = 0x4A000006
    old[base + 2] = 0xDEADBEEF
    prepared = pack(old)
    provenance = boot.build_boot_image_provenance(prepared, str(catalog))
    (catalog / "boot-image.provenance.json").write_text(json.dumps(provenance))
    preserved = unpack(generate(cfg, prepared_thread_image=prepared))
    assert body(preserved, 12) == body(new, 12)
    assert body(preserved, 1) == body(new, 1)
    expected = body(new, 11)
    for offset in (layout["caps_start"], layout["stack_end"] - 3,
                   layout["stack_end"] - 1):
        expected[offset] = 0x4A000006
    assert body(preserved, 11) == expected


def native_fixture(image):
    """Freeze a complete bus image before replay; never translate bus reads."""
    native, info = boot.build_wukong_upload_image(image)
    words = unpack(native)
    # Production projection retains factory non-boot code, not all selected
    # residents. Explicitly supply the selected continuation and two actors in
    # this fixture. This is NOT proof of public upload dependency completeness.
    source = unpack(image)
    for slot, location, sequence in [
        (6, 8192, 0),
        (14, 11264, 3),
        (15, 13312, 4),
    ]:
        payload = body(source, slot)
        assert not any(words[location:location + len(payload)])
        assert location + len(payload) <= len(words)
        words[location:location + len(payload)] = payload
        source_descriptor = source[len(source) - (slot + 1) * 4:
                                   len(source) - slot * 4]
        authority = source_descriptor[1]
        assert (authority >> 21) & 511 == sequence
        words[slot * 4:slot * 4 + 4] = [
            location * 4, authority,
            boot.integrity32(location * 4, authority), source_descriptor[3]]
    return pack(words), info


@pytest.mark.parametrize("slot", [11, 12])
def test_exact_fixture_first_entry_in_change_rtl(generated, slot):
    _, _, _, image, _, views, _ = generated
    raw, info = native_fixture(image)
    digest = hashlib.sha256(raw).hexdigest()
    memory = unpack(raw)
    before = memory.copy()
    contexts = {r["slot"]: r for r in info["thread_contexts"]}
    for number, context in contexts.items():
        initial = body(unpack(image), number)
        start = context["base_word"]
        assert memory[start:start + len(initial)] == initial
    view = views[slot]
    base = contexts[slot]["base_word"]
    layout = thread_layout(view["sizeWords"], view["stackWords"])
    crs = [0] * 16
    # Namespace capability uses the native projection's real descriptor.
    crs[15] = 0x12000000 | (memory[1] << 64)
    drs = [0xDEADBEEF] * 16
    writes, reads = [], []
    nia = None
    dut = ChurchChange()
    sim = Simulator(dut)
    sim.add_clock(1e-6)

    async def bench(ctx):
        nonlocal nia
        pending = None
        ctx.set(dut.cr_src, 15)
        ctx.set(dut.cr_dst, 14)
        ctx.set(dut.index, slot)
        ctx.set(dut.active_thread_owned, 0)
        ctx.set(dut.cr15_namespace.as_value(), crs[15])
        ctx.set(dut.mem_wr_done, 1)

        async def tick():
            nonlocal pending, nia
            ctx.set(dut.cr_rd_data.as_value(), crs[ctx.get(dut.cr_rd_addr)])
            ctx.set(dut.dr_rd_data, drs[ctx.get(dut.dr_rd_addr)])
            ctx.set(dut.mem_rd_valid, pending is not None)
            ctx.set(dut.mem_rd_data, memory[pending // 4] if pending is not None else 0)
            await ctx.delay(1e-9)
            rd = ctx.get(dut.mem_rd_addr) if ctx.get(dut.mem_rd_en) else None
            if rd is not None:
                assert rd % 4 == 0 and 0 <= rd < len(raw)
                reads.append(rd)
            cw = (ctx.get(dut.cr_wr_en), ctx.get(dut.cr_wr_addr),
                  ctx.get(dut.cr_wr_data.as_value()))
            dw = (ctx.get(dut.dr_wr_en), ctx.get(dut.dr_wr_addr), ctx.get(dut.dr_wr_data))
            mw = (ctx.get(dut.mem_wr_en), ctx.get(dut.mem_wr_addr), ctx.get(dut.mem_wr_data))
            if ctx.get(dut.nia_restore_en):
                nia = ctx.get(dut.nia_restore_val)
            await ctx.tick()
            if cw[0]:
                crs[cw[1]] = cw[2]
            if dw[0]:
                drs[dw[1]] = dw[2]
            if mw[0]:
                assert mw[1] % 4 == 0 and 0 <= mw[1] < len(raw)
                memory[mw[1] // 4] = mw[2]
                writes.append(mw[1] // 4)
            pending = rd

        ctx.set(dut.change_start, 1)
        await tick()
        ctx.set(dut.change_start, 0)
        for _ in range(2500):
            await tick()
            assert not ctx.get(dut.change_fault), ctx.get(dut.fault_type)
            if ctx.get(dut.change_complete):
                break
        else:
            pytest.fail("RTL first entry timed out")

    sim.add_testbench(bench)
    sim.run()
    assert hashlib.sha256(raw).hexdigest() == digest
    assert drs == [r["value"] for r in view["dataRegisters"]]
    for register in (0, 1):
        expected = view["capabilities"][register]["value"]
        assert crs[register] & 0xFFFFFFFF == expected
        target = expected & 0xFFFF
        assert crs[register] >> 32 & 0xFFFFFFFF == memory[target * 4]
    target = view["capabilities"][0]["value"] & 0xFFFF
    assert nia == memory[target * 4] + 4, "first entry must resume at PC zero"
    # The legacy scheduler derives CR14's code and CR6's L c-list views;
    # their permissions are not the stored E capability's permissions.
    entry_gt = view["capabilities"][0]["value"]
    assert crs[14] & 0xFFFFFFFF == (entry_gt & ~(7 << 27)) | (2 << 27)
    assert crs[6] & 0xFFFFFFFF == (entry_gt & ~(7 << 28)) | (1 << 28)
    assert crs[14] >> 32 & 0xFFFFFFFF == nia
    assert crs[5] >> 32 & 0xFFFFFFFF == (base + 18) * 4
    assert crs[5] >> 64 & 0x1FFFFF == view["heap"]["words"] - 1
    assert memory[base + 18:base + layout["stack_start"]] == view["heap"]["initialWords"]
    assert writes == [base + 17], "first entry may only consume this Thread's STO"
    assert memory[base + 17] == 4096 | (layout["stack_end"] - 2)
    assert all(a == b for i, (a, b) in enumerate(zip(before, memory)) if i != base + 17)
    assert reads, "RTL must read the exact frozen image"
