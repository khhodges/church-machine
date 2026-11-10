# Combined runtime: exact-image approval gate

Status: **corrected combined candidate passed local qualification, 10 November 2026**.
No vendor tool or physical operation has run. The existing starter image
allowlist remains unchanged in the historical/default starter. The separate
`prepare_combined.py` derivation pins these approved identities only in its
fresh isolated source copy.

## Exact review inputs

Reproduce into a fresh ignored directory:

```sh
python docs/phase-2/cooperative-retry/prepare_combined_review.py \
  --output generated-artifacts/combined-review-NEW
```

Both images are 65,536 bytes, little-endian words:

| Image | SHA-256 |
| --- | --- |
| USER B | `1d2417387397d64640ab976322232158db60de8b61483fd52a27b010eac302eb` |
| All Waiting | `bfd60b47f5346768a81a53276876634f8b87b52d05f4ffa9a986a232d6ffc3d7` |

Exact localized received LUMPs, also little-endian:

| Revision | Allocation | Slot | SHA-256 |
| --- | --- | --- | --- |
| Old | 64 words at byte `0x9000` | 40, generation 0 | `9b12981b124ed17e671bdaf56263b81a5e60eacdc95dd3e58df15589d6fb0d7b` |
| New | 256 words at byte `0x9200` | 42, generation 0 | `01820b0618859d7151a56f8f6f4b9a8e0d77ee729b82545ab22806d4b241aca9` |

These new cooperative bodies reuse the merged adoption compiler and localization
path. They are not the earlier two-instruction standalone preflight bodies.
The old method yields to SYSTEM before RETURN; both methods use native
`RETURNAL 2048` to retain their explicitly granted CR11 SYSTEM Thread capability.
Bare `RETURN 2048` in the structured language is a returned value, not a mask.
No instruction-word translation is applied.

## Approved layout and grants

Keep the existing 64 KiB RAM geometry. Existing SYSTEM/USER Thread allocations
remain at `0x1000`, `0x3000`, `0x6000`. Add a 1 KiB new-caller Thread at `0x8000`,
and place the 1 KiB compiled SYSTEM program at `0x8400`.
Old/new revisions and their two 64-word callers occupy `0x9000`–`0x9700`.
Staging is the separate 1 KiB interval `0xa000`–`0xa400`.

SYSTEM's initial private homes grant:

- selection of old-caller, new-caller, USER B and SYSTEM Threads;
- W access to each revision's separately bounded body allocation;
- R access to the receiver data/status/selector/transaction registers;
- W access to the receiver commit register;
- W access to **only the four words of the new revision's E descriptor**.

This is not a general Namespace-write grant. Transport owns only staging
writes and cannot publish executable bodies or descriptors.
There is no new raw SYSTEM-control capability or watchdog control.

The old lazy target must already have its approved descriptor so CALL can take
the existing non-resident handoff. Its body remains `cw=0` until SYSTEM copies
the full validated body and writes its executable header last. This reuses the
existing lazy publication rule, not a new descriptor-valid bit.

The new E descriptor starts zero. SYSTEM copies its full body through the
separate W grant and publishes descriptor words in order **0, 1, 3, 2**:
integrity is last. The normal gate must reject every intermediate tuple.
Existing old authority is never retargeted.

## Current evidence and honest limits

- Merged simulator adoption suite passed.
- Reproducible input/geometry checks passed in both size orders.
- Two unchanged standalone compiled bodies passed retained-core CALL/RETURN.
- Ten staging receiver tests passed: actual RAM SHA, both sizes, complete
  consumption, tamper, truncation/timeout, UART error, epoch change, bounds,
  contention and invalid protected manifest checks.
- The authored application preflight produced **17, 29, 17** through real core
  instructions. SYSTEM copied/published the new body while the old body and
  suspended Thread memory stayed unchanged. No host PC/register/continuation
  writes were used after boot.
