"""Export planning traceability, preserving original acceptance criteria/statuses."""
import hashlib
from pathlib import Path
import re
import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs/phase-1/CTMM_W7_Threat_Test_Plan.xlsx"
OUT = ROOT / "generated-artifacts/Phase2-Implementation-Scope-Map.xlsx"
STREAMS = {
    "W7 security": ("R2/R3/R4/R5/R6/R9", "A/F/T/B/S/Q/N; retain W7-specific oracle"),
    "Hardware acceptance": ("R1/R2/R4/R8/R9", "F/A/T/D plus original H opcode/operand coverage"),
    "Software acceptance": ("R3/R4/R5/R6/R7", "A/B/S/Q/N plus original S service criteria"),
    "CM objectives": ("R3/R4/R5/R8/R9", "F/A/Q/D plus original CM criteria"),
    "Mint gates": ("R4/R5", "A/B plus original Mint criteria"),
    "Named abstractions": ("R3/R4/R5/R6", "A/B/S/Q; test each named service"),
    "IDE": ("R7/R8/R9", "T/D plus actual IDE user journeys"),
    "Missing functions": ("R2/R3/R4/R5/R6", "F/A/B/Q/N; contract-specific tests"),
    "Performance": ("R3/R4/R5/R6/R9", "T/B/S/Q/N plus original numeric measurement criteria"),
    "Seal storage": ("R2/R4/R5", "A/S/N plus original sealing criteria"),
    "Simulator / ISA": ("R4/R9", "F/A plus original cross-layer ISA criteria"),
    "RTL / bitstream": ("R1/R4/R8/R9", "D plus exact-build physical evidence"),
    "Specification": ("R9", "D plus original specification closure"),
    "Baseline audit": ("R1/R4/R7/R8/R9", "D and affected original regression criteria"),
}


def main():
    before = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    source = openpyxl.load_workbook(SOURCE, read_only=True, data_only=True)
    w = openpyxl.Workbook()
    guide = w.active
    guide.title = "Read first"
    for row in [
        ("Purpose", "Implementation-scope routing, 11 November 2026; not test results or full subcase coverage."),
        ("Source workbook SHA256", before),
        ("Scope document", "docs/phase-2/development-implementation-scope.md"),
        ("Streams", "P2-R1 through P2-R9 in scope document; assignments identify responsible implementation areas."),
        ("Link precision", "W7-to-Phase2 family links are provisional. Each original closure criterion remains mandatory; refine into exact case/subcase IDs during contract work."),
        ("No waiver", "Neither the 113 original rows nor 89 Phase 2 groups replaces the other. W7 limitations/trust assumptions are not ordinary test PASS targets."),
        ("Status", "Source workbook unchanged. No new test, synthesis or physical run performed."),
    ]:
        guide.append(row)
    s = w.create_sheet("W7 requirement routing")
    s.append(["ID", "Area", "Requirement", "Scope", "Recorded status", "Implementation streams",
              "Candidate test families", "Original closure criterion", "Existing evidence", "Planning boundary"])
    for row in list(source["Completeness"].values)[1:]:
        streams, families = STREAMS[row[1]]
        s.append([row[0], row[1], row[2], row[3], row[5], streams, families, row[9], row[12],
                  "Retain original oracle; linkage is proposed, not evidence of coverage."])
    assert s.max_row == 114
    t = w.create_sheet("Phase2 acceptance inventory")
    t.append(["Case ID", "Required result (retained)", "Recorded contract gate", "Implementation streams", "Execution status"])
    routing = {"F": "R3/R4/R9", "A": "R2/R3/R4/R5/R9", "T": "R1/R2/R3/R7",
               "B": "R4/R5", "S": "R5", "Q": "R4/R5", "N": "R2/R4/R6",
               "D": "R7/R8/R9"}
    for line in (ROOT / "docs/phase-2/test-checklist.md").read_text().splitlines():
        if re.match(r"^\| (?:F\.\d+|[ATBSQND]\d+) \|", line):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            t.append([cells[0], cells[1], cells[2] if len(cells) > 2 else "See referenced contract",
                      routing[cells[0][0]], "Not requalified in this planning export"])
    assert t.max_row == 90, t.max_row
    assert len({t.cell(i, 1).value for i in range(2, 91)}) == 89
    for sheet in w:
        sheet.freeze_panes = "A2"
        sheet.auto_filter.ref = sheet.dimensions
        for cell in sheet[1]:
            cell.fill = PatternFill("solid", fgColor="173E57")
            cell.font = Font(color="FFFFFF", bold=True)
        for row in sheet:
            for cell in row:
                cell.alignment = Alignment(vertical="top", wrap_text=True)
        for col in range(1, sheet.max_column + 1):
            sheet.column_dimensions[openpyxl.utils.get_column_letter(col)].width = 22 if col == 1 else 60
        for i in range(2, sheet.max_row + 1):
            sheet.row_dimensions[i].height = 100
    w.save(OUT)
    result = openpyxl.load_workbook(OUT, read_only=True, data_only=True)
    assert result["W7 requirement routing"].max_row == 114
    assert result["Phase2 acceptance inventory"].max_row == 90
    assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == before
    print("PASS: 113 requirements and 89 unique Phase 2 groups exported; original workbook unchanged.")


if __name__ == "__main__":
    main()
