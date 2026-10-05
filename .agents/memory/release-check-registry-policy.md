---
name: Release-check registry policy
description: Rules for keeping the aggregate release runner, workflow registry, and suite exemptions aligned.
---

The test-workflow sync configuration is part of the release gate and must be
present, parseable, and structurally valid. A release suite must either have a
matching workflow or be explicitly listed as script-only; validation workflows
are test suites unless they are actual infrastructure.

**Why:** A fallback configuration or an infrastructure exemption can silently
remove hardware regressions from the aggregate release command.

**How to apply:** When registering a suite, update its matching workflow or the
explicit script-only list in the same change. Keep missing, malformed, invalid,
and duplicate sync configuration as hard failures.

Updating a validation workflow can automatically enroll it in the parent
`all-tests` workflow, even when it was previously absent.

**Why:** The validation-command upsert adds a parent workflow dependency, not
just the requested shell command. That can accidentally make an expensive
release-only replay run during ordinary testing.

**How to apply:** Use the validation API for validation workflows (the ordinary
workflow API rejects them), inspect the resulting parent dependencies, and
keep release-only checks explicitly opt-in in both execution paths.

Classify a failing assertion by the requirement and authoritative release input
it protects, not by the suite's name or its red status alone.

**Why:** The user approved separating genuine FPGA safety requirements from
obsolete design expectations. Repository examples and newer builder formats
can disagree with the intended selected program without proving it defective.

**How to apply:** Preserve strict exit codes and unresolved safety checks.
Retire superseded expectations, not whole suites; distinguish source freshness,
test setup failures, observed execution faults, and actual-target compatibility.
Never change selected artifacts just to satisfy an obsolete example.