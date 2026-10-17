---
name: RTL completion validation budget
description: Long method-dispatch release checks may outlive completion validation supervision.
---
Do not treat a completion validator's exhausted waiting budget as an RTL
assertion failure or a successful release check.

**Why:** Completion validation launched two long method-dispatch release
matrices concurrently, then stopped waiting before either produced its final
evidence report. Their logs contained only startup/progress output; the
independently completed instruction comparison remained valid evidence for
its own narrower scope.

**How to apply:** Inspect the named checks' logs, final evidence and remaining
processes. Report unfinished release checks separately from completed focused
comparisons. Do not regenerate images or weaken assertions to work around the
supervision limit; any completion-validation bypass needs an explicit audited
reason rather than a claim that the release checks passed.

Keep full hardware replays out of automatic task-completion validation. Use
one explicit release run for the complete replay and bundle verification;
retain gate/provenance regression tests in automatic validation.

**Why:** The user requested avoiding repeated replays and a longer waiting
window after multiple completion attempts exhausted supervision while hardware
cases were still passing. The exposed validation API has no timeout setting;
an explicit release run can use the release runner's own long deadline instead.

**How to apply:** Do not re-enroll the release replay as an automatic validation
command. Run the release group explicitly when release evidence is required;
ordinary task validation is not evidence that a full hardware replay passed.

For the Alice/Mallory tuple regression, the user authorized deferring unfinished
release checks to FPGA qualification if the local timeout cannot be resolved.

**Why:** The simulator deliverable has independent focused evidence; waiting
for unrelated long release matrices must not be confused with validating it.

**How to apply:** Keep the deferral narrow and explicit. Preserve the release
checks as outstanding hardware-qualification prerequisites, not passes or
permanently disabled checks. This is not blanket permission to bypass validation
on other work.
