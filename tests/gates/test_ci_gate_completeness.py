"""CI gate completeness guard (Task #1286).

Parses .replit and asserts that every required validation workflow:
  1. Exists as a named ``[[workflows.workflow]]`` block.
  2. Has ``isValidation = true`` in its ``[workflows.workflow.metadata]`` block.
  3. Is referenced by the ``Project`` parallel workflow so it runs
     automatically before every merge.

Adding a new mandatory CI check?  Add its name to REQUIRED_VALIDATIONS.
Removing one?  Remove it from the list (and justify the removal in the PR).
"""

import os
import re

ROOT   = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
REPLIT = os.path.join(ROOT, '.replit')

REQUIRED_VALIDATIONS = [
    "check-stale-cr7",
    "e2e-tests",
    "assembler-tests",
    "lump-consistency",
    "fault-recovery-tests",
    "lump-binary-tests",
    "selftest-lump-runs",
]


def _parse_replit():
    with open(REPLIT, encoding='utf-8') as f:
        text = f.read()
    return text


def _workflow_blocks(text):
    """Return a dict mapping workflow name -> raw block text."""
    pattern = re.compile(
        r'\[\[workflows\.workflow\]\]\s*\n(.*?)(?=\[\[workflows\.workflow\]\]|\Z)',
        re.DOTALL,
    )
    blocks = {}
    for m in pattern.finditer(text):
        block = m.group(1)
        name_m = re.search(r'^name\s*=\s*"([^"]+)"', block, re.MULTILINE)
        if name_m:
            blocks[name_m.group(1)] = block
    return blocks


def _project_task_names(text):
    """Return the set of workflow names referenced in the Project parallel workflow."""
    project_m = re.search(
        r'\[\[workflows\.workflow\]\]\s*\nname\s*=\s*"Project".*?(?=\[\[workflows\.workflow\]\]|\Z)',
        text,
        re.DOTALL,
    )
    if not project_m:
        return set()
    block = project_m.group(0)
    return set(re.findall(r'args\s*=\s*"([^"]+)"', block))


def test_required_validations_are_defined():
    """Every required validation has a [[workflows.workflow]] block in .replit."""
    text = _parse_replit()
    blocks = _workflow_blocks(text)
    missing = [name for name in REQUIRED_VALIDATIONS if name not in blocks]
    assert not missing, (
        f'Required CI validations missing from .replit workflow definitions: {missing}'
    )


def test_required_validations_have_is_validation_true():
    """Every required validation block contains isValidation = true."""
    text = _parse_replit()
    blocks = _workflow_blocks(text)
    not_flagged = []
    for name in REQUIRED_VALIDATIONS:
        block = blocks.get(name, '')
        if not re.search(r'isValidation\s*=\s*true', block):
            not_flagged.append(name)
    assert not not_flagged, (
        f'Required CI validations missing isValidation = true: {not_flagged}. '
        'Add [workflows.workflow.metadata] isValidation = true to each.'
    )


def test_required_validations_are_in_project_workflow():
    """Every required validation is referenced in the Project parallel workflow."""
    text = _parse_replit()
    project_tasks = _project_task_names(text)
    missing = [name for name in REQUIRED_VALIDATIONS if name not in project_tasks]
    assert not missing, (
        f'Required CI validations are not wired into the Project workflow: {missing}. '
        'Add [[workflows.workflow.tasks]] task = "workflow.run" / args = "<name>" '
        'under the Project workflow in .replit.'
    )
