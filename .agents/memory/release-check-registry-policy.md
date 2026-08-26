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