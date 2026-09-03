"""Cross-layer conformance for the canonical target architecture contracts."""

import ast
import importlib
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared.architecture_contracts import (  # noqa: E402
    ABSTRACT_GT_WORD0,
    BOOT,
    GT_WORD0,
    NS_ENTRY,
    PROFILES,
    TRACE_UNITS,
    field_lsb,
    field_width,
    ns_integrity_word1_mask,
)


def test_contract_json_and_browser_projection_are_current():
    subprocess.run(
        ["node", "scripts/gen-architecture-contracts.js", "--check"],
        cwd=ROOT,
        check=True,
    )


def test_hardware_layouts_and_encoder_match_contract():
    from hardware import hw_types, layouts

    fields = GT_WORD0["fields"]
    assert layouts.GT_LAYOUT.size == GT_WORD0["widthBits"]
    offset = 0
    for name, bit_range in fields.items():
        member = layouts.GT_LAYOUT.members[name]
        assert member.width == field_width(bit_range)
        assert offset == field_lsb(bit_range)
        offset += member.width

    assert hw_types.GT_SEQ_BITS == field_width(fields["gt_seq"])
    assert hw_types.GT_TYPE_SHIFT == field_lsb(fields["gt_type"])
    assert hw_types.GT_DOM_BIT == field_lsb(fields["dom"])
    assert hw_types.make_gt(hw_types.GT_TYPE_INFORM, hw_types.PERM_MASK_E, 6, 1) == 0x4A010006


def test_namespace_word1_and_profile_geometry_match_contract():
    from hardware import layouts
    from server import boot_image

    fields = NS_ENTRY["word1"]["fields"]
    assert NS_ENTRY["words"] == boot_image.NS_ENTRY_WORDS == 4
    offset = 0
    for name, bit_range in fields.items():
        member = layouts.WORD2_LAYOUT.members[name]
        assert member.width == field_width(bit_range)
        assert offset == field_lsb(bit_range)
        offset += member.width

    sim = PROFILES["simulator-v20"]
    assert boot_image.DEFAULT_NS_SLOTS_MAX == sim["namespace"]["defaultSlots"]
    assert boot_image.NS_TABLE_RESERVE == (
        sim["namespace"]["defaultSlots"] * sim["namespace"]["entryWords"]
    )
    packed = boot_image.pack_ns_word1(0x12345, gt_seq=0x155, g=1, f=1)
    assert packed == 0xEAA12345
    base_integrity = boot_image.integrity32(0x100, packed)
    for excluded in NS_ENTRY["integrity"]["excludedWord1Fields"]:
        assert boot_image.integrity32(
            0x100, packed ^ (1 << field_lsb(fields[excluded]))
        ) == base_integrity
    assert boot_image.integrity32(0x100, packed ^ 1) != base_integrity
    assert ns_integrity_word1_mask() == 0x3FFFFFFF
    from hardware import boot_rom
    assert boot_rom._make_ns_entry(1, 0, 0, 0x155, 0x100, 0x12346)[1] == 0x2AA12345


def test_boot_slots_device_permissions_and_hardware_namespace_match_contract():
    from hardware import boot_rom, hw_types
    from server import boot_image

    slots = BOOT["minimalSlots"]
    assert hw_types.BOOT_ABSTR_NS_SLOT == slots["SelfTest"]
    assert boot_rom.WUKONG_CALLHOME_NS_SLOT == slots["WukongCallHome"]
    assert boot_rom.NS_SLOT_COUNT == max(slots.values()) + 1

    by_name = {
        entry[0]: entry[1]
        for entry in boot_image.DEFAULT_ABSTRACTION_CATALOG
        if entry is not None
    }
    for name, spec in BOOT["devices"].items():
        assert boot_rom._MMIO_ENTRIES[slots[name]][0] == spec["address"]
        assert boot_rom._MMIO_ENTRIES[slots[name]][1] == spec["words"]
        assert boot_image._MMIO_SLOT_SPECS[slots[name]] == (
            spec["address"], spec["words"] - 1)
        assert sorted(k for k, enabled in by_name[name].items() if enabled) == sorted(spec["permissions"])


