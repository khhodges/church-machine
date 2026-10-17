"""Refresh preview caches without changing tracker data or other worksheet XML.

openpyxl drops formula caches on save. Run this after editing the tracker.
Only the Progress sheet's known COUNT formulas are supported; new formulas fail
explicitly rather than receive a guessed cached result.
"""
import re
import posixpath
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET

import openpyxl

BOOK = Path(__file__).resolve().parents[1] / "docs/phase-1/CTMM_W7_Threat_Test_Plan.xlsx"
NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
ET.register_namespace("", NS)


def refresh(path=BOOK):
    book = openpyxl.load_workbook(path)
    progress = book["Progress"]
    rows = list(book["Completeness"].values)[1:]

    def count(formula):
        if formula == "COUNTA(Completeness!A2:A10000)":
            return sum(r[0] is not None for r in rows)
        match = re.fullmatch(r'COUNTIF(S)?\((.*)\)', formula)
        if not match:
            raise ValueError(f"Unsupported Progress formula: {formula}")
        args = match[2].split(",")
        if len(args) not in (2, 4):
            raise ValueError(formula)
        criteria = []
        for reference, criterion in zip(args[::2], args[1::2]):
            col = re.fullmatch(r"Completeness!(?P<column>[ABF])2:(?P=column)10000", reference)
            if not col:
                raise ValueError(reference)
            if criterion.startswith('"') and criterion.endswith('"'):
                value = criterion[1:-1]
            elif re.fullmatch(r"A\d+", criterion):
                value = progress[criterion].value
            else:
                raise ValueError(criterion)
            criteria.append((ord(col[1]) - ord("A"), value))
        return sum(all(r[i] == value for i, value in criteria) for r in rows)

    expected = {}
    for row in progress:
        for cell in row:
            if cell.data_type != "f":
                continue
            formula = cell.value[1:]
            if formula == ('IFERROR(COUNTIF(Completeness!F2:F10000,"Complete")/'
                           '(COUNTA(Completeness!A2:A10000)-'
                           'COUNTIF(Completeness!F2:F10000,"Out of scope")),0)'):
                total = count("COUNTA(Completeness!A2:A10000)")
                excluded = count('COUNTIF(Completeness!F2:F10000,"Out of scope")')
                complete = count('COUNTIF(Completeness!F2:F10000,"Complete")')
                value = complete / (total - excluded) if total != excluded else 0
            else:
                value = count(formula)
            expected[cell.coordinate] = value

    with ZipFile(path) as archive:
        files = {info.filename: archive.read(info.filename) for info in archive.infolist()}
        infos = archive.infolist()
    workbook = ET.fromstring(files["xl/workbook.xml"])
    sheet = next(s for s in workbook.find(f"{{{NS}}}sheets") if s.get("name") == "Progress")
    relations = ET.fromstring(files["xl/_rels/workbook.xml.rels"])
    target = next(r.get("Target") for r in relations if r.get("Id") == sheet.get(f"{{{REL}}}id"))
    target = target.lstrip("/") if target.startswith("/") else posixpath.normpath("xl/" + target)
    xml = ET.fromstring(files[target])
    labels = {
        "C14": "Complete items",
        "D14": "Blocked items",
        "B13": "Counts of different items; each item has one status. Row completion is not ISA/security coverage.",
    }
    for cell in xml.iter(f"{{{NS}}}c"):
        address = cell.get("r")
        if address in expected:
            value = cell.find(f"{{{NS}}}v")
            if value is None:
                value = ET.SubElement(cell, f"{{{NS}}}v")
            value.text = str(expected[address])
        elif address in labels:
            for child in list(cell):
                cell.remove(child)
            cell.set("t", "inlineStr")
            ET.SubElement(ET.SubElement(cell, f"{{{NS}}}is"), f"{{{NS}}}t").text = labels[address]
    files[target] = ET.tostring(xml, encoding="utf-8")
    candidate = path.with_suffix(".preview.xlsx")
    with ZipFile(candidate, "w") as archive:
        for info in infos:
            archive.writestr(info, files[info.filename])
    cached = openpyxl.load_workbook(candidate, data_only=True)
    formulas = openpyxl.load_workbook(candidate)
    for address, value in expected.items():
        actual = cached["Progress"][address].value
        assert actual is not None and abs(actual - value) < 1e-12, address
        assert formulas["Progress"][address].value == progress[address].value, address
    with ZipFile(path) as old, ZipFile(candidate) as new:
        assert all(old.read(name) == new.read(name) for name in files if name != target)
    candidate.replace(path)
    print(f"Refreshed {len(expected)} formula results; all other workbook parts unchanged.")
    print(f"Tracked: {expected['B3']}; Complete: {expected['B9']}; Blocked: {expected['B5']}")


if __name__ == "__main__":
    refresh()
