---
name: Save diagnostic evidence
description: Privacy, proxy-origin, and evidence boundaries for browser diagnostics.
---

Use a shared allowlisted error-code vocabulary across browser and server diagnostics, with canonical safe descriptions rather than arbitrary exception text. Preserve occurrence time separately from ingestion time and distinguish client reports from authoritative commit evidence. Behind Replit's preview proxy, a browser-controlled `Sec-Fetch-Site: same-origin` value is stronger evidence than Flask's rewritten host/scheme comparison.

**Why:** Browser Error serialization previously produced empty objects; independent client/server sanitizers then discarded safe reason codes. Raw exception strings can contain source or credentials, so simply retaining the full message is unsafe. The preview proxy can rewrite host or scheme and make a relative same-origin report fail a direct Origin comparison.

**How to apply:** Test a real frontend-produced event through backend ingestion whenever either schema or origin gate changes, including a proxy-host mismatch with same-origin fetch metadata. Acknowledgements must identify exactly persisted event IDs. Missing diagnostics never prove that a save was rejected.