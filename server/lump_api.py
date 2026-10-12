"""Mechanical decoding of the one canonical JSON contract.

Use the same strict implementation as the compiler and browser. This does not
consult source, catalogs, sidecars or the host's leaf definitions.
"""
import json
from pathlib import Path
import subprocess


def reject_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate API JSON key: " + key)
        result[key] = value
    return result


def binding_view(api, words):
    if not isinstance(api.get("methods"), dict):
        return api
    cw = (words[0] >> 10) & 8191
    script = """
const fs = require('fs');
const {expand} = require('./simulator/lump-api-codec');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(expand(input.api, input.words)));
"""
    result = subprocess.run(
        ["node", "-e", script], cwd=Path(__file__).resolve().parents[1],
        input=json.dumps({"api": api, "words": words[:cw + 1]}),
        capture_output=True, text=True, timeout=10)
    if result.returncode:
        raise ValueError("Invalid canonical API: " + result.stderr[-1000:])
    return json.loads(result.stdout)
