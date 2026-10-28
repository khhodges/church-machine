"""Apply the 28 October evidence review without rewriting original XLSX sheets."""
from collections import Counter
from pathlib import Path
from zipfile import ZipFile
import posixpath
import xml.etree.ElementTree as ET

import openpyxl
from refresh_phase1_progress import refresh

ROOT = Path(__file__).resolve().parents[1]
BOOK = ROOT / "docs/phase-1/CTMM_W7_Threat_Test_Plan.xlsx"
DATE = "2026-10-28"
NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG = "http://schemas.openxmlformats.org/package/2006/relationships"
ET.register_namespace("", NS)

ACTORS = "docs/reviews/saved-alice-mallory-execution.md"
MINT = "docs/phase-1/mint-destroy-v1-development.md"
CUTS = "docs/phase-1/mint-create-cut-points.md"
SLOTS = "docs/phase-1/mint-slot-package.md"
OLD_MINT = "docs/reviews/mint-phase1/qualified-protected-namespace.md"
NATIVE = "docs/reviews/mint-phase1/native-lambda-binding.md"
OBJECTIVES = "docs/phase-1/W7-plus-plus-test-objectives.md"
SAVE = "tests/server/test_named_call_save_attestation.py"
UPDATES = {}


def add(ids, status, evidence, remaining, links):
    for key in ids.split():
        assert key not in UPDATES
        UPDATES[key] = (status, evidence, remaining, links)


add("W7-01", "Needs verification",
    "Recorded full-core RTL CREATE/DESTROY cases reject captured old GTs after release and reuse; slot tests cover version boundaries. Partial RTL-model evidence, not physical-board timing.",
    "Run copied-GT N sweep, generation-boundary coverage and FPGA cycle-cost measurements; identify exact authorized revoke operation.", [MINT, SLOTS])
add("W7-02", "Needs verification",
    "2026-10-20 saved Alice/Mallory image: Alice stores/retrieves 731; Mallory first faults NO_CAPABILITY at LOAD PC 1 before DREAD; Alice body unchanged. Mint adds focused identity/version checks.",
    "Complete exhaustive typ/tag/version and structured offset coverage, plus exact-board evidence. Missing-row denial alone is not forged-reference closure.", [ACTORS, MINT])
add("W7-03", None, "No completed actual-production-root closure proof identified in reviewed evidence.",
    "Analyze production root, dynamic grants and loading assumptions; retain W7 baseline requirement for comparative claims.", [OBJECTIVES])
add("W7-04", "Needs verification",
    "Native Mint and full-core RTL lifecycle reports provide allocation/issued-GT evidence. Private provisioning and permissive PkVerify are explicit test restrictions.",
    "Complete birth-authority census for each type and operational requester/proof enforcement; do not credit test authorization as production security.", [MINT, NATIVE])
add("W7-05", "Needs verification",
    "Exact-byte compiler/save and destination checks provide supporting integrity evidence, not unsealer or cross-Namespace acceptance.",
    "Reconcile sealing/type oracle; test unauthorized unseal and qualified Namespace pairs. Keep Phase 2 dependencies explicit.", [SAVE, OBJECTIVES])
add("W7-06", "Needs verification",
    "Cleaner component/lifecycle tests cover allocation, clearing, reuse and exhaustion under isolated provisioning.",
    "Define and measure enforceable resource/latency bounds and neighbor isolation; do not assume tracing GC or eviction.", [MINT, OBJECTIVES])
add("W7-07", "Needs verification",
    "Saved-design execution and exact-byte Save checks demonstrate partial persistence-path behavior. Prior session: five named-CALL save tests passed in isolated repositories.",
    "Cover relevant artifact types and authority-preserving lifecycle/reset durability; file publication is not secure eviction/reload acceptance.", [ACTORS, SAVE, CUTS])
add("W7-08", None, "No qualifying depth-independent elapsed-time result identified in reviewed evidence.",
    "Define fault-stop versus return-to-caller promise and measure bounded behavior across nesting depths.", [OBJECTIVES])
