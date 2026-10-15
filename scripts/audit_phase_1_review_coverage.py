#!/usr/bin/env python3
"""Write a review crosswalk, not a manifest or a conformance test result."""
from pathlib import Path
import hashlib
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs/archive/phase-1-expanded-collection/REVIEW-2026-10-14.md"
PLAN = ROOT / "docs/phase-1/04-release/isa-to-fpga-alignment-plan.md"
REPORT = ROOT / "docs/reviews/phase-1-fpga-coverage.md"
SOURCE_SHA256 = "6760cbaffa662cc7e1c3268a8cfbb9fe4509663c7a9f9a71630fb999e4196c61"

# Manual review dispositions, keyed by the frozen ledger's section order.
# These connect questions to required tests, not to passed test evidence.
GROUPS = [
    ("1 2", "README", "Organization/authorization; not hardware behavior"),
    ("3", "H09 H10 H11", "Source gap requires current implementation evidence"),
    ("4", "H08 H13 H14 H17", "Source gap requires current implementation evidence"),
    ("5", "H03 H04", "Source gap requires current implementation evidence"),
    ("6", "H19 H20 S07", "Separate hardware and software evidence"),
    ("7", "H03 H04", "Captured widened arithmetic, not live operands"),
    ("8 32 33", "H17", "Serialized accepted writes; validated save"),
    ("9", "H10 H11", "Immutable protected bootstrap parameters"),
    ("10", "BLOCKERS", "Engineering discretion does not settle architectural oracles"),
    ("11 12 13 14", "H15 H16", "Atomic writes and expiry priority"),
    ("15 16 17 18 19 29 30", "H13 H14 H15", "Latest four-duration decision supersedes fixed-second/old reserved bits"),
    ("20", "H04", "Approved indexed bitfield encoding"),
    ("21 22 23 24 25", "H03", "Single-word encodings only"),
    ("26 27 28 34", "H08", "Runtime mLoad; context versus operand faults"),
    ("31", "H16 H17", "Instruction-fault reporting does not defeat containment"),
    ("35", "H06 BLOCKERS", "MMIO abstraction authority; placement still needs closure"),
    ("36", "S02 BLOCKERS", "Software delivery not a hardware gate"),
    ("37 38 39 40 41 48 51 52 53", "S03", "Approved policy retained; proof/ABI remains software work"),
    ("42 44", "S04", "Active/resident exclusions before mutation"),
    ("43 46 47", "S05 H06", "Software lifecycle, hardware stale-GT rejection"),
    ("45", "S06 H11", "0–510 boot halves supersede earlier 512-value probability"),
    ("49 50 54", "S02", "Type/service scope; lazy loading deferred"),
    ("55 56 57 59", "S06 H11", "Per-configuration retained guard/default policy"),
    ("58 60 61 62 63 64", "H11 S06", "Later version-pair/two-stage decisions supersede metadata-copy proposal"),
    ("65 66 67 68 69 70", "H09 H10", "Shared authority, reset-only admission, final CALL"),
    ("71", "H01 H02 H05 BLOCKERS", "Baseline restored; unresolved oracles explicitly block full qualification"),
    ("72 73 74 75", "H09", "Fixed destinations/source, one-GT CHANGE, CR13 rejection"),
    ("76", "H10", "Reset-slot decision"),
    ("77", "H09", "No IRQ CR13 role"),
    ("78", "H12", "Ascending layout, fixed slots, half-memory budget"),
    ("79", "H09", "Combined handoff; no second CHANGE"),
    ("80", "H14", "Bounded elapsed turns, not retirement progress"),
    ("81", "H06 S05", "Nine-bit equality; software-only lifecycle"),
    ("82", "H06", "Unchanged integrity formula masks F and G"),
    ("83 84", "S01 S02", "Identity/network/service scope distinct from hardware gates"),
    ("85", "S02 S03 S04 S05", "Full Mint policy; unresolved ABI/mechanisms stay explicit"),
    ("86", "H07 H18 S04 S07", "Exact-build acceptance; override is not a pass"),
]


def render():
    assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == SOURCE_SHA256, (
        "Frozen ledger changed: manually recheck question order and dispositions"
    )
    source = SOURCE.read_text()
    start = source.index("## Resolution log")
    end = source.index("\n## ", start + 3)
    sections = re.split(r"(?m)^### ", source[start:end])[1:]
    assert len(sections) == 86, "Ledger changed: review mappings, do not silently reuse indices"
    dispositions = {}
    plan = PLAN.read_text()
    for numbers, cases, reason in GROUPS:
        for case in cases.split():
            if case.startswith(("H", "S")) and case[1:].isdigit():
                assert f"| {case} |" in plan, f"Missing acceptance case {case}"
        for number in map(int, numbers.split()):
            assert number not in dispositions, f"Duplicate decision {number}"
            dispositions[number] = cases, reason
    assert set(dispositions) == set(range(1, 87)), "Unclassified review decision"
    lines = [
        "# Phase 1 FPGA review crosswalk",
        "",
        "Audit evidence only; not an active specification, inventory or runtime authority.",
        "All 86 resolution entries are assigned a disposition below. Coverage means",
        "a requirement/test destination or explicit blocker, **not execution or a pass**.",
        "Older choices are interpreted through their later explicit resolutions.",
        "",
        f"Source SHA-256: `{hashlib.sha256(SOURCE.read_bytes()).hexdigest()}`",
        "",
        "Source: `docs/archive/phase-1-expanded-collection/REVIEW-2026-10-14.md`.",
        "Targets: current Phase 1 Master ISA and hardware acceptance H01–H20/S01–S07.",
        "BLOCKERS means the acceptance plan's explicit oracle/configuration/evidence gaps.",
        "",
        "## Original completeness findings",
        "",
        "| Finding | Disposition |",
        "|---|---|",
        "| F1 layout | H12 |",
        "| F2 reset slot | H10–H11 |",
        "| F3 handoff | H09 |",
        "| F4 bounded execution | H13–H17 |",
        "| F5 CR13 | H09–H10 |",
        "| F6 generation | H06/S05 |",
        "| F7 integrity mask | H06 |",
        "| F8 identity | S01; software representation still open |",
        "| M1 scope | README, S01–S07 |",
        "| M2 complete encodings/reset | H01–H05/H10; core oracle gaps explicitly remain |",
        "| M3 Mint ABI | S02–S05; software ABI still open, not hardware gate |",
        "| M4 lifecycle | H09–H12/H20 and S02/S04/S05 |",
        "| M5 evidence | H19/H20/S07; no physical pass claimed |",
        "",
        "## Every resolution entry",
        "",
        "| Entry | Review question/decision | Acceptance destination | Disposition |",
        "|---|---|---|---|",
    ]
    for number, section in enumerate(sections, 1):
        title = section.splitlines()[0].replace("|", "\\|")
        cases, reason = dispositions[number]
        lines.append(f"| {number} | {title} | {cases} | {reason} |")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(render())
    print("PASS crosswalk: 86/86 decisions and F1–F8/M1–M5 assigned; no hardware pass asserted")
