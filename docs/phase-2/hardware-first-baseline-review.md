# Hardware-first baseline review

Date: 2026-11-09
Scope: read-only workspace inspection for Steps 1–2. No board contact,
execution tests, compilation, restart, installation or hardware changes.

## Step 1 — baseline evidence, not yet a confirmed current installation

Two distinct identities appear in the inspected records:

- `docs/phase-1/installed-image-reload-result.md` records operator-attested
  installation of temporary 25 MHz BIT
  `c1d71a721a1380532c59be4da188def94ae8a000d6ea9b702f095d83b67c83b7`
  for the October 26 reload. This is historical, not current configuration
  readback. Build number 20 was reused and cannot uniquely identify that BIT.
- `server/uart_profile_install.py` pins the native Amoeba retry profile to BIT
  `a4acb0ef9a39ba985d7769031cf146edb68fb65ff96e0b4f4a895093b54e5d4e`.
  A required profile hash is not installation evidence.

The retained October 26 candidate was freshly checked with SHA-256:
`docs/phase-1/reload-evidence/new-layout-amoeba-runtime/candidate-le.bin`,
65,536 bytes,
`2a16403e94639abac7716ea9cf56a35f5bbc6bf5e3a99e805457bcd1f563a451`.
It matches the historical report. That proves the retained file, not current
board RAM. The report explicitly says full installed-byte equality was unavailable.

**Open gate:** establish the actual current BIT and runtime image from the
operator's latest programming/upload record; locate matching ROM/build evidence.
Neither historical installation nor current source establishes Phase 2 support
on the board. No replacement or flash is recommended yet.

## Step 2 — bounded source findings

### Already present locally

`hardware/core.py` routes the CALL absence signal into ordinary CHANGE's
`llr_entry` and `llr_target`. `hardware/ordinary_change.py` has explicit
LLR owner, metadata and injection states.

`local-llr-entry-results.md` records 18 focused tests and six guarded-core
tests passing. These are historical local results, not freshly rerun checks
or board evidence. Positive retry cases change isolated fixture memory to make
the body available; they do not implement actual delivery.

### Confirmed simulator difference

The `cw=0` CALL path in `simulator/simulator.js` still invokes
`_fireSchedulerIRQ('LAZY_LOAD', ...)`, unlike the protected RTL transition.
The simulator also retains host-side lazy-loading/scheduler mechanisms.
This is diagnostic information, not a simulator-alignment prerequisite.

The review's Lambda continuation and BOUNDS examples have not been established
as current, exact-target discrepancies by this inspection. Do not promote
historical descriptions into confirmed present defects.

### Minimum remaining obligations

1. Match the installed BIT to its frozen source/build evidence and determine
   whether it contains the protected LLR transition. Current checkout alone
   cannot answer this.
2. Identify an executable SYSTEM continuation with one pending request,
   correct caller/target association and ordinary USER restoration. Existing
   simulator scheduler code is not proof of machine-executed SYSTEM software.
3. Identify or implement only the missing request/receive/install path.
   `test-checklist.md` still lists transport framing/capacity, provisioning and
   related contracts as gates. Generic UART whole-image upload is not evidence
   of per-LUMP DELIVER.
4. Prepare the smallest exact-image fixture, including another eligible USER
   for progress evidence during the wait.
5. Verify ordinary retained-GT checks at retry, including stale/wrong GT,
   rather than treating successful delivery as renewed authority.

These are obligations, not a claim that every item needs new code. A complete
machine-software inventory remains pending; do not estimate implementation
volume until the installed target is resolved.

## Next bounded action

Obtain the latest programming/upload record, then compare its exact build
against the local LLR implementation. Finish the SYSTEM/service inventory for
that target before preparing a fixture or proposing a BIT change.

Observer limits must not introduce machine timeouts. Board behavior establishes
what is installed, not what the ISA permits. Simulator disagreement alone is
not a blocker, but a demonstrated safety failure is. Any required programming
is separately authorized and verified; partial installation never authorizes
execution.
