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

## Minimum-change assessment — subsequent source inspection

This assessment inspected current RTL references, the existing LLR fixtures,
watchdog status, the consolidated checklist, server Python paths, the LUMP
manifest and simulator assembly examples. No simulations or builds were run.
Absence findings below are bounded to that inspection, not a claim that every
historical archive was searched.

| Component | What can be reused | What remains |
|---|---|---|
| Protected unavailable-CALL entry | Current CALL/core/ordinary CHANGE implementation; recorded 18 local and six guarded-core passes | Select and qualify its exact dependencies against the frozen board build; no vendor/physical acceptance of this transition established |
| USER restoration and CALL retry | Existing CHANGE and ordinary CALL path; guarded fixture demonstrates retry/RETURN | Positive fixture patches memory directly; real delivery and stale/wrong retained target GT at retry remain separate acceptance obligations |
| Execution watchdog | `hardware/execution_watchdog.py`; documented 33 unit-test passes | Only tests instantiate the unit in the inspected hardware Python tree; core/top integration, access/provisioning and write containment are absent |
| SYSTEM service | Approved slot-2 Boot/SYSTEM architecture and saved continuation contract | No complete machine-executed pending/request/install/resume service established by this inspection |
| Legacy Scheduler | Existing scheduler example and simulator hooks | Not a SYSTEM implementation: the assembly example is a RETURN body and explicitly delegates behavior to the simulator |
| Transport | Existing UART transport and guarded full-image upload | No verified per-LUMP DELIVER service established; full-image upload halts/replaces the runtime and cannot substitute for delivery while another USER progresses |
| Test evidence | Existing guarded handoff fixtures and trace/snapshot mechanisms | Exact candidate image, accepted-instruction evidence and physical results; do not rely solely on `retire_instr`, whose poisoned-fetch limitation is documented |

### First handoff experiment versus end-to-end acceptance

**Handoff-only experiment:** one unavailable USER CALL, preserved USER context,
slot-2 SYSTEM saved continuation, exact DR1–DR6/Z injection and no CALL retirement.
It can stop at that boundary without pretending to implement delivery.
Necessary local negative controls cover invalid authority/context. An observer
limit stops observation, never introduces a USER timeout or automatic resume.

The first action toward this experiment should be an offline fixture/dependency
specification, not a vendor build. Any proposal for a physical handoff-only
candidate must explicitly declare watchdog readiness and exclusions. This
assessment grants no watchdog exemption and does not treat incomplete enforcement
as accepted Phase 2 behavior.

**End-to-end Lazy CALL:** additionally requires resident SYSTEM pending/ready
software, one request and validated delivery/install path, ordinary retried-CALL
authority checks, another USER progressing during the wait, and the applicable
integrated execution watchdog. The checklist also requires the all-USER-wait
case with SYSTEM self-CHANGE. Stale/wrong retained GT, duplicate/stale/wrong-target
delivery and installation fault handling are required controls, not optional
polish after a happy-path demonstration.

The watchdog unit is useful completed work, but its integration is not a wire-only
change. Expiry must stop new program writes and handle already-accepted writes
within a proven boundary; raw timer expiry alone does not establish containment.

### Contracts that must be settled, not guessed

For the single-request fixture, close only the necessary portions of:

- **G1:** request/response framing, byte order, receive capacity and backpressure.
- **G2:** session setup/reset correlation and non-reuse; existing agreed u64
  session/u32 request widths are not permission to omit their lifecycle.
- **G3:** private pending record, registration/completion authority, ready-state
  publication and selection of the other eligible USER.
- **Safe installation:** validated destination/body binding and fault handling,
  without granting new authority or silently modifying a retained target GT.
- **Watchdog integration:** approved `0xFFFFFF18` access/provisioning path,
  completed-transition renewal, Debug/Trace/reset behavior and write containment.

No new protocol or grants were chosen in this assessment.

### Bounded next recommendation

Specify one **handoff-only fixture and its exact hardware dependency delta** from
the confirmed baseline. List each dependency with a reason; do not copy today's
entire hardware tree into a new build. Define entry state, absent target, saved
SYSTEM continuation, expected registers and fault controls. Identify any
unresolved watchdog safety boundary before proposing physical execution.

Deliver that specification for review before running RTL tests or implementing,
building or programming anything. Defer request/delivery implementation until
the small G1–G3 and safe-installation contract is explicit. No simulator parity,
general scheduling framework, retirement, storage or networking work is included.

**Conclusion:** the handoff logic already exists locally, but complete hardware
Lazy CALL is not just a new BIT plus an existing service. There are real SYSTEM,
delivery and watchdog-integration gaps. No defensible small implementation
estimate follows until the candidate dependencies and contracts are resolved.
