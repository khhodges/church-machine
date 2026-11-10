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

These now have **real compiler-produced, saved and assigned revision-1 LUMPs**.
Their canonical names are `ide.CooperativePayload`, `ide.CooperativeUserA`,
`ide.CooperativeUserB`, `ide.CooperativeSystemWaiting` and
`ide.CooperativeSystemUserB`. The earlier `Cooperative.*` spelling denoted a
foreign ownership branch; it was corrected locally without changing hierarchy
settings. USER Thread and Receiver names also use local `ide.Cooperative…`
identities. The Namespace row action can now inspect its exact assigned LUMP.
All five standalone sources remain available in Open File Catalog.

Read-back through the actual Memory Glass inspection service confirms artifact
identity, revision, token, binary size, code size and C-list count for every
LUMP. Resident layouts have word locations and extents; the Lazy payload has
no resident address by design. Both inspection responses have no layout warnings.
The two SYSTEM LUMPs contain 28/27 code words and 5/4 C-list entries respectively;
USER A has 6/3, USER B 5/2, and Payload 3/1.

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
