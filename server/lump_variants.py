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


def digest(data):
    return hashlib.sha256(data).hexdigest()


def build_bundle(binary, source, source_hash, parse):
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
  out[profile] = embedSelfDefinition(input.words, input.api, input.source, tier);
}
process.stdout.write(JSON.stringify(out));
"""
    proc = subprocess.run(
        ["node", "-e", script], cwd=Path(__file__).resolve().parents[1],
        input=json.dumps({"words": words, "api": frame["api_definition"], "source": source}),
        capture_output=True, text=True, timeout=15, check=True)
    generated = json.loads(proc.stdout)
    profiles = {}
    for profile, array in generated.items():
        data = struct.pack(f">{len(array)}I", *array)
        decoded = parse(array)
        if not decoded or decoded["api_definition"] != frame["api_definition"]:
            raise ValueError("Variant API changed during packaging")
        cw, cc = (words[0] >> 10) & 8191, words[0] & 255
        if array[1:1 + cw] != words[1:1 + cw] or (cc and array[-cc:] != words[-cc:]):
            raise ValueError("Variant executable or C-List changed during packaging")
        profiles[profile] = {"sha256": digest(data), "bytes": len(data),
                             "data": base64.b64encode(data).decode()}
    # Preserve the submitted approved representation exactly, including compression.
    primary_profile = ("api", "compact", "full")[frame["tier"]]
    profiles[primary_profile] = {"sha256": digest(binary), "bytes": len(binary),
                                 "data": base64.b64encode(binary).decode()}
    bundle = {"schema": 1, "primary_sha256": digest(binary),
            "source_sha256": source_hash, "primary_profile": primary_profile,
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
    if digest(data) != item["sha256"] or len(data) != item["bytes"]:
        raise ValueError("Variant bytes fail their retained hash")
    return data, bundle


def summary(bundle):
    return {profile: {"sha256": item["sha256"], "bytes": item["bytes"],
                      "url": f'/api/lump-variants/{bundle["bundle_id"]}/{profile}'}
            for profile, item in bundle["profiles"].items()}
