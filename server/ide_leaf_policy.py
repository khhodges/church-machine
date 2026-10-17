"""Trusted IDE hierarchy, explicitly configured through Namespace Design."""
import json
import os
import subprocess
import copy
import fcntl
import tempfile


CONFIG_PATH = os.path.join(os.path.dirname(__file__), "ide-hierarchy.json")
_TOKENS = os.path.join(os.path.dirname(__file__), "..", "simulator", "capability_tokens.js")
_TEST_CONFIG_KEY = "CHURCH_TEST_IDE_HIERARCHY_PATH"


def configuration_path():
    """Resolve on every access, including when this module was imported earlier.

    Isolated callers without a private hierarchy fail closed, never falling back
    to project ownership. Non-test callers retain the normal configuration.
    """
    raw = os.environ.get(_TEST_CONFIG_KEY, "").strip()
    isolated = any(os.environ.get(key, "").strip().lower() in {"1", "true", "yes", "on"}
                   for key in ("CHURCH_TEST_ISOLATED_MODE", "CHURCH_TEST_ISOLATED"))
    if not raw:
        if isolated:
            raise ValueError(f"Isolated IDE hierarchy access requires {_TEST_CONFIG_KEY}; "
                             "copy the configuration to a private test file first.")
        return CONFIG_PATH
    candidate = os.path.realpath(os.path.abspath(raw))
    server_dir = os.path.realpath(os.path.dirname(__file__))
    if os.path.commonpath((candidate, server_dir)) == server_dir:
        raise ValueError(f"{_TEST_CONFIG_KEY} points to project state; refusing test access.")
    # realpath covers symlinks; samefile also catches hard-linked live files.
    live = os.path.join(server_dir, "ide-hierarchy.json")
    if os.path.exists(candidate) and os.path.exists(live) and os.path.samefile(candidate, live):
        raise ValueError(f"{_TEST_CONFIG_KEY} aliases the real configuration; refusing test access.")
    if not os.path.isfile(candidate):
        raise ValueError(f"{_TEST_CONFIG_KEY} must name an existing private configuration file.")
    lock_path = candidate + ".lock"
    if os.path.islink(lock_path) or (os.path.exists(lock_path) and
                                    os.stat(lock_path).st_nlink > 1):
        raise ValueError(f"{_TEST_CONFIG_KEY} requires a private lock file.")
    return candidate


def save_node(payload):
    """CAS and atomic publication; only exact locally owned aliases move."""
    if not isinstance(payload, dict) or set(payload) != {"node", "expected", "confirmed"}:
        raise ValueError("Expected node, expected configuration and explicit confirmation.")
    if payload["confirmed"] is not True:
        raise ValueError("Confirm the IDE node change before saving.")
    config_path = configuration_path()
    with open(config_path + ".lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        previous = configuration()
        if previous != payload["expected"]:
            raise ValueError("IDE configuration changed in another session. Reload the setting and review again.")
        if previous is not None and (not isinstance(previous, dict) or
                not isinstance(previous.get("aliases", {}), dict)):
            raise ValueError("Existing configuration is malformed. Correct it before changing the IDE node.")
        candidate = copy.deepcopy(previous) if previous is not None else {"aliases": {}, "definitions": {}}
        old = candidate.get("node")
        node = payload["node"]
        candidate["node"] = node
        if isinstance(node, str):
            for alias, target in candidate.get("aliases", {}).items():
                if isinstance(target, str) and target.rpartition(".")[0] == old:
                    candidate["aliases"][alias] = node + "." + target.rpartition(".")[2]
        script = """const p=require(process.argv[1]);let s='';
process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{
console.log(JSON.stringify(p.validateHierarchyConfiguration(JSON.parse(s))));});"""
        result = subprocess.run(["node", "-e", script, _TOKENS],
                                input=json.dumps(candidate), capture_output=True,
                                text=True, timeout=10, check=True)
        verdict = json.loads(result.stdout)
        if not verdict["ok"]:
            raise ValueError(verdict["error"])
        filename = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8",
                                             dir=os.path.dirname(config_path), delete=False) as handle:
                filename = handle.name
                json.dump(candidate, handle, indent=2)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(filename, config_path)
            filename = None
        finally:
            if filename:
                os.unlink(filename)
        return candidate

def configuration():
    """Read the raw endpoint payload; semantic checks belong to the shared JS policy."""
    config_path = configuration_path()
    try:
        with open(config_path, encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as exc:
        raise ValueError(
            f"IDE hierarchy configuration is unreadable. Correct {config_path}; "
            "no leaf ownership was inferred."
        ) from exc


def validate(capabilities, config=None):
    """Use shared whole-configuration validation for leaf authoring.

    SELF/NULL and empty declarations do not claim IDE-owned leaves and retain
    their configuration-independent behavior. Input comes from the server file,
    never from a browser ownership claim.
    """
    if not isinstance(capabilities, list):
        raise ValueError("Capability declarations must be an array.")
    if config is None:
        config = configuration()
    script = """
const p = require(process.argv[1]);
let input = '';
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  const {caps, config} = JSON.parse(input);
  process.stdout.write(JSON.stringify(caps.map(c => p.checkLeafOwnership(c, config))));
});
"""
    result = subprocess.run(
        ["node", "-e", script, _TOKENS],
        input=json.dumps({"caps": capabilities, "config": config}),
        capture_output=True, text=True, timeout=10, check=True,
    )
    decisions = json.loads(result.stdout)
    errors = [item["error"] for item in decisions if item.get("error")]
    if errors:
        raise ValueError("; ".join(errors))
    return decisions