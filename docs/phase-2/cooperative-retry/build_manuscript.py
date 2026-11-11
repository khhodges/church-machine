"""Build the separate review manuscript; never modify the supplied DOCX."""
from pathlib import Path
import hashlib
import re
import subprocess
import tempfile
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
ORIGINAL = ROOT / "attached_assets/CM-Containment-as-Architecture_1794335629573.docx"
ORIGINAL_HASH = "f826ecbafdfdb81ce38bb9605e07732b8e524e92d420e1896e319cdae45c72da"
SOURCE = HERE / "containment-revised.md"
DOCX = HERE / "containment-revised.docx"
HTML = ROOT / "generated-artifacts/containment-paper/containment-revised.html"
PDF = HTML.with_suffix(".pdf")

CSS = """
html { background: #eceff2; color: #17212b; }
body { box-sizing: border-box; max-width: 1000px; margin: 32px auto;
  padding: 64px 72px; background: white; font: 17px/1.65 Georgia, serif; }
header { border-bottom: 2px solid #284a62; margin-bottom: 32px; }
h1,h2,h3 { font-family: system-ui, sans-serif; line-height: 1.25; color: #173e57; }
h1.title { font-size: 38px; margin-bottom: 12px; }
p.subtitle { font-size: 23px; line-height: 1.35; }
p.author,p.date { font-family: system-ui, sans-serif; font-size: 14px; }
h2 { margin-top: 42px; font-size: 26px; }
h3 { margin-top: 28px; font-size: 20px; }
a { color: #175e87; overflow-wrap: anywhere; }
table { border-collapse: collapse; width: 100%; font-size: 14px; line-height: 1.5; }
th,td { text-align: left; vertical-align: top; padding: 10px; border-bottom: 1px solid #ccd5dc; }
th { background: #edf3f7; }
code { font-size: .85em; overflow-wrap: anywhere; }
pre { white-space: pre-wrap; word-break: break-all; padding: 16px; background: #f1f5f7; }
blockquote { border-left: 3px solid #284a62; margin-left: 0; padding-left: 24px; }
@media(max-width:700px) { body { margin: 0; padding: 24px; font-size: 16px; }
table { font-size: 12px; } th,td { padding: 6px; } }
@media print { html { background: white; } body { margin: 0; padding: 0; max-width: none; }
h2,h3 { break-after: avoid; } tr { break-inside: avoid; }
body { font-size: 10.5pt; line-height: 1.45; }
h1.title { font-size: 26pt; } h2 { font-size: 17pt; margin-top: 24pt; }
h3 { font-size: 13pt; } table { font-size: 8.5pt; } th,td { padding: 5pt; }
p { orphans: 3; widows: 3; } }
@page { size: A4; margin: 20mm 18mm;
  @bottom-center { content: counter(page); font: 9pt sans-serif; color: #52606d; } }
"""


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    assert digest(ORIGINAL) == ORIGINAL_HASH, "Original draft changed; stop."
    text = SOURCE.read_text()
    # All project and external citations must resolve to defined references.
    refs = set(re.findall(r"^\d+\.", text, re.M))
    for group in re.findall(r"\[([0-9, ]+)(?:, §[^\]]+)?\]", text):
        for number in re.findall(r"\d+", group):
            assert number + "." in refs, f"Missing reference {number}"
    for number in re.findall(r"\[P(\d+)\]", text):
        assert f"**[P{number}]**" in text, f"Missing project source P{number}"
    HTML.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["pandoc", str(SOURCE), "-o", str(DOCX)], check=True)
    with tempfile.TemporaryDirectory() as temp:
        css = Path(temp) / "manuscript.css"
        css.write_text(CSS)
        subprocess.run(["pandoc", str(SOURCE), "--standalone", "--embed-resources",
                        "--css", str(css), "-o", str(HTML)], check=True)
    with zipfile.ZipFile(DOCX) as archive:
        assert archive.testzip() is None
        document = ET.fromstring(archive.read("word/document.xml"))
        ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        paragraphs = ["".join(p.itertext()) for p in document.findall(".//w:p", ns)]
        body = "\n".join(paragraphs)
        for heading in re.findall(r"^#{2,3} (.+)$", text, re.M):
            assert heading in body, f"Missing DOCX heading: {heading}"
        for marker in ("302,212", "5.519", "157.87", "Appendix C", "References",
                       "6.5 Operator-reported", "17 → 29 → 17", "physicalTest=false",
                       "CFGBVS-1", "5.008", "[P9]"):
            assert marker in body, f"Missing exported content: {marker}"
    with tempfile.TemporaryDirectory() as profile:
        subprocess.run([
            "chromium", "--headless", "--no-sandbox", "--disable-gpu",
            "--no-pdf-header-footer", f"--user-data-dir={profile}",
            f"--print-to-pdf={PDF}", HTML.as_uri(),
        ], check=True, timeout=60, capture_output=True)
    pdf_text = subprocess.check_output(["pdftotext", str(PDF), "-"], text=True)
    for marker in ("6.5 Operator-reported", "17 → 29 → 17", "physicalTest=false",
                   "CFGBVS-1", "Appendix C", "[P9]"):
        assert marker in pdf_text, f"Missing PDF content: {marker}"
    assert digest(ORIGINAL) == ORIGINAL_HASH, "Original was modified."
    print(f"PASS: original preserved; references, DOCX structure and PDF content checked\n{DOCX}\n{HTML}\n{PDF}")


if __name__ == "__main__":
    main()