- The combined top elaborated with both protected revision records; historical
  default preparation and partial-image controls passed neighboring checks.

The application preflight uses a read-only test peripheral instead of UART/SHA.
The receiver tests do not execute the application. These component passes alone
do not establish the three flows together.
Both size orders passed the authored-application preflight. Only the growing
64→256 candidate is pinned for the combined UART sequence; the shrinking
preflight does not authorize a third image or a second configuration claim.
The continuous UART-pin sequence subsequently passed in **2109.71 seconds**,
and the offline evidence checker passed. One elaboration admitted USER B,
rejected altered LUMP content, delivered the old body while USER B progressed
(107 progress observations), adopted the 256-word revision with results
**17, 29, 17**, then admitted All Waiting in epoch 2. All Waiting renewed the
watchdog without USER B progress and rejected an old-epoch LUMP command.

All three records have source/configuration identity
`13d8f906901f2f6d49eba44a614271e834484c402aa4b70f0469f5f8a6e84439`.
Retained local outputs are in
`generated-artifacts/combined-approved-locked-20261110/`:
`combined-source-manifest.json`, `combined-evidence.json`, and `combined-top.xml`.
They can be regenerated using the commands below; generated output is excluded
from Git. This is local RTL evidence, not synthesis/timing or physical acceptance.
Results and progress are observed through RTL signals, not a new board-side
UART result-reporting protocol.

Completion review found that an exact approved revision delivered out of order
could previously reach READY and trigger SYSTEM's selector fault. The receiver
now binds READY to the committed application phase: old first, new second, then
finished. Only SYSTEM's complete-consumption commit advances that phase; image
reset clears it. A wrong-phase transfer is received and rejected without READY,
leaving SYSTEM and USER B able to continue and accept the next correct delivery.
The focused test covers new-first, successful old consumption, repeated-old and
subsequent valid new delivery. The extended full-top test also checks USER B
progress during both rejections and eventual results 17, 29, 17.
The earlier evidence above is retained as historical positive evidence; it
does not qualify the corrected source identity. The corrected full-top run
passed in **2093.09 seconds**, and its offline evidence check passed.
It is retained in `generated-artifacts/combined-phase-guard-20261110/`.
The final source/configuration identity, shared by all three proof records, is
`63520c38663a4651570e3ac109c42416cd872a9193b481db67b265d82e745047`.
The run observed 169 USER B progress events at lazy-delivery capture, rejected
new-first and repeated-old exact bodies without faulting, completed results
**17, 29, 17**, and replaced the image in epoch 2 while rejecting stale delivery.
This final run supersedes the initial positive sequence for qualification.

## Reproduce the approved local qualification

```sh
python docs/phase-2/cooperative-retry/run_combined_tests.py \
  --output generated-artifacts/combined-qualified-NEW
python docs/phase-2/cooperative-retry/check_combined_evidence.py \
  generated-artifacts/combined-qualified-NEW
```

Use a fresh output directory. The runner verifies pinned parent sources and
approved image/LUMP hashes, freezes the isolated source/configuration manifest,
then runs focused checks and the continuous UART-pin sequence. It does not
invoke vendor tools or a hardware bridge. Full image transfers are intentionally
cycle-accurate and can take substantially longer than the component tests.

The evidence checker refuses missing or mismatched proof records. The identity
is a source/configuration SHA-256, not a BIT identity. A report is not complete
merely because preparation succeeded or the RTL elaborated.

Validated LUMP bytes remain locked against UART aborts and framing errors
through SYSTEM consumption. Such input is rejected without changing the data
SYSTEM is copying. Only completed consumption/commit or execution reset
releases the snapshot; this does not reset or renew the execution watchdog.

Approval here authorizes only admitting these exact image inputs for isolated
local combined-top qualification with the listed grants. It does not authorize
saved-design replacement, vendor builds, physical transfer/programming, or
publication. If executable image bytes or grants change, review the replacement
hashes before treating the new candidate as approved.