add("W7-09", "Needs verification",
    "Native LAMBDA entry/return implementation evidence exists; LAMBDA RETURN preserves current CRs. This does not qualify retained checkpoints.",
    "Verify one-shot checkpoint identity, copied handles and reset lifetime separately from ordinary CALL/RETURN.", [NATIVE, OBJECTIVES])
add("W7-10", None,
    "Sequential private Mint lifecycle tests do not establish concurrency. Cut-point report records restored ABA and incomplete exclusion evidence.",
    "Define allowed concurrency and prove whole-update exclusion/interruption semantics. Do not count sequential lifecycle tests as concurrency acceptance.", [MINT, CUTS])
add("W7-11", "Needs verification",
    "Exact artifact/image identities and first-fault attribution are recorded for the saved actor demonstration; this is supporting evidence only.",
    "Define originating principal and permitted transformations; verify attribution through complete call chains.", [ACTORS, OBJECTIVES])
add("W7-12", "Needs verification",
    "Saved actor demonstration proves one unauthorized access attempt is stopped without changing Alice; no whole-callee leakage proof.",
    "Analyze outward authority and explicit channels over the whole callee; retain timing/covert-channel exclusions.", [ACTORS, OBJECTIVES])
add("W7-13 W7-14", None,
    "Limitation/trust-assumption disposition, not an executable acceptance test. Original worksheet claims and statuses retained.",
    "Document undecidability and administrator/manufacturing trust boundaries; never mark them passed through ordinary testing.", [OBJECTIVES])
add("W7-15", None, "Distribution remains explicitly outside Phase 1.",
    "Keep two-Namespace networking and remote invocation in Phase 2.", [OBJECTIVES])

add("RES-ide.Alice RES-ide.Mallory SIM-05 CM-A", "Needs verification",
    "Stronger evidence than the earlier adapted fixtures: 2026-10-20 actual saved NewLayout image, ordinary admission/design paths, authorized Alice 731 round-trip, Mallory NO_CAPABILITY at LOAD PC 1, Alice unchanged. Report records 102 server checks plus JS/image checks. Not rerun in this review.",
    "Retain exact image/artifact identities and exclusions. Close each full criterion only after its remaining isolation/tuple/lifecycle coverage; no FPGA or power-loss acceptance implied.", [ACTORS])
add("IDE-02 IDE-06 SIM-01 REL-03 BASE-01 BASE-08", None,
    "28 October compiler/save work resolves named CALL methods from saved binary APIs; Save's independent recompile now uses trusted lookup too. Prior session recorded five passing isolated save regressions, including altered code, missing target, wrong pin and forged API rejection. Legacy CALL compatibility-test updates are merged, not a fresh full-suite result.",
    "Reconcile remaining item-specific regressions and verify exact saved-source flow. Do not infer complete editor ownership, ISA conformance or release-suite acceptance from focused tests.", [SAVE, "simulator/test_unresolved_call_compile_error.js", "tests/server/test_call_method_lookup_isolated.py"])
add("RES-ide.Mint G1 G7 FUNC-02", None,
    "Native Lambda and compiled Mint/Cleaner CREATE/DESTROY now have bounded simulator/RTL evidence. Historical protected-Mint positive acceptance is explicitly superseded by the CR-preserving Lambda RETURN correction; its cleanup shortcut is not valid authority. Current isolated V1 lifecycle evidence is distinct.",
    "Separate native provisioning/result interfaces from historical adapter behavior; complete operational proof/requester/cleanup gates and qualify exact saved service bytes. No live service or board closure.", [NATIVE, MINT, OLD_MINT])
add("G4 G5 SEAL-03", None,
    "CREATE cut-point report records 9 PASS, 2 FAIL, 21 BLOCKED. Seal-only publication checks fail; restored ABA and restart-dependent acceptance remain blocked. This is recorded diagnostic evidence, not a fresh run; harness PASS is not acceptance PASS.",
    "Do not use valid seal as completion oracle. Establish whole-update exclusion, authorized retained-history restart and durable commit independently; no new recovery policy is authorized.", [CUTS, MINT])
