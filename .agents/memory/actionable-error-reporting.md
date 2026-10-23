---
name: Actionable error reports
description: Project-wide requirements for errors shown to programmers in the IDE.
---

Every visible error must state what operation failed, preserve the server or validator’s real reason, say whether data changed when known, and provide a concrete next action. Never show a bare HTTP status or generic “failed” message.

**Why:** The programmer explicitly requires all error reports to be actionable; a saved-LUMP audit previously displayed only “HTTP 409” while hiding a precise bootstrap SELF mismatch.

**How to apply:** Parse structured error bodies defensively, avoid inventing semantics from status codes, include actual/expected values for identity failures, and give operation-specific retry, reload, rebuild, or re-approval guidance.

Thread faults should explain the specific failed execution prerequisite, not
only the generic BOUNDS category. Distinguish empty starting contexts from
invalid frames using fault-time evidence; never infer historical state from
the current Thread after reboot.

**Why:** The user confirmed the empty-Thread CHANGE diagnosis and requested
that understanding directly in the fault popup.

**How to apply:** State which Thread was rejected, why it could not be entered,
and what explicit initialization is needed, without silently initializing it.