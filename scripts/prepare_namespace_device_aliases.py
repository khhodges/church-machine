"""Prepare a non-executable alias addendum to an exact frozen Namespace review."""
import hashlib
import html
import json
from pathlib import Path
import argparse


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def prepare(source, output):
    source, output = Path(source), Path(output)
    staging = Path("generated-artifacts").resolve()
    if not output.resolve().is_relative_to(staging) or output.resolve() == staging:
        raise ValueError("Output must be a new directory under generated-artifacts")
    if output.exists():
        raise ValueError("Refusing to overwrite a frozen proposal")
    raw = (source / "candidate.json").read_bytes()
    parent = json.loads(raw)
    body = {key: value for key, value in parent.items() if key != "reviewId"}
    if digest(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()) != parent["reviewId"]:
        raise ValueError("Parent review digest mismatch")
    for name, expected in parent["inputs"].items():
        path = source / "inputs" / name
        if not path.resolve().is_relative_to((source / "inputs").resolve()):
            raise ValueError("Input escapes frozen review")
        if digest(path.read_bytes()) != expected:
            raise ValueError("Frozen input hash mismatch: " + name)
    aliases = []
    for alias, target in (("kjhh1.LED0", "LED_DEV"), ("kjhh1.UART_TX", "UART_DEV")):
        rows = [row for row in parent["proposal"]["descriptors"] if row["name"] == target]
        if len(rows) != 1:
            raise ValueError("Destination must be unique: " + target)
        aliases.append({"name": alias, "destination": rows[0]})
    record = {
        "status": "proposed-alias-addendum", "activationAllowed": False,
        "executionApprovalEligible": False, "parentReviewId": parent["reviewId"],
        "parentSha256": digest(raw), "aliases": aliases,
        "scope": "Only this exact proposed Namespace; not a global or compiler-side alias table.",
        "authority": "No rights, GTs, slots, generations or addresses are created or changed.",
        "blocker": "Namespace image serialization, linking validation and execution acceptance remain pending.",
    }
    record["proposalId"] = digest(json.dumps(record, sort_keys=True, separators=(",", ":")).encode())
    rendered = """<!doctype html><meta charset="utf-8"><title>Namespace device aliases</title>
<style>body{font:16px/1.6 system-ui;max-width:900px;margin:40px auto;padding:20px}
td,th{padding:10px;text-align:left;border-bottom:1px solid #ccc}code{overflow-wrap:anywhere}</style>
<h1>Proposed Namespace device aliases</h1>
<p><strong>Review only. Not installed, executable, or approved for activation.</strong></p>
<p>The exact target layout is preserved. These declarations do not change permissions,
slots, versions, physical addresses, resident artifacts or the live Namespace.</p>
<table><tr><th>API name</th><th>Destination</th><th>Target slot</th><th>Version</th></tr>"""
    for item in aliases:
        row = item["destination"]
        rendered += f'<tr><td>{html.escape(item["name"])}</td><td>{html.escape(row["name"])}</td><td>{row["slot"]}</td><td>{row["sequence"]}</td></tr>'
    rendered += f'</table><p>Bound to frozen target review <code>{record["parentReviewId"]}</code>.</p>'
    rendered += '<p>UART uses the proposed target slot and version, not its historical live slot 2. Slot 2 is the target entry Thread.</p>'
    rendered += f'<p>{html.escape(record["blocker"])}</p><p>Proposal <code>{record["proposalId"]}</code></p>'
    output.mkdir(parents=True, exist_ok=False)
    (output / "parent-candidate.json").write_bytes(raw)
    (output / "proposal.json").write_text(json.dumps(record, indent=2) + "\n")
    (output / "review.html").write_text(rendered)
    return record


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("output")
    args = parser.parse_args()
    print(json.dumps(prepare(args.source, args.output), indent=2))