def test_wukong_memory_and_trace_contract_match_live_modules():
    from hardware import hw_types, wukong_bridge

    profile = PROFILES["wukong-uart-upload-v2"]
    assert hw_types.WUKONG_DMEM_WORDS == profile["totalWords"]
    assert hw_types.WUKONG_FORWARD_NS_SLOTS == profile["namespace"]["slots"]
    assert hw_types.WUKONG_UPLOAD_BODY_BASE_WORD == profile["uploadBodyBaseWord"]
    assert hw_types.WUKONG_PHYSICAL_MAX_THREAD_COUNT == profile["maxThreadCount"]

    trace = TRACE_UNITS[profile["traceUnit"]]
    assert wukong_bridge.TRACE_MAGIC == trace["magic"]
    assert wukong_bridge.TRACE_LEN == trace["packetBytes"]
    for name, value in trace["eventIds"].items():
        assert getattr(wukong_bridge, f"TRACE_EV_{name}") == value

    bridge_source = (ROOT / "hardware" / "wukong_bridge.py").read_text(encoding="utf-8")
    embedded = {}
    for node in ast.walk(ast.parse(bridge_source)):
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            target = node.targets[0]
            if (isinstance(target, ast.Name)
                    and target.id in {"ARCH_PROFILES", "ARCH_TRACE_UNITS"}
                    and isinstance(node.value, ast.Dict)):
                embedded[target.id] = ast.literal_eval(node.value)
    assert embedded.keys() >= {"ARCH_PROFILES", "ARCH_TRACE_UNITS"}, (
        "standalone bridge contract projection is missing")
    embedded_profiles = embedded["ARCH_PROFILES"]
    embedded_traces = embedded["ARCH_TRACE_UNITS"]
    assert embedded_profiles["wukong-uart-upload-v2"]["totalWords"] == profile["totalWords"]
    assert embedded_profiles["wukong-uart-upload-v2"]["traceUnit"] == profile["traceUnit"]
    embedded_trace = embedded_traces[profile["traceUnit"]]
    assert embedded_trace["magic"] == trace["magic"]
    assert embedded_trace["packetBytes"] == trace["packetBytes"]
    assert embedded_trace["eventIds"] == trace["eventIds"]

    top_source = (ROOT / "hardware" / "wukong_top.py").read_text(encoding="utf-8")
    assert '_WUKONG_ARCH_PROFILE = ARCH_PROFILES["wukong-uart-upload-v2"]' in top_source
    assert '_TRACE_EV_RETURN_CR14 = _TRACE_EVENTS["RETURN_CR14"]' in top_source


def test_simulator_declares_and_consumes_its_profile():
    source = (ROOT / "simulator" / "simulator.js").read_text(encoding="utf-8")
    assert "ARCH_PROFILE_NAME = 'simulator-v20'" in source
    assert "ChurchArchitectureContracts" in source
    assert "ARCH_BOOT.minimalSlots['Boot.NS']" in source
    assert "ARCH_TRACE.eventIds.RETURN_CR14" in source

    result = subprocess.run(
        [
            "node",
            "-e",
            """
const ChurchSimulator = require('./simulator/simulator.js');
const sim = new ChurchSimulator();
const gt = sim.createGT(0x155, 0x1234, {R:1,W:1,X:0,L:0,S:0,E:0,B:0}, 1);
const w1 = sim.packNSWord1(0x12345, 0x155, 1, 1);
const abstractGt = sim.createAbstractGT(3, {R:1,W:1}, 0x55, 0x1234);
sim.cr[15] = {word0:0, word1:0, word2:0, word3:0, m:1};
sim.dr[11] = gt; sim.dr[12] = 0x200; sim.dr[13] = w1;
sim.dr[14] = sim._integrity32(sim.dr[12], sim.dr[13]);
const mwin = sim._mwinWriteback();
const catalog = sim._getHardwareBootCatalog();
console.log(JSON.stringify({words: sim.memory.length, gt, parsed: sim.parseGT(gt), w1, ns: sim.parseNSWord1(w1), abstractGt, abstractParsed: sim.parseAbstractGT(abstractGt), mwin, catalog}));
""",
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    actual = json.loads(result.stdout)
    assert actual["words"] == PROFILES["simulator-v20"]["defaultTotalWords"]
    assert actual["gt"] == 0x33551234
    assert actual["parsed"]["gt_seq"] == 0x155
    assert actual["parsed"]["index"] == 0x1234
    assert actual["w1"] == 0xEAA12345
    assert actual["ns"] == {"f": 1, "g": 1, "gtSeq": 0x155, "limit": 0x12345}
    assert actual["mwin"] is True
    assert actual["abstractParsed"]["gt_seq"] == 0x55
    assert actual["abstractParsed"]["ab_data"] == 0x1234
    for name, spec in BOOT["devices"].items():
        entry = actual["catalog"][BOOT["minimalSlots"][name]]
        assert entry["label"] == name
        assert sorted(k for k, value in entry["perms"].items() if value) == sorted(spec["permissions"])

    assert "addr: 0x40000014" not in source


def test_core_docs_name_the_authority_and_target_scope():
    required = {
        "docs/architecture.md": ["shared/architecture_contracts.json", "simulator-v20", "wukong-uart-upload-v2"],
        "docs/ctmm-memory-map.md": ["shared/architecture_contracts.json", "tail-descending", "head-ascending"],
        "docs/isa_reference.md": ["shared/architecture_contracts.json", "9-bit", "wukong-event-uart-v2"],
    }
    for relative, markers in required.items():
        text = (ROOT / relative).read_text(encoding="utf-8")
        for marker in markers:
            assert marker in text, f"{relative} must identify {marker}"

    architecture = (ROOT / "docs" / "architecture.md").read_text(encoding="utf-8")
    assert "[24:16]" in architecture
    assert "[26:25]" in architecture
    assert not re.search(r"gt_seq \(7 bits\)", architecture, re.IGNORECASE)
    for stale in ("[27:21]", "0xB0070229", "Two specifications exist"):
        assert stale not in "\n".join(
            (ROOT / relative).read_text(encoding="utf-8")
            for relative in required
        )