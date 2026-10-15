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