add("S05", "Needs verification",
    "Slot package reports 19 full-core RTL replay tests; CREATE/DESTROY lifecycle evidence includes version-0 issuance, release/reuse at version 1, stale-GT rejection and zeroed reused storage. Private fixture history is explicit.",
    "Complete full criterion including retained history, retirement boundaries and live/reused-slot applicability; model evidence is not physical acceptance.", [SLOTS, MINT])
add("SEAL-02 CM-H", "Needs verification",
    "Saved actor report binds exact image/artifact identities. Named-CALL save reproduction rejects altered code and forged API metadata in isolated tests. This supports integrity/attribution, not full release or field coverage.",
    "Complete item-specific identity/replay coverage and bind exact source, generated image, bitstream and physical observations.", [ACTORS, SAVE])
add("REL-01 REL-02", None,
    "Reviewed software and RTL reports explicitly exclude physical-board qualification. No new exact-build or board acceptance run was performed for this update.",
    "Freeze the approved candidate and obtain matching build/timing/provenance plus separately authorized physical acceptance. Never relabel historical bitstreams.", [OBJECTIVES, MINT])


def main():
    book = openpyxl.load_workbook(BOOK)
    indexes = {r[0].value: r[0].row for r in book["Completeness"] if r[0].value}
    assert not (UPDATES.keys() - indexes.keys()), UPDATES.keys() - indexes.keys()
    for _, _, _, links in UPDATES.values():
        for link in links:
            assert (ROOT / link).is_file(), link
    with ZipFile(BOOK) as z:
        infos = z.infolist()
        files = {i.filename: z.read(i.filename) for i in infos}
    original = dict(files)
    wb = ET.fromstring(files["xl/workbook.xml"])
    relations = ET.fromstring(files["xl/_rels/workbook.xml.rels"])
    targets = {r.get("Id"): r.get("Target") for r in relations}
    sheets = {}
    for s in wb.find(f"{{{NS}}}sheets"):
        target = targets[s.get(f"{{{REL}}}id")]
        sheets[s.get("name")] = (target.lstrip("/") if target.startswith("/")
                                else posixpath.normpath("xl/" + target))
    trees = {name: ET.fromstring(files[sheets[name]]) for name in
             ("Completeness", "Progress", "Tracking guide")}

    def set_cell(sheet, address, text):
        data = trees[sheet].find(f"{{{NS}}}sheetData")
        number = "".join(c for c in address if c.isdigit())
        row = next(r for r in data if r.get("r") == number)
        cell = next((c for c in row if c.get("r") == address), None)
        if cell is None:
            cell = ET.SubElement(row, f"{{{NS}}}c", {"r": address})
            row[:] = sorted(row, key=lambda c: openpyxl.utils.cell.column_index_from_string(
                "".join(x for x in c.get("r") if x.isalpha())))
        for child in list(cell):
            cell.remove(child)
        cell.set("t", "inlineStr")
        ET.SubElement(ET.SubElement(cell, f"{{{NS}}}is"), f"{{{NS}}}t").text = text

    # Relative clickable repository links; labels list every supporting source.
    sheet_path = sheets["Completeness"]
    relpath = posixpath.join(posixpath.dirname(sheet_path), "_rels",
                            posixpath.basename(sheet_path) + ".rels")
    rels = ET.fromstring(files[relpath]) if relpath in files else ET.Element(f"{{{PKG}}}Relationships")
    hyperlinks = trees["Completeness"].find(f"{{{NS}}}hyperlinks")
    if hyperlinks is None:
        hyperlinks = ET.Element(f"{{{NS}}}hyperlinks")
        tree = trees["Completeness"]
        # OOXML hyperlinks follow validations and precede print/page settings.
        following = {"printOptions", "pageMargins", "pageSetup", "headerFooter",
                     "rowBreaks", "colBreaks", "drawing", "tableParts", "extLst"}
        at = next((i for i, e in enumerate(tree) if e.tag.split("}")[-1] in following), len(tree))
        tree.insert(at, hyperlinks)
    for key, (status, evidence, remaining, links) in UPDATES.items():
        row = indexes[key]
        if status:
            set_cell("Completeness", f"F{row}", status)
        prior = book["Completeness"][f"I{row}"].value or ""
        marker = f"Review {DATE} (recorded evidence; no fresh acceptance run): "
        if prior.startswith(marker):
            prior = prior.split("\n\nEarlier baseline: ", 1)[-1]
        set_cell("Completeness", f"I{row}", marker + evidence + "\n\nEarlier baseline: " + prior)
        # Preserve the original acceptance requirement, adding the review action.
        original_action = str(book["Completeness"][f"J{row}"].value or "").split("\n\nReview action:", 1)[0]
        set_cell("Completeness", f"J{row}", original_action + "\n\nReview action: " + remaining)
        old_links = str(book["Completeness"][f"M{row}"].value or "")
        all_links = list(dict.fromkeys(links + [x.strip() for x in old_links.split(";") if x.strip()]))
        set_cell("Completeness", f"M{row}", "; ".join(all_links))
        set_cell("Completeness", f"L{row}", DATE)
        address = f"M{row}"
        for h in list(hyperlinks):
            if h.get("ref") == address:
                hyperlinks.remove(h)
        rid = f"review20261028_{row}"
        for r in list(rels):
            if r.get("Id") == rid:
                rels.remove(r)
        ET.SubElement(rels, f"{{{PKG}}}Relationship", {
            "Id": rid, "Type": REL + "/hyperlink", "TargetMode": "External",
            "Target": posixpath.relpath(links[0], "docs/phase-1")})
        ET.SubElement(hyperlinks, f"{{{NS}}}hyperlink", {"ref": address, f"{{{REL}}}id": rid})
    set_cell("Progress", "B2", DATE)
    set_cell("Tracking guide", "B6",
             "Open: work/decision remains. Blocked: prerequisite missing. Not run: no qualifying objective run. Needs verification may include partial simulator/RTL evidence; it is not a threat pass. Limitations retain their original disposition.")
    set_cell("Tracking guide", "B7",
             "28 October update reviews recorded reports and prior-session focused tests; no fresh acceptance run. Threat Map, Summary and Method remain byte-for-byte unchanged. No W7 threat newly passed. Hardware, W7 baseline and full coverage remain separate gates.")
    for name, tree in trees.items():
        files[sheets[name]] = ET.tostring(tree, encoding="utf-8")
    files[relpath] = ET.tostring(rels, encoding="utf-8")
    candidate = BOOK.with_suffix(".review.xlsx")
    with ZipFile(candidate, "w") as z:
        for info in infos:
            z.writestr(info, files.pop(info.filename))
        for name, data in files.items():
            z.writestr(name, data)
    refresh(candidate)
    with ZipFile(candidate) as z:
        for name in ("Threat Map", "Summary", "Method", "Baseline audit", "Approved target"):
            assert z.read(sheets[name]) == original[sheets[name]], name
        assert z.read("xl/styles.xml") == original["xl/styles.xml"]
    result = openpyxl.load_workbook(candidate, data_only=True)
    counts = Counter(r[5] for r in list(result["Completeness"].values)[1:])
    assert sum(counts.values()) == 113 and counts["Complete"] == 2
    assert result["Progress"]["B3"].value == 113
    assert result["Progress"]["B9"].value == counts["Complete"]
    assert result["Progress"]["B7"].value == counts["Needs verification"]
    assert not any(r[5] == "Complete" for r in list(result["Completeness"].values)[1:]
                   if str(r[0]).startswith("W7-"))
    candidate.replace(BOOK)
    print(f"Reviewed {len(UPDATES)} rows; original threat sheets and styles preserved.")
    print(dict(counts))


if __name__ == "__main__":
    main()
