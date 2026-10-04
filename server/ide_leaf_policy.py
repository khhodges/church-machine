"""Trusted, file-provisioned IDE hierarchy; the browser cannot configure ownership."""
import json
import os
import subprocess

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "ide-hierarchy.json")
_TOKENS = os.path.join(os.path.dirname(__file__), "..", "simulator", "capability_tokens.js")


def configuration():
    try:
        with open(CONFIG_PATH, encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as exc:
        raise ValueError(
            "IDE hierarchy configuration is unreadable. Correct server/ide-hierarchy.json; "
            "no leaf ownership was inferred."
        ) from exc


def validate(capabilities, config=None):
    """Use the same policy as the browser, with server-controlled input only."""
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