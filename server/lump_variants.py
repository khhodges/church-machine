"""Exact-revision source companions, committed with the primary LUMP.

Companions are not independently approved executable revisions. Build/test
continues to use the primary's exact approved bytes.
"""
import base64
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
from server.lump_file import pack_lump, unpack_lump


def _stored_profile(data):
    packed = pack_lump(data)
    return {"sha256": digest(data), "bytes": len(data), "encoding": "gzip",
            "stored_bytes": len(packed),
            "data": base64.b64encode(packed).decode()}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def build_bundle(binary, source, source_hash, parse, compile_context=None):
    if not isinstance(source, str) or digest(source.encode()) != source_hash:
        raise ValueError("Full source does not match the compiler-attested source")
    words = list(struct.unpack(f">{len(binary) // 4}I", binary))
    frame = parse(words)
    if not frame:
        raise ValueError("Three-variant save requires a valid embedded API")
    # Reuse the compiler's content encoder, not a second Python frame dialect.
    script = """
const fs = require('fs');
const {embedSelfDefinition} = require('./simulator/lump_builder');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const out = {};
for (const [profile, tier] of [['api',0],['compact',1],['full',2]]) {
  out[profile] = embedSelfDefinition(input.words, input.api, input.source, tier, input.language);
}
process.stdout.write(JSON.stringify(out));
"""
    proc = subprocess.run(
        ["node", "-e", script], cwd=Path(__file__).resolve().parents[1],
        input=json.dumps({"words": words, "api": frame.get("canonical_api", frame["api_definition"]), "source": source,
                          "language": (compile_context or {}).get("source_language") or
                          (compile_context or {}).get("inputs", {}).get("language")}),
        capture_output=True, text=True, timeout=15, check=True)
    generated = json.loads(proc.stdout)
    from server.compact_rebuild import verify_rebuild
    compact = parse(generated["compact"])["source"]
    if frame["tier"] == 1 and frame["source"] != compact:
        raise ValueError("Primary compact source is not the canonical derivation; recompile full source")
    verification = verify_rebuild(source, compact, compile_context, parse)
    profiles = {}
    for profile, array in generated.items():
        data = struct.pack(f">{len(array)}I", *array)
        decoded = parse(array)
        if not decoded or decoded["api_definition"] != frame["api_definition"]:
            raise ValueError("Variant API changed during packaging")
        cw, cc = (words[0] >> 10) & 8191, words[0] & 255
        if array[1:1 + cw] != words[1:1 + cw] or (cc and array[-cc:] != words[-cc:]):
            raise ValueError("Variant executable or C-List changed during packaging")
        profiles[profile] = _stored_profile(data)
    # Preserve the submitted approved representation exactly, including compression.
    primary_profile = ("api", "compact", "full")[frame["tier"]]
    profiles[primary_profile] = _stored_profile(binary)
    bundle = {"schema": 3, "primary_sha256": digest(binary),
            "source_sha256": source_hash, "primary_profile": primary_profile,
            "compact_rebuild": verification,
            "profiles": profiles}
    bundle["bundle_id"] = digest(json.dumps(bundle, sort_keys=True).encode())
    return bundle


def read_variant(directory, primary_hash, profile):
    if not re.fullmatch(r"[0-9a-f]{64}", primary_hash or "") or profile not in ("api", "compact", "full"):
        raise ValueError("Invalid variant identity")
    path = Path(directory) / (primary_hash + ".variants.json")
    bundle = json.loads(path.read_text())
    unsigned = {key: value for key, value in bundle.items() if key != "bundle_id"}
    if bundle["bundle_id"] != primary_hash or digest(json.dumps(unsigned, sort_keys=True).encode()) != primary_hash:
        raise ValueError("Variant bundle identity mismatch")
    item = bundle["profiles"][profile]
    data = base64.b64decode(item["data"], validate=True)
    if item.get("encoding") == "gzip":
        if len(data) != item.get("stored_bytes") or data[:2] != b"\x1f\x8b":
            raise ValueError("Variant stored bytes do not match their encoding")
        data = unpack_lump(data)
    elif item.get("encoding") not in (None, "raw"):
        raise ValueError("Unsupported variant encoding")
    if digest(data) != item["sha256"] or len(data) != item["bytes"]:
        raise ValueError("Variant bytes fail their retained hash")
    return data, bundle


def summary(bundle):
    return {profile: {"sha256": item["sha256"], "bytes": item["bytes"],
                      "file_bytes": (item["stored_bytes"] if item.get("encoding") == "gzip"
                                     else len(pack_lump(read_profile_bytes(item)))),
                      "encoding": "gzip",
                      "url": f'/api/lump-variants/{bundle["bundle_id"]}/{profile}?compressed=1'}
            for profile, item in bundle["profiles"].items()}


def read_profile_bytes(item):
    data = base64.b64decode(item["data"], validate=True)
    if item.get("encoding") == "gzip":
        return unpack_lump(data)
    if item.get("encoding") not in (None, "raw"):
        raise ValueError("Unsupported variant encoding")
    return data
