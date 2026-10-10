#!/usr/bin/env python3
"""Produce a self-contained review edition without changing the master ISA."""
import hashlib
import html
import json
from pathlib import Path
import re

import markdown

ROOT = Path(__file__).resolve().parents[1]
master = ROOT / "docs/instruction-set.md"
proposal = ROOT / "reports/isa-seven-items-review-proposals.md"
output = ROOT / "reports/isa-red-text-review.html"
original = master.read_bytes()
text = proposal.read_text()
digest = hashlib.sha256(original).hexdigest()
assert len(re.findall(r"^## [1-7]\.", text, re.M)) == 7
body = markdown.markdown(text, extensions=["tables", "fenced_code", "toc"])
page = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Church Machine ISA — red-text review edition</title>
<style>
:root{color-scheme:light}
body{margin:0;background:#f3f4f6;color:#171717;font:16px/1.65 system-ui,sans-serif}
main{max-width:1020px;margin:32px auto;background:white;padding:42px 52px}
h1,h2,h3{line-height:1.25}h1{font-size:30px}h2{margin-top:42px}
.label{font-size:12px;letter-spacing:.1em;font-weight:750}
.notice{border:1px solid #bbb;padding:18px;background:#fafafa}
.changes,.changes a,.changes code{color:#b00020}
.changes h2{border-top:1px solid #eccbd1;padding-top:24px}
table{border-collapse:collapse;width:100%;margin:20px 0;font-size:14px}
th,td{border:1px solid #ddd;padding:10px;text-align:left;vertical-align:top}
th{background:#faf4f5}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f8f8f8;
padding:16px;font:13px/1.6 ui-monospace,monospace}
code{font: .9em ui-monospace,monospace}
.hash{font-size:12px;overflow-wrap:anywhere}
summary{cursor:pointer;font-weight:700;padding:12px;border:1px solid #bbb}
.baseline{color:#171717}
@media(max-width:700px){main{margin:0;padding:22px}table{font-size:12px}}
@media print{body{background:white}main{margin:0;padding:0}h2,h3{break-after:avoid}
tr{break-inside:avoid}.changes{color:#b00020!important}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><main>
<div class="label">CHURCH MACHINE · ISA REVIEW · 2026-10-09</div>
<h1>Master ISA — proposed red-text amendments</h1>
<div class="notice"><strong>For review only. No normative document or implementation has changed.</strong>
<p>Red text opens with the Church-level architecture: header definitions,
Namespace metadata, address rules, member loading and I/O-definition LUMPs,
followed by seven architectural review items, including choices that
remain unresolved or require approval. Black text identifies the baseline and review status.
The complete, unchanged master is included below as an expandable verbatim copy.</p>
<p>This is an amendment-first review edition, not a line-by-line diff.
Proposals do not silently replace existing definitions.</p></div>
<p>Baseline: <code>docs/instruction-set.md</code></p>
<p class="hash">Baseline SHA-256: BASE_HASH</p>
<section class="changes">PROPOSALS</section>
<section class="baseline"><h2>Unchanged master ISA — full source text</h2>
<p>The original text is retained verbatim, including conflicting historical
passages awaiting reconciliation. It has not been edited to appear consistent
with the unapproved proposals.</p>
<details><summary>Open complete original master ISA</summary>
<pre>ORIGINAL</pre></details></section>
</main></body></html>"""
page = page.replace("BASE_HASH", digest).replace("PROPOSALS", body).replace(
    "ORIGINAL", html.escape(original.decode()))
output.write_text(page)
assert master.read_bytes() == original
(ROOT / "reports/isa-red-text-review-manifest.json").write_text(json.dumps({
    "status": "review-only-unapproved",
    "master": str(master.relative_to(ROOT)),
    "master_sha256": digest,
    "proposal_sha256": hashlib.sha256(proposal.read_bytes()).hexdigest(),
    "html_sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
    "numbered_review_items": 7,
    "master_unchanged": True,
}, indent=2) + "\n")
print(output.relative_to(ROOT))
