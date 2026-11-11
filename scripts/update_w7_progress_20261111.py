"""Append dated evidence without promoting incomplete requirement closures."""
from pathlib import Path
from collections import Counter
from copy import copy
import shutil
import zipfile
import xml.etree.ElementTree as ET
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "docs/phase-1/CTMM_W7_Threat_Test_Plan.xlsx"
DATE = "2026-11-11"
HANDOFF = "docs/phase-2/cooperative-retry/demonstration-handoff-20261111.txt"


def main():
    w = openpyxl.load_workbook(PATH)
    if "Milestones 2026-11-11" in w.sheetnames:
        raise SystemExit("Dated update already applied; refusing duplicate.")
    old = openpyxl.load_workbook(PATH, data_only=True)
    original = {s: list(w[s].values) for s in ("Threat Map", "Summary", "Method", "Scope baseline")}
    statuses = {r[0]: r[5] for r in list(w["Completeness"].values)[1:]}
    backup = ROOT / "generated-artifacts/W7-before-20261111.xlsx"
    if backup.exists():
        raise SystemExit("Backup already exists; inspect before retry.")
    shutil.copyfile(PATH, backup)
    rows = [
        ("LUMP loading", "Demonstrated on hardware", "Complete 64-word LUMP delivered and published by SYSTEM.", "Publication alone did not complete the old call; general rejection coverage remains.", "FUNC-07; W7-07", HANDOFF),
        ("Revision adoption", "Demonstrated on hardware", "64/256-word revisions coexisted; results 17 → 29 → 17 and distinct caller PCs.", "No general migration, retirement or stale-reference closure.", "FUNC-07; W7-01; W7-10", HANDOFF),
        ("Image replacement", "Demonstrated on hardware", "64 KiB All Waiting → USER B; epoch 1 → 2; USER B progressed without FPGA reprogramming during replacement.", "Two hardware-pinned images; not open-ended loading or power-cycle persistence.", "FUNC-07; W7-07", HANDOFF),
        ("Combined FPGA build", "Build and artifact checks passed", "Exact BIT retained; setup +5.008 ns / hold +0.090 ns; frozen source/RTL and vendor receipt verified.", "INIT warnings retained; specific SHA init verified. CFGBVS remains; no installed-BIT readback/DNA attestation.", "REL-01; REL-02; BASE-09; CM-H; H19; H20", HANDOFF),
        ("Host/package tools", "103 local checks passed", "Upload, adoption, replacement and package checks passed in the milestone preparation.", "Software tests, not 103 physical or W7 passes.", "IDE-05; FUNC-07", "docs/phase-2/cooperative-retry/test_*_host.py; test_upload_combined_initial.py; test_combined_vendor_package.py"),
        ("Evidence handoff", "Bundle assembled and verified", "Exact BIT, four unchanged host ZIPs, reports, diagnostics and checksum manifest retained.", "Later raw UART captures remain on operator computer.", "CM-H; REL-01", HANDOFF),
        ("GitHub milestone", "Source pushed; assets blocked", "Focused branch and annotated tag pushed; draft release created.", "Asset uploads failed HTTP 400; not a completed remote binary archive.", "REL-01; CM-H", "https://github.com/khhodges/church-machine/commit/b16731914a216b20b25f80ea7efe0b97e879454a"),
        ("Manuscript", "Updated and exported", "Three demonstrations moved into observed results; 17-page PDF and editable Word checked.", "Operator-reported evidence with explicit limitations, not independent physical reproduction.", "CM-H", "docs/phase-2/cooperative-retry/containment-revised.md"),
        ("Five saved designs", "Compatibility review completed", "Four native saved structures validated; selected files/hash checks passed.", "Original is historical; Phase 1 missing nstab/pkverify/ide.Alace compilations. IDE profile differs from demo BIT; no fresh images or hardware runs.", "IDE-03; FUNC-07; SIM-03", "generated-artifacts/namespace-compatibility-20261111.json"),
        ("Phase 2 IDE automation", "Proposed; not implemented", "End-to-end IDE orchestration specified for upgrades, image replacement, Namespace install, tests and evidence.", "Remote maintenance authorization, general loading and full acceptance remain open.", "IDE-05; W7-03; W7-04; W7-11; N09", "docs/phase-2/development-build-proposal.md"),
    ]
    s = w.create_sheet("Milestones 2026-11-11", 0)
    s.append(["Milestone", "Evidence status", "Achieved / specified", "Remaining boundary", "Related IDs", "Evidence source", "Reviewed"])
    for row in rows:
        s.append([*row, DATE])
    s.freeze_panes = "A2"
    s.auto_filter.ref = s.dimensions
    for i, width in enumerate((27, 32, 72, 80, 35, 75, 16), 1):
        s.column_dimensions[openpyxl.utils.get_column_letter(i)].width = width
    for cell in s[1]:
        cell.fill = PatternFill("solid", fgColor="173E57")
        cell.font = Font(color="FFFFFF", bold=True)
    for row in s.iter_rows(min_row=2):
        for c in row:
            c.alignment = Alignment(wrap_text=True, vertical="top")
        s.row_dimensions[row[0].row].height = 80
    notes = {
        "FUNC-07": "Three bounded positive hardware paths achieved: full-LUMP publication, 17→29→17 adoption and 64 KiB replacement. Open-ended application loading remains unimplemented; demo BIT pins two image hashes.",
        "CM-H": "New exact combined source/RTL/BIT bundle and operator-reported hardware evidence. Raw captures, independent installed readback and silicon-DNA attestation remain absent.",
        "REL-01": "Additional exact combined-build provenance retained; preserve the earlier candidate's scoped completion. New timing +5.008/+0.090 ns; warnings explicitly retained.",
        "REL-02": "Three positive paths observed on the second board; not full release qualification. See dated milestones for warnings, provenance and missing negative tests.",
        "BASE-09": "Additional frozen combined build/source identities verified. This does not turn mutable current source into the demonstrated source.",
        "H19": "New vendor and physical observations are supporting evidence, not full same-fixture cross-model coverage.",
        "H20": "New successful image transfers and execution are not the cold/warm reboot, recovery and endurance matrix.",
        "W7-07": "Hardware replacement and LUMP publication support lifecycle progress; authority-preserving persistence and interrupted recovery remain unclosed.",
        "W7-08": "USER B progress and renewal counters observed; bounded expiry/depth/exemption coverage still required.",
        "CM-F": "Progress/renewals observed; do not equate them with exhaustive watchdog expiry/write-containment evidence.",
        "IDE-05": "103 host/package checks passed. Complete one-click IDE orchestration remains proposed, not accepted.",
        "IDE-03": "Prior editor completion retained. New local design audit is not execution acceptance; Original historical, Phase 1 has missing compilation names.",
        "SIM-03": "Saved-design inspection found IDE/demo-profile mismatch and historical Original layout. No fresh simulation or hardware compatibility acceptance.",
        "SIM-04": "Renewal observations do not close cross-layer watchdog conformance.",
    }
    for row in w["Completeness"].iter_rows(min_row=2):
        if row[0].value in notes:
            row[8].value = f"Update {DATE}: {notes[row[0].value]}\n\nEarlier evidence:\n{row[8].value or ''}"
            row[11].value = DATE
            row[12].value = (row[12].value or "") + "; Milestones 2026-11-11; " + HANDOFF
    p = w["Progress"]
    p["B2"] = DATE
    p["A1"] = "Completeness tracking — achieved milestones and requirement closure"
    p["A13"] = "Read first"
    p["B13"] = "See Milestones 2026-11-11: three hardware demonstrations achieved. Counts below/above measure full requirement closure, not engineering progress or security coverage."
    p["B13"].alignment = Alignment(wrap_text=True)
    p.row_dimensions[13].height = 65
    for row in w["Phase gates"].iter_rows(min_row=2):
        if row[0].value in ("P1-04", "P1-05", "P1-07"):
            row[3].value = f"Update {DATE}: Later, distinct combined build and three bounded operator-reported demonstrations recorded in Milestones 2026-11-11. Full gate remains unclosed; do not substitute this candidate for the historical one.\n\nHistorical record: {row[3].value}"
        elif str(row[0].value).startswith("P2-"):
            row[3].value = f"Reviewed {DATE}: No networking acceptance established by the three local positive-path demos. IDE automation is proposed, not implemented.\n\nEarlier record: {row[3].value}"
    w["Tracking guide"].append(["Dated milestones", f"{DATE}: distinguish achieved sub-milestones from complete requirement rows. Original claims and historical Scope baseline retained; no new W7 closure inferred."])
    w.active = 0
    w.save(PATH)
    # Restore valid unchanged Progress formula caches; calculate original threat
    # formulas whose caches were blank. Preserve formulas, not just their values.
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    cache = {}
    for sheet in w:
        for row in sheet:
            for c in row:
                if c.data_type == "f":
                    value = old[sheet.title][c.coordinate].value
                    if sheet.title == "Threat Map":
                        assert sheet.cell(c.row, 10).value is None and sheet.cell(c.row, 11).value is None
                        value = "Not run"
                    elif sheet.title == "Summary":
                        value = (15 if c.column in (2, 4) else 0) if c.row == 11 else (
                            sum(w["Threat Map"].cell(i, 4).value == sheet.cell(c.row, 1).value for i in range(6, 21))
                            if c.column in (2, 4) else 0)
                    assert value is not None, (sheet.title, c.coordinate)
                    cache[(sheet.title, c.coordinate)] = value
    with zipfile.ZipFile(PATH) as z:
        files = {n: z.read(n) for n in z.namelist()}
    for index, sheet in enumerate(w, 1):
        name = f"xl/worksheets/sheet{index}.xml"
        xml = ET.fromstring(files[name])
        for cell in xml.findall(".//m:c", ns):
            if cell.find("m:f", ns) is None:
                continue
            value = cache[(sheet.title, cell.attrib["r"])]
            v = cell.find("m:v", ns)
            if v is None:
                v = ET.SubElement(cell, "{" + ns["m"] + "}v")
            if isinstance(value, str):
                cell.set("t", "str")
            else:
                cell.attrib.pop("t", None)
            v.text = str(value)
        files[name] = ET.tostring(xml, encoding="utf-8", xml_declaration=True)
    with zipfile.ZipFile(PATH, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in files.items():
            z.writestr(name, data)
    check = openpyxl.load_workbook(PATH)
    values = openpyxl.load_workbook(PATH, data_only=True)
    assert {r[0]: r[5] for r in list(check["Completeness"].values)[1:]} == statuses
    for name, snapshot in original.items():
        assert list(check[name].values) == snapshot, name
    for (name, coord), value in cache.items():
        assert values[name][coord].value == value, (name, coord)
    assert values["Progress"]["B2"].value == DATE
    assert len(list(check["Completeness"].values)) == 114
    out = ROOT / "generated-artifacts/CTMM_W7_Progress_2026-11-11.xlsx"
    shutil.copyfile(PATH, out)
    print("PASS: 10 milestones; 14 evidence updates; original claims/statuses preserved; all formula caches verified.")
    print(out)


if __name__ == "__main__":
    main()
