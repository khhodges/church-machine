#!/usr/bin/env python3
"""Recover exact selected sources and compile inert candidates; never publish."""
import hashlib
import json
import re
from pathlib import Path
import struct
import sys
import tempfile
import zlib

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server.compile_api import run_compile


# Explicitly approved candidate identity mapping. No changes to display names,
# slots or immutable selected inputs. Aliases are recovered from source roles.
IDENTITIES = {name: "ide." + name for name in (
    "SelfTest", "WukongCallHome", "CapabilityTest", "LED_DEV", "UART_DEV",
    "BTN_DEV", "TIMER_DEV", "M_BIT_DEV", "Boot.Thread", "Boot.NS",
    "Thread.2", "Thread.3", "nstab", "pkverify")}
IDENTITIES.update(LED0="ide.LED_DEV", UART_TX="ide.UART_DEV")


def qualify_source(source, name):
    """Change identifier tokens only, preserving comments and instruction flow."""
    canonical = IDENTITIES.get(name, name)
    lines = []
    for line in source.splitlines(keepends=True):
        code, marker, comment = line.partition(";")
        code = re.sub(r"[A-Za-z_][A-Za-z_0-9.]*",
                      lambda m: IDENTITIES.get(m[0], m[0]), code)
        # The compiler also reads explicit identity annotations from comments.
        if marker:
            comment = re.sub(r"(@abstraction\s+|Abstraction:\s*)([A-Za-z_][\w.]*)",
                             lambda m: m[1] + IDENTITIES.get(m[2], m[2]), comment)
        lines.append(code + marker + comment)
    result = "".join(lines)
    # Selected SelfTest embeds a method body but omits its outer declaration.
    # Restore only the approved identity and compiler-owned SELF declaration;
    # the method instructions remain unchanged.
    if name == "SelfTest" and re.search(r"(?m)^\s*method\s+", result) and not re.search(
            r"(?m)^\s*abstraction\s+", result):
        result = f"abstraction {canonical} {{\ncapabilities {{ SELF E }}\n" + result + "\n}\n"
    if not re.search(r"(?m)^\s*abstraction\s+|@abstraction|Abstraction:", result):
        result = f"; @abstraction {canonical}\n" + result
    return result


def recover(raw, expected_hash):
    if hashlib.sha256(raw).hexdigest() != expected_hash:
        raise ValueError("Selected binary hash mismatch")
    if len(raw) < 4 or len(raw) % 4:
        raise ValueError("Invalid word framing")
    words = struct.unpack(f">{len(raw) // 4}I", raw)
    header = words[0]
    size = 1 << (((header >> 23) & 15) + 6)
    cw, cc = (header >> 10) & 8191, header & 255
    if header >> 27 != 31 or size != len(words) or cw + 2 >= size - cc:
        raise ValueError("Invalid source-frame geometry")
    frame = words[cw + 1]
    flags, length = (frame >> 16) & 255, frame & 65535
    if frame >> 24 != 0xAB or flags not in (1, 3, 5, 7) or not length:
        raise ValueError("No supported embedded source")
    start = (cw + 2) * 4
    source_at = cw + 2 + (length + 3) // 4
    if source_at >= size - cc:
        raise ValueError("API frame overlaps C-list")
    api = json.loads(raw[start:start + length].decode("utf-8"))
    if not isinstance(api, dict):
        raise ValueError("Embedded API must be an object")
    source_length = words[source_at]
    start = (source_at + 1) * 4
    if start + source_length > (size - cc) * 4:
        raise ValueError("Source frame overlaps C-list")
    source = raw[start:start + source_length]
    if flags & 4:
        source = zlib.decompress(source, wbits=-15)
    return source.decode("utf-8"), api


def prepare():
    profile_path = ROOT / "tests/fixtures/phase1_namespace_target.json"
    profile_raw = profile_path.read_bytes()
    profile = json.loads(profile_raw)
    output_root = ROOT / "generated-artifacts"
    output_root.mkdir(exist_ok=True)
    output = Path(tempfile.mkdtemp(prefix="phase1-candidates-", dir=output_root))
    report = {
        "profileSha256": hashlib.sha256(profile_raw).hexdigest(),
        "installed": False, "approved": False,
        "note": "Compiler candidates only; not signed admission, linking or runtime acceptance.",
        "entries": [],
    }
    for row in profile["rows"]:
        if row["kind"] != "lump":
            continue
        entry = {"slot": row["slot"], "name": row["name"]}
        report["entries"].append(entry)
        selected = row.get("selection")
        if not selected:
            entry.update(status="blocked", reason="No exact selected artifact; no substitution made.")
            continue
        try:
            filename = selected["filename"]
            if Path(filename).name != filename:
                raise ValueError("Selection is not a local filename")
            path = ROOT / "server/lumps" / filename
            if path.is_symlink():
                raise ValueError("Selected artifact must not be a symbolic link")
            raw = path.read_bytes()
            source, api = recover(raw, selected["binaryHash"])
            entry.update(selectedFilename=filename, selectedSha256=selected["binaryHash"],
                         sourceSha256=hashlib.sha256(source.encode()).hexdigest())
            source_path = output / f"slot-{row['slot']}.source"
            source_path.write_text(source)
            source = qualify_source(source, row["name"])
            (output / f"slot-{row['slot']}.candidate.source").write_text(source)
            entry["canonicalName"] = IDENTITIES.get(row["name"], row["name"])
            entry["candidateSourceSha256"] = hashlib.sha256(source.encode()).hexdigest()
            language = api.get("language") or "assembly"
            compiled = run_compile({"source": source, "language": language, "tier": 2})
            if not compiled.get("ok"):
                entry.update(status="compile-blocked", reason=compiled.get("error"),
                             errors=compiled.get("errors"))
            else:
                candidate_path = output / f"slot-{row['slot']}.candidate.json"
                candidate_path.write_text(json.dumps(compiled, indent=2))
                entry.update(status="compiled-unapproved", candidate=candidate_path.name,
                             warnings=compiled.get("warnings", []))
            if path.read_bytes() != raw:
                raise ValueError("Selected input changed during compilation; discard candidate")
        except (ValueError, OSError, KeyError, zlib.error) as exc:
            entry.update(status="blocked", reason=str(exc))
    if profile_path.read_bytes() != profile_raw:
        raise RuntimeError("Profile changed during preparation; discard candidates")
    (output / "report.json").write_text(json.dumps(report, indent=2))
    print(output.relative_to(ROOT))
    for entry in report["entries"]:
        print(f"NS[{entry['slot']}] {entry['name']}: {entry['status']}"
              + (f" — {entry['reason']}" if entry.get("reason") else ""))
    return report


if __name__ == "__main__":
    prepare()
