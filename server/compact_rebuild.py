"""Read-only, uncached compact derivation checks against frozen compiler inputs."""
import copy
import hashlib
import json
from pathlib import Path
import struct
import subprocess


def compact_source(source, language):
    proc = subprocess.run(["node", "-e", """
const {stripComments} = require('./simulator/lump_builder');
const [source, language] = JSON.parse(require('fs').readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(stripComments(source, language)));
"""], cwd=Path(__file__).resolve().parents[1],
        input=json.dumps([source, language]), text=True, capture_output=True,
        check=True, timeout=15)
    return json.loads(proc.stdout)


def _hash(value):
    return hashlib.sha256(value).hexdigest()


def compiler_fingerprint():
    root = Path(__file__).resolve().parents[1]
    # Include transitive local compiler helpers, not just the worker entrypoint.
    paths = [root / "server/compile_worker.js", *sorted((root / "simulator").glob("*.js"))]
    return _hash(json.dumps({
        str(path.relative_to(root)): _hash(path.read_bytes()) for path in paths
    }, sort_keys=True).encode())


def freeze_context(payload):
    keys = ("language", "namespace_hint", "isa_profile", "portable_binding",
            "portableBinding", "clist_slots", "_resolved_call_api_authorities", "_ide_hierarchy")
    return {"compiler_sha256": compiler_fingerprint(),
            "inputs": copy.deepcopy({key: payload[key] for key in keys if key in payload})}


def verify_rebuild(source, compact, context, parse):
    from server.compile_api import _run_compile_uncached
    if not isinstance(context, dict) or context.get("compiler_sha256") != compiler_fingerprint():
        raise ValueError("Compact rebuild requires the original compiler; recompile full source before saving")
    inputs = context.get("inputs")
    if not isinstance(inputs, dict) or not inputs.get("language"):
        raise ValueError("Compact rebuild is missing frozen compiler inputs")
    results = []
    for label, text in (("full", source), ("compact", compact)):
        result = _run_compile_uncached(dict(copy.deepcopy(inputs), source=text, tier=0))
        if not result.get("ok"):
            raise ValueError(f"{label.capitalize()} source rebuild failed: {result.get('error', 'compile rejected')}")
        words = result["words"]
        frame = parse(words)
        if not frame:
            raise ValueError(f"{label.capitalize()} rebuild has no valid API")
        cw, cc = (words[0] >> 10) & 8191, words[0] & 255
        results.append({
            "executable": words[1:1 + cw],
            "clist": words[-cc:] if cc else [],
            # Dict equality ignores object-key order, but never method/row order,
            # return registers, parameter metadata, or exact dependency locks.
            "api": frame["api_definition"],
            "binary_sha256": _hash(struct.pack(f">{len(words)}I", *words)),
        })
    if context["compiler_sha256"] != compiler_fingerprint():
        raise ValueError("Compiler changed during compact rebuild; retry from full source")
    for key in ("executable", "clist", "api"):
        if results[0][key] != results[1][key]:
            raise ValueError(f"Compact source semantic mismatch: {key}; nothing was saved")
    return {
        "schema": 1, "compiler_sha256": context["compiler_sha256"],
        "inputs_sha256": _hash(json.dumps(inputs, sort_keys=True).encode()),
        "full_source_sha256": _hash(source.encode()),
        "compact_source_sha256": _hash(compact.encode()),
        "full_rebuild_binary_sha256": results[0]["binary_sha256"],
        "compact_rebuild_binary_sha256": results[1]["binary_sha256"],
        "semantic_sha256": _hash(json.dumps(
            {key: results[0][key] for key in ("executable", "clist", "api")},
            sort_keys=True).encode()),
    }
