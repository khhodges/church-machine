#!/usr/bin/env python3
"""Guard hardware-fault wiring without executing or recursively invoking suites.

Run directly with python3, or through sync-guard-tests. Launcher probes use
synthetic leaf commands and private fixture files, never the live IDE state.
"""
from copy import deepcopy
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import tomllib
import unittest

ROOT = Path(__file__).resolve().parents[1]
SUITE = "wukong-hw-fault-tests"
COMMAND = f"bash scripts/run-all-tests.sh {SUITE}"
REQUIRED_TESTS = ("test_wukong_hw_fault.js", "test_wukong_freeze_incidents.js")
LEAF_COMMAND = " && ".join(f"node simulator/{name}" for name in REQUIRED_TESTS)


def check_wiring(config, runner):
    workflows = config["workflows"]["workflow"]
    matching = [w for w in workflows if w["name"] == SUITE]
    assert len(matching) == 1, "Hardware faults need exactly one workflow"
    assert matching[0]["tasks"] == [
        {"task": "shell.exec", "args": COMMAND}
    ], "Hardware-fault workflow must invoke only the isolated named-suite runner"

    entries = re.findall(
        rf'^register_suite "{SUITE}" \\\n\s*\'([^\']+)\'',
        runner, re.MULTILINE,
    )
    assert len(entries) == 1, "Hardware faults need exactly one suite registration"
    commands = entries[0].split(" && ")
    assert all(re.fullmatch(r"node simulator/test_\w+\.js", c) for c in commands), (
        "Hardware-fault suite must contain only direct fail-fast Node test commands"
    )
    assert len(commands) == len(set(commands)), "Hardware-fault tests must not run twice"
    for filename in REQUIRED_TESTS:
        assert f"node simulator/{filename}" in commands, f"Missing regression: {filename}"

    for workflow in workflows:
        children = [t["args"] for t in workflow.get("tasks", [])
                    if t["task"] == "workflow.run"]
        assert children.count(SUITE) <= 1, "Duplicate hardware-fault workflow launch"
        assert not ("all-tests" in children and SUITE in children), (
            "Parent must not run hardware faults both directly and through all-tests"
        )


class HardwareFaultWiringTests(unittest.TestCase):
    def setUp(self):
        self.config = tomllib.loads((ROOT / ".replit").read_text())
        self.runner = (ROOT / "scripts/run-all-tests.sh").read_text()

    def test_repository_wiring(self):
        check_wiring(self.config, self.runner)

    def test_rejects_shortcut_duplicate_recursive_and_masked_workflow_commands(self):
        for tasks in (
            [{"task": "shell.exec", "args": f"node simulator/{REQUIRED_TESTS[0]}"}],
            [{"task": "shell.exec", "args": COMMAND}] * 2,
            [{"task": "workflow.run", "args": SUITE}],
            [{"task": "workflow.run", "args": "all-tests"}],
            [{"task": "shell.exec", "args": COMMAND + " || true"}],
        ):
            with self.subTest(tasks=tasks):
                config = deepcopy(self.config)
                workflow = next(w for w in config["workflows"]["workflow"]
                                if w["name"] == SUITE)
                workflow["tasks"] = tasks
                with self.assertRaises(AssertionError):
                    check_wiring(config, self.runner)

    def test_rejects_missing_duplicate_recursive_and_masked_suite_commands(self):
        self.assertIn(LEAF_COMMAND, self.runner)
        for replacement in (
            *(f"node simulator/{name}" for name in REQUIRED_TESTS),
            LEAF_COMMAND + f" && node simulator/{REQUIRED_TESTS[0]}",
            COMMAND,
            LEAF_COMMAND + " || true",
        ):
            with self.subTest(replacement=replacement):
                with self.assertRaises(AssertionError):
                    check_wiring(self.config, self.runner.replace(LEAF_COMMAND, replacement))

    def test_rejects_missing_and_duplicate_registrations(self):
        for count in (0, 2):
            with self.subTest(count=count):
                config = deepcopy(self.config)
                workflows = config["workflows"]["workflow"]
                workflow = next(w for w in workflows if w["name"] == SUITE)
                workflows.remove(workflow)
                workflows.extend([deepcopy(workflow) for _ in range(count)])
                with self.assertRaises(AssertionError):
                    check_wiring(config, self.runner)
                entry = f'register_suite "{SUITE}" \\\n    \'{LEAF_COMMAND}\''
                self.assertIn(entry, self.runner)
                with self.assertRaises(AssertionError):
                    check_wiring(self.config, self.runner.replace(entry, (entry + "\n") * count))

    def test_rejects_redundant_parent_launches(self):
        for children in (["all-tests", SUITE], [SUITE, SUITE]):
            with self.subTest(children=children):
                config = deepcopy(self.config)
                config["workflows"]["workflow"].append({
                    "name": "Synthetic parent",
                    "tasks": [{"task": "workflow.run", "args": name} for name in children],
                })
                with self.assertRaises(AssertionError):
                    check_wiring(config, self.runner)

    def test_leaf_failures_preserve_exit_codes_and_private_state(self):
        # Exercise the existing wrapper, not a second copy of its implementation.
        # A shell function stands in for Node so neither real suite is launched.
        for first, second in ((0, 0), (23, 0), (0, 29)):
            with self.subTest(first=first, second=second), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                (root / "scripts").mkdir()
                (root / "server/lumps").mkdir(parents=True)
                launcher = root / "scripts/run_test_suite_isolated.sh"
                shutil.copyfile(ROOT / "scripts/run_test_suite_isolated.sh", launcher)
                live_lump = root / "server/lumps/sentinel.lump"
                live_boot = root / "server/boot-config.json"
                live_lump.write_bytes(b"original lump")
                live_boot.write_bytes(b'{"sentinel":true}\n')
                sandbox = root / "private"
                probe = f'''
node() {{
    test "$CHURCH_TEST_LUMPS_DIR" = "$PROBE_PRIVATE/lumps" || return 91
    test "$CHURCH_TEST_BOOT_CONFIG_PATH" = "$PROBE_PRIVATE/boot-config.json" || return 92
    echo "$1" >> "$PROBE_PRIVATE/calls"
    printf changed > "$CHURCH_TEST_LUMPS_DIR/sentinel.lump"
    printf changed > "$CHURCH_TEST_BOOT_CONFIG_PATH"
    case "$1" in
        simulator/{REQUIRED_TESTS[0]}) return {first} ;;
        simulator/{REQUIRED_TESTS[1]}) return {second} ;;
        *) return 93 ;;
    esac
}}
{LEAF_COMMAND}
'''
                result = subprocess.run(
                    ["bash", str(launcher), str(sandbox), SUITE, probe],
                    env={**os.environ, "PROBE_PRIVATE": str(sandbox)},
                    capture_output=True, text=True, timeout=15,
                )
                self.assertEqual(result.returncode, first or second, result.stdout + result.stderr)
                expected = REQUIRED_TESTS[:1] if first else REQUIRED_TESTS
                self.assertEqual((sandbox / "calls").read_text().splitlines(),
                                 [f"simulator/{name}" for name in expected])
                self.assertEqual(live_lump.read_bytes(), b"original lump")
                self.assertEqual(live_boot.read_bytes(), b'{"sentinel":true}\n')
                self.assertEqual((sandbox / "lumps/sentinel.lump").read_bytes(), b"changed")
                self.assertEqual((sandbox / "boot-config.json").read_bytes(), b"changed")


if __name__ == "__main__":
    unittest.main()
