---
name: Save diagnostic evidence
description: Privacy and evidence boundaries for SAVE LUMP instrumentation.
---

Use a shared allowlisted error-code vocabulary across browser and server diagnostics, with canonical safe descriptions rather than arbitrary exception text. Preserve occurrence time separately from ingestion time and distinguish client reports from authoritative commit evidence.

**Why:** Browser Error serialization previously produced empty objects; independent client/server sanitizers then discarded safe reason codes. Raw exception strings can contain source or credentials, so simply retaining the full message is unsafe.

**How to apply:** Test a real frontend-produced event through backend ingestion whenever either schema changes. Acknowledgements must identify exactly persisted event IDs. Missing diagnostics never prove that a save was rejected.