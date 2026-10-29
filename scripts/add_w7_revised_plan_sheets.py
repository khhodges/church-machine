"""Append planning sheets without rewriting any pre-existing workbook parts."""
from copy import copy
from pathlib import Path
from zipfile import ZipFile
import re
import xml.etree.ElementTree as ET
import openpyxl
from openpyxl.utils import get_column_letter

ROOT = Path(__file__).resolve().parents[1]
BOOK = ROOT / "docs/phase-1/CTMM_W7_Threat_Test_Plan.xlsx"
PLAN = ROOT / "docs/phase-1/W7-phase-1-and-2-test-plan.md"
TABLES = {
    "W7 disposition": "W7 disposition",
    "Route inventory": "Route inventory",
    "Grant audit": "Grant audit",
    "Check-to-use families": "Check-to-use",
    "Mallory case matrix": "Mallory cases",
    "Phase gates": "Phase gates",
    "Remote tests": "Phase 2 remote",
    "Evidence record": "Evidence record",
}


def tables(text):
    result = {}
    heading = None
    for line in text.splitlines():
        if line.startswith("### "):
            heading = line[4:]
        elif line.startswith("|") and heading in TABLES:
            values = [v.strip() for v in line.strip().strip("|").split("|")]
            if all(re.fullmatch(r":?-+:?", v) for v in values):
                continue
            result.setdefault(heading, []).append(values)
    assert set(result) == set(TABLES)
    return result


