#!/usr/bin/env python3
"""Guard RETURN workflow wiring without executing (or recursively invoking) suites.

Run directly with python3, or through sync-guard-tests.
"""
from copy import deepcopy
from pathlib import Path
import re
import tomllib
import unittest

ROOT = Path(__file__).resolve().parents[1]
SUITE = "return-cr14-trace-tests"
COMMAND = f"bash scripts/run-all-tests.sh {SUITE}"
REQUIRED_TESTS = (
    "test_return_cr14_trace.js",
    "test_execution_control_flow.js",
    "test_task3529_control_flow_diagnostics.js",
    "test_control_flow_diagnostic_export.js",
    "test_boot_load_cr15_breakpoint.js",
    "test_paused_execution_boot_gate.js",
    "test_continuous_run.js",
    "test_eloadcall_flat_entry.js",
)


def check_wiring(config, runner):
    workflows = config["workflows"]["workflow"]
    matching = [w for w in workflows if w["name"] == SUITE]
    assert len(matching) == 1, "RETURN needs exactly one workflow"
    assert matching[0]["tasks"] == [
        {"task": "shell.exec", "args": COMMAND}
    ], "RETURN workflow must invoke only the isolated named-suite runner"

    # The registry must remain the direct, fail-fast leaf commands, not invoke
    # its own workflow/runner or append commands that suppress a failed test.
    entries = re.findall(
        rf'^register_suite "{SUITE}" \\\n\s*\'([^\']+)\'',
        runner, re.MULTILINE,
    )
    assert len(entries) == 1, "RETURN needs exactly one suite registration"
    commands = entries[0].split(" && ")
    assert all(re.fullmatch(r"node simulator/test_\w+\.js", c) for c in commands), (
        "RETURN suite must contain only direct fail-fast Node test commands"
    )
    assert len(commands) == len(set(commands)), "RETURN tests must not run twice"
    for filename in REQUIRED_TESTS:
        assert f"node simulator/{filename}" in commands, f"Missing regression: {filename}"

    # all-tests already runs this suite. Do not also launch the standalone
    # workflow from the same parent (Project previously launched it twice).
    for workflow in workflows:
        children = [t["args"] for t in workflow.get("tasks", [])
                    if t["task"] == "workflow.run"]
        assert children.count(SUITE) <= 1, "Duplicate RETURN workflow launch"
        assert not ("all-tests" in children and SUITE in children), (
            "Parent must not run RETURN both directly and through all-tests"
        )


class ReturnTraceWiringTests(unittest.TestCase):
    def setUp(self):
        self.config = tomllib.loads((ROOT / ".replit").read_text())
        self.runner = (ROOT / "scripts/run-all-tests.sh").read_text()

    def test_repository_wiring(self):
        check_wiring(self.config, self.runner)

    def test_rejects_shortcut_duplicate_and_recursive_workflow_commands(self):
        for tasks in (
            [{"task": "shell.exec", "args": "node simulator/test_return_cr14_trace.js"}],
            [{"task": "shell.exec", "args": COMMAND}] * 2,
            [{"task": "workflow.run", "args": SUITE}],
            [{"task": "workflow.run", "args": "all-tests"}],
        ):
            with self.subTest(tasks=tasks):
                config = deepcopy(self.config)
                workflow = next(w for w in config["workflows"]["workflow"]
                                if w["name"] == SUITE)
                workflow["tasks"] = tasks
                with self.assertRaises(AssertionError):
                    check_wiring(config, self.runner)

    def test_rejects_missing_duplicate_recursive_and_masked_suite_commands(self):
        original = " && ".join(f"node simulator/{name}" for name in REQUIRED_TESTS)
        self.assertIn(original, self.runner)
        for replacement in (
            "node simulator/test_return_cr14_trace.js",
            original + " && node simulator/test_return_cr14_trace.js",
            COMMAND,
            original + " || true",
        ):
            with self.subTest(replacement=replacement):
                with self.assertRaises(AssertionError):
                    check_wiring(self.config, self.runner.replace(original, replacement))

    def test_rejects_redundant_parent_launch(self):
        config = deepcopy(self.config)
        parent = next(w for w in config["workflows"]["workflow"] if w["name"] == "Project")
        parent["tasks"].append({"task": "workflow.run", "args": SUITE})
        with self.assertRaisesRegex(AssertionError, "both directly"):
            check_wiring(config, self.runner)


if __name__ == "__main__":
    unittest.main()
