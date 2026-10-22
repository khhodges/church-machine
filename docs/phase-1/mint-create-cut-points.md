# CREATE DATA cut-point diagnostics

Run:

```sh
node simulator/mint_create_cut_points.js
node simulator/test_mint_create_cut_points.js
```

This is a diagnostic acceptance runner, not a green regression suite. Exit 1
means an observed failure, 2 means blocked checks without observed failures,
and 0 requires all checks to pass. Harness/source mismatches also throw and
exit nonzero. Output includes prerequisite fixture results followed by a JSON
report with source SHA-256, per-cut snapshots, checks and counts.
The second command checks the harness itself, including that known failures and
blocked cases remain visible. Its PASS does not make the acceptance report green.

## What executes

The existing disposable native fixture executes unchanged compiled Mint words.
Probe labels are assembled separately and compared byte-for-byte to the compiler
body; the only extra compiler word is its appended RETURN. No store is remapped,
no live image is loaded, and no recovery or architectural code is changed.

- A1–A3: stop immediately after each reservation/cursor store.
- B1: separate cuts after each of the first seven zero stores for the eight-word
  fixture allocation. B2 cuts after the eighth/final zero store.
- C1/C2: separate stops after W0, W1 and W2.
- C3: after W3, before read-back.
- C4: after the final successful read-back comparison/conditional branch.
- D1–D3: scratch write, result LOAD, and before return-time register clearing.
- N1: mutate/restore the destination after A3, then execute to publication.
- N2: execute version-510 retirement and inspect version 511, cursors and fault.
- N3: redirect to result validation with DR1 incomplete and assert no return.
  Separately run isolated native completion, NULL, permission, EXACT, type/B,
  slot and sequence rejection cases.

Every reached cut checks reservation/never-used state, cursors, completion and
non-return; zero-loop cuts also check the exact zeroed prefix and residual words.
Snapshots include Namespace words, seal validity, scratch row and CR1.

## Explicit limits

There is no authorized retained-history restart/setup implementation available
to these tests. Therefore a snapshot is **not** presented as a completed
power-loss/reset fixture. Recreating the fresh private trial would incorrectly
reset slot history. All restart-dependent cases remain BLOCKED.

Legacy simulator publication uses the native ascending addresses, but its LOAD
consults descending slots. D2 faults at that mismatch and D3 is unreachable in
this full-path fixture. These are BLOCKED, never patched into a success.
No private-containment proof is inferred from host-visible test snapshots.

The seal-only companion assertions at C2.W2 and C3 report FAIL: W2 integrity
already passes before all publication/read-back work finishes. That disproves
using the seal alone as a completion oracle; it does not establish that a real
consumer accessed a partial entry.

N1 reports the preserved sequence binding but remains BLOCKED for complete
acceptance: restored ABA is not detected. N2's PASS is native retirement only,
not persistence. N3's guard PASS results cover incomplete DR1 and individual
identity mutations in an explicitly pre-provisioned issuance fixture. They do
not prove that mutually consistent forged state or arbitrary control-flow
diversion cannot bypass publication. That stronger claim remains BLOCKED.

The current report is intentionally not an all-pass signoff. Full-core FPGA
replay and authorized restart behavior must supply the missing evidence,
without instruction translation or a new recovery policy.

Initial execution: **9 PASS, 2 FAIL, 21 BLOCKED**. The two FAILs are the
explicit seal-only publication checks; the PASS results are scoped native
retirement/result guards. Every reachable cut passed its pre-restart checks.
The runner exited 1 as intended, and the separate harness regression passed.