def main():
    with ZipFile(BOOK) as z:
        original = {n: z.read(n) for n in z.namelist()}
    book = openpyxl.load_workbook(BOOK)
    original_sheets = book.sheetnames[:]
    names = ["Plan guide", *TABLES.values(), "Scope baseline"]
    if any(n in original_sheets for n in names):
        raise ValueError("Planning sheets already exist; review before replacing.")
    header_style = copy(book["Completeness"]["A1"]._style)
    body_style = copy(book["Completeness"]["I2"]._style)

    def add(name, rows):
        sheet = book.create_sheet(name)
        for row in rows:
            sheet.append(row)
        for row in sheet:
            for c in row:
                c._style = copy(header_style if c.row == 1 else body_style)
        sheet.freeze_panes = "A2"
        sheet.auto_filter.ref = sheet.dimensions
        sheet.sheet_view.zoomScale = 75
        for c in range(1, sheet.max_column + 1):
            sheet.column_dimensions[get_column_letter(c)].width = 19 if c == 1 else 50
        sheet.row_dimensions[1].height = 34
        for row in range(2, sheet.max_row + 1):
            sheet.row_dimensions[row].height = 100 if name != "Scope baseline" else 82
        return sheet

    add("Plan guide", [
        ["Topic", "Rule / interpretation"],
        ["Review date", "2026-10-29; methodology revision, not new execution evidence."],
        ["Authoritative plan", "docs/phase-1/W7-phase-1-and-2-test-plan.md"],
        ["Two equal pillars", "Complete mediation of every route AND correct initial/dynamic grants. Hardware enforcement cannot make an excessive grant safe."],
        ["Coverage method", "Trace backward from protected sinks and forward from every ingress; reconcile; review cut points, dormant modes and all writers; independent reviewer signs exact-build inventory."],
        ["Nature versus outcome", "Required / Deferred / Trust assumption / Fundamental limitation are scope classifications. Not run / Blocked / Failed / Partially evidenced / Passed are evidence outcomes."],
        ["Classification lock", "Scope baseline records every existing row. No result-driven downgrade; dated owner-approved change retains original classification and reason."],
        ["Phase 1 boundary", "All Resident. Includes Ethernet and standalone FPGA singletons, Mint and approved Mint/Amobea Thread initialization. UART-only success is insufficient."],
        ["Phase 2 boundary", "Two-Namespace networking/remote invocation; approve protocols, grants, failure semantics and bounds first. Does not implicitly authorize eviction."],
        ["Physical identity", "Separate BIT/device configuration evidence from complete installed data-image equality under hold, bound to the current operation before explicit Start."],
        ["Current evidence", "Combined vendor boot and Amaranth recovery PASS only. Implementation last reported in progress. Combined physical acceptance pending; no new W7 closure."],
        ["Planning states", "Route/Grant/Check-to-use rows are seeds for review, not an exhaustive code audit. No new PASS is created."],
        ["Historical preservation", "All original workbook parts and formula caches retained. New planning rows do not enter the 113-item Progress denominator."],
        ["Missing contracts", "Fix numeric bounds, expected faults, ownership/consume and network semantics before testing. Missing approval blocks the affected claim."],
    ])
    parsed = tables(PLAN.read_text())
    for heading, rows in parsed.items():
        extra = heading in {"Route inventory", "Grant audit", "Check-to-use families",
                            "Mallory case matrix", "Remote tests"}
        if extra:
            rows = [rows[0] + ["Planning state", "Owner / reviewer", "Evidence IDs"]] + [
                r + ["Unreviewed / no new qualification", "Unassigned", "Not yet recorded"]
                for r in rows[1:]]
        add(TABLES[heading], rows)
    dispositions = {r[0]: r[1] for r in parsed["W7 disposition"][1:]}
    scope = [["Existing ID", "Existing scope", "Requirement", "Locked claim classification",
              "Reason / phase boundary", "Existing work status (not a new verdict)", "Baseline date"]]
    for row in list(book["Completeness"].values)[1:]:
        key, _, requirement, original_scope, _, status = row[:6]
        nature = dispositions.get(key, "Required at existing stated scope")
        reason = "Engineering/documentation obligation; unchanged criterion and evidence level. No new limitation or waiver."
        if key in dispositions:
            reason = {
                "W7-13": "Arbitrary-program disclosure undecidability; bounded W7-12 confinement still testable.",
                "W7-14": "Named manufacturing/administrator trust assumptions; interface exclusion/provenance checks remain required.",
                "W7-15": "Two-Namespace networking and remote invocation are Phase 2, not Phase 1 Ethernet standalone operation.",
                "W7-05": "Local seal/identity tests remain Phase 1; cross-Namespace authentication extends in Phase 2.",
            }.get(key, "Required bounded local security claim; unresolved contracts block closure, not automatic deferral.")
        scope.append([key, original_scope, requirement, nature, reason, status, "2026-10-29"])
    add("Scope baseline", scope)
    temporary = BOOK.with_suffix(".plan-draft.xlsx")
    book.save(temporary)
    with ZipFile(temporary) as z:
        updated = {n: z.read(n) for n in z.namelist()}
    # New sheets use only styles already present in the original workbook.
    # Retain original data, caches, relationships, formatting and metadata bytes.
    exceptions = {"xl/workbook.xml", "xl/_rels/workbook.xml.rels", "[Content_Types].xml"}
    for name, data in original.items():
        if name not in exceptions:
            updated[name] = data
    ns = "http://schemas.openxmlformats.org/package/2006/content-types"
    content = ET.fromstring(updated["[Content_Types].xml"])
    seen = {(n.tag, n.get("PartName"), n.get("Extension")) for n in content}
    for n in ET.fromstring(original["[Content_Types].xml"]):
        if (n.tag, n.get("PartName"), n.get("Extension")) not in seen:
            content.append(n)
    updated["[Content_Types].xml"] = ET.tostring(content, encoding="utf-8")
    output = BOOK.with_suffix(".plan-verified.xlsx")
    with ZipFile(output, "w") as z:
        for name, data in updated.items():
            z.writestr(name, data)
    formulas = openpyxl.load_workbook(output)
    cached = openpyxl.load_workbook(output, data_only=True)
    old_cached = openpyxl.load_workbook(BOOK, data_only=True)
    with ZipFile(output) as z:
        assert all(z.read(n) == v for n, v in original.items() if n not in exceptions)
    assert formulas.sheetnames == book.sheetnames
    assert cached["Progress"]["B3"].value == 113
    assert cached["Progress"]["B9"].value == 2
    assert formulas["Scope baseline"].max_row == 114
    for heading, rows in parsed.items():
        assert formulas[TABLES[heading]].max_row == len(rows)
    for s in formulas:
        for row in s:
            for c in row:
                if c.data_type == "f":
                    assert cached[s.title][c.coordinate].value == old_cached[s.title][c.coordinate].value
                    if s.title == "Progress":
                        assert cached[s.title][c.coordinate].value is not None
    output.replace(BOOK)
    temporary.unlink()
    print(f"Added {len(names)} planning sheets; preserved original {len(original_sheets)} sheets and caches.")
    print("Scope baseline: 113 rows; original completion count: 2; no new test passes.")


if __name__ == "__main__":
    main()
