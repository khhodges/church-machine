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

**Updated gate:** the operator subsequently confirmed using the uploaded build
on two different Artix-7 boards with the same results. Treat this as installation
attestation, not readback. Current runtime RAM and any later UART replacements
remain unverified. No replacement or flash is authorized.

## Step 2 — bounded source findings

### Uploaded latest files: identity verified

The user supplied `attached_assets/BootBuildOct26_1794226668643.zip` as the
latest files. Inspection was in memory, without extracting or programming:

| File | Bytes | SHA-256 |
|---|---:|---|
| `amoeba-retry-a4acb0ef.bit` | 3,826,002 | `a4acb0ef9a39ba985d7769031cf146edb68fb65ff96e0b4f4a895093b54e5d4e` |
| `BootBuild.mcs` | 10,761,048 | `a713e9919821828117ee045454c8dd088a2c2dd019b4b074ee78ad70f5feb732` |

The BIT exactly matches the native Amoeba retry profile. Its internal build
header names `7a100tfgg676`, date `2026/10/30`, time `18:08:41`.
The ZIP filename's October 26 label is not the build date.

All Intel HEX record checksums passed. The MCS contains 3,825,788 data bytes
from address zero through exclusive end `0x3a607c`; the complete decoded data
matches the BIT configuration payload directly, without bit reversal.
Thus these are matching configuration artifacts, not two different builds.

The operator confirmed these files were used on two different Artix-7 boards
with the same results. This closes the operator-confirmation question for the
configuration baseline; it does not establish current RAM equality or a new
Lazy-CALL acceptance result.

### Frozen build comparison after operator confirmation

Freshly rehashed the retained vendor manifest, frozen CALL/core sources and
candidate image. All matched their recorded hashes. The manifest hash
`5ab35bf4d2060ca4fad7b36d4a1cd5f8f4498f960a8d717f56580e0c54a1604b`
matches the preserved vendor verification that names the supplied BIT.
The embedded candidate image hash is
`5603d8e105e47ca0f6524e4553989387c088de19ac0e6b3f6fd9897e170cf16d`.

The frozen CALL uses LAZY_LOAD_ABORT and the frozen core routes that signal
through the legacy IRQ dispatcher, not the current protected LLR entry.
Therefore the confirmed baseline does not contain the newer protected
USER-to-SYSTEM transition. A software-image upload alone cannot add that
hardware transition. This is a prerequisite finding, not flash permission.

`reports/phase2-execution-watchdog-prerequisite.md` also documents missing
execution-watchdog support in this frozen build; UART upload timeout is not
that watchdog. Later current-source watchdog work must be assessed separately
before sizing a new candidate. No new RTL simulations were run.

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

Scope the minimum candidate hardware delta from the confirmed frozen baseline,
including the protected handoff and applicable execution-watchdog prerequisites.
Finish the SYSTEM/service inventory before preparing a fixture. Do not build
or flash merely because the prerequisite is absent.

Observer limits must not introduce machine timeouts. Board behavior establishes
what is installed, not what the ISA permits. Simulator disagreement alone is
not a blocker, but a demonstrated safety failure is. Any required programming
is separately authorized and verified; partial installation never authorizes
execution.
