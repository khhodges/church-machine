# Shared IDE review

Two independent copies were saved through the existing protected Namespace
copy/save APIs, with binding explicitly disabled:

- **Cooperative Retry — USER B — Review**
- **Cooperative Retry — All Waiting — Review**

Use **Namespace Table** and select either name. Boot.Thread is SYSTEM.
Both have USER A's Thread, its code, a Lazy payload, and the diagnostic
receiver. Only USER B has the second USER Thread and code. Each Namespace
is one complete scenario, not half of an interacting two-image system.

Use **Open File Catalog** and search `cooperative_retry` for readable code:

| File suffix | Purpose |
|---|---|
| `system_user_b` | Poll delivery and dispatch B while A waits |
| `system_waiting` | Poll delivery and self-CHANGE while A waits |
| `user_a` | Blocking CALL, retry, then yield to SYSTEM |
| `user_b` | Increment progress, yield, repeat |
| `payload` | Return the diagnostic success result |

These are **source-backed review drafts**, not compiled/assigned LUMPs.
The existing Namespace row action opens an assigned LUMP only; it deliberately
does not fall back to standalone source. Until assignment is reviewed, use
Open File Catalog to read these files. All five are present in that API.

Do not build/run these as equivalent to the qualified diagnostic. Normal
compilation adds method tables/API metadata; the old fixed five-word transport
copy is not a general loader for those outputs. Thread entry/home provisioning,
transport binding and exact compiled bytes still need reconciliation after
review. The design schema also requires Boot.Thread generation zero, unlike
the historical fixture's guarded bootstrap generation.

Read-back verified both saved documents and their membership. The original
design fingerprint, live ns-state.json, LUMP manifest and boot-image.bin
hashes were unchanged. No binding, activation or hardware operation occurred.

An existing Namespace navigation test was attempted but stopped on a missing
`supportedBodyWords` dependency in its test harness. No application code was
changed in this work; that test is not reported as passing.
