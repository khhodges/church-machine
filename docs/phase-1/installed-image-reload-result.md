# New Layout: physical full-runtime-image reload result

**2026-10-26 — Transport acknowledged and expected denied-access program
endpoint observed after a 64 KiB UART reload, without FPGA programming during
the reload. Full installed-byte equality is not verified.**

## Exact inputs and target

- Runtime image: **New Layout**, retained experimental ascending Namespace.
- Input: [candidate-le.bin](reload-evidence/new-layout-amoeba-runtime/candidate-le.bin),
  65,536 bytes, little-endian words.
- Input SHA256:
  `2a16403e94639abac7716ea9cf56a35f5bbc6bf5e3a99e805457bcd1f563a451`.
- [Frozen layout, resident identities and initial Thread inputs](reload-evidence/new-layout-amoeba-runtime/evidence.json).
  Intended entry: ActorManager, NS[20], byte `0x3504`.
- Existing bridge swaps each LE word to BE. Computed wire-payload SHA256:
  `94e649cb1b9aa32a77f96950f7ec91169c4a81d5d749cb37b7539289839f8e30`.
- Frame: `75 00 01 00 00` plus 65,536 payload bytes; total **65,541 bytes**.
  Computed frame SHA256:
  `96e560f13089bc7bda494e53b1080bc1c2f2b424be64f3d5beb69081b4e8bc5a`.
  These are host-side computations, not captured UART or installed-memory hashes.
- Selected device UID: `20250619ac5c01`, operator-provided from the earlier JTAG
  session; COM3, 57,600 baud. This label is not hardware identity attestation.
- Bridge session: `9bc8f0b355574cdc89e82f51ea428a71`.
- Host bridge: v19, exact downloaded script SHA256
  `856576576b12c6be77f29e5bd3b033e608ee3a52938b824edfa323b74df1c07c`.
- Board reported build **20**, trace protocol **2**, scheduler support.
  Build 20 is reused and does not identify the exact installed configuration.
- Operator explicitly confirmed that the corrected temporary 25 MHz bitstream
  remained installed without power cycling or subsequent FPGA programming.
  Its verified retained SHA256 is
  `c1d71a721a1380532c59be4da188def94ae8a000d6ea9b702f095d83b67c83b7`.
  This is operator-attested installation, not configuration readback.

## Controlled sequence

1. Passive capture after temporary FPGA programming had already reached the
   Mallory denial. That was not counted as a runtime reload.
2. The workspace bridge connection was repaired and target-envelope checks
   were corrected without weakening the bridge's independent identity check.
3. An explicit snapshot command was serial-write acknowledged but produced no
   snapshot, consistent with the RTL's fault-hold restriction.
4. The operator approved the existing runtime Reboot, explicitly distinguished
   from FPGA reconfiguration/power cycling. Reboot request 2 produced a fresh
   startup sentinel, board-confirmed halt and CRC-valid snapshot.
5. After operator confirmation of the installed build, a five-minute,
   session-bound installation approval was provisioned. Offline admission
   verified the retained image identity; provisioning did not queue commands.
6. The operator ran the guarded control script: inspect exact-image approval,
   issue STOP request **3**, wait for board confirmation, then submit upload
   **4**. The server independently rechecked fresh STOP evidence, target,
   approval, image hash and exclusive transfer ownership.
7. The bridge transferred the complete image and reported board upload ACK.
   Its existing handler sends runtime reboot `f` only after receiving `06`.
   A subsequent startup sentinel and program trace were observed.
8. No further Run, Step, retry, recovery or FPGA programming command was
   issued to obtain the final endpoint. The short-lived installation approval
   was revoked after evidence collection; no repeat transfer is queued.

Server timestamps, UTC:

| Event | Timestamp |
|---|---|
| STOP 3 queued | Unix `1793048638.1886256` |
| STOP serial write acknowledged | Unix `1793048639.703291` |
| STOP board confirmation recorded | Unix `1793048641.645225` |
| Upload 4 queued | `2026-10-26T21:04:01.442600Z` |
| Upload 4 consumed | Unix `1793048641.6907551` |
| Upload success recorded | `2026-10-26T21:04:14.242621Z` |

Bridge capture timestamps and server receipt times are separate clocks; do not
use cross-clock subtraction as a causal proof.

## Evidence layers

### 1. Transport: acknowledged

The non-consuming status record contains `runtime_upload_ack.ok=true`, ID 4,
65,536 bytes, the exact input hash, selected UID and matching bridge session.
`command_delivery.write_ok=true`, with no reported error. The transfer lease
is clear and the command queue is empty. This is the bridge's report of the
board's upload acknowledgement, not a board-computed content digest.

### 2. Installed bytes: unavailable

The existing interface exposes neither full DMEM readback nor an installed
image hash. ACK, host payload hash, sentinel and register snapshot do not
establish byte-for-byte equality of all 64 KiB. No such equality is claimed.

### 3. Program execution: observed expected denial

The retained events contain exactly **39** trace packets with contiguous
bridge-local counters 1–39. In counter order they show boot, ActorManager
entry `0x3504`, AmoebaStartup, Alice executing and returning, the second
Thread handoff and Mallory's denied LOAD at `0x2e08`.

Counters 38 and 39 report **BOUNDS (`0x08`)** at `0x2e08`.
The correlated reason-2 snapshot has:

- CRC16 verified, value **22799** (`0x590f`);
- NIA `0x2e08`;
- Thread base `0x2800`, CR12 GT `0x0200000c` — Thread.3;
- all six capability registers selected by the retained model endpoint
  matching exactly: CR2, CR6, CR12, CR13, CR14 and CR15;
- hardware fault snapshot complete, with recovery not authorized.

The frozen image maps this address to Mallory's `LOAD CR1, CR6, #2`.
This matches the retained model's denied-access endpoint. Program comments
name NO_CAPABILITY; the actual BOUNDS result is not silently counted as exact
fault-code conformance.

## Remaining limitations and anomalies

- **Post-reboot automatic halt timed out.** The loaded program ran to its
  fault endpoint before the bridge's startup halt was confirmed. Transfer
  success and the final fault stop are evidenced; reliable post-reload
  startup pause is not. Do not report a successful post-upload halt.
- **Initial shadow value differs from the earlier programming capture.**
  Of the 39 trace packets, all fields match that capture except the LOAD
  shadow payload at counter 7, NIA `0x3504`: earlier `0`, reload
  `0x4a000011`. The following LOAD-new result matches, and final selected
  registers match. This needs separate investigation of cached register
  state across runtime reboot; do not claim a completely pristine initial
  register state or alter reset semantics in this trial.
- **HTTP arrival order is not retirement order.** Critical fault delivery
  overtook ordinary trace delivery. `latest_trace` consequently names an
  earlier non-faulting event even though the authoritative correlated fault
  snapshot is complete. Use bridge-local packet counters for this program
  sequence, not server sequence numbers, displayed call depth or latest trace.
  Ordinary trace records omit the session field; session-tagged ACK/fault
  evidence and the controlled single-bridge context support the interpretation,
  not an independently retained session tag on every normal trace packet.
- The board's exact installed configuration and entire installed runtime
  memory were not read back. This is not general Phase 1 certification,
  release approval, GT memory parity/ECC acceptance or interrupted-transfer
  testing.

## Retained evidence and checks

- [Status and acknowledgements](reload-evidence/new-layout-amoeba-runtime/physical-runtime-reload-status.json):
  SHA256 `ae86981da39f5daefa604af48d4513c1b80d082358966ccf000ae6b23d217bb9`.
- [Event stream](reload-evidence/new-layout-amoeba-runtime/physical-runtime-reload-events.json):
  SHA256 `b41d05a56e4cbf498ef7a6bdfaff8104ba8e644b821f830edc81a91ea9c57d00`.
- [Pre-upload runtime reboot observation](reload-evidence/new-layout-amoeba-runtime/runtime-reboot-observation.json).
- [Earlier physical programming observation](reload-evidence/new-layout-amoeba-runtime/physical-corrected-program-observation.json).
- [Offline model endpoint](reload-evidence/new-layout-amoeba-runtime/full-program-result.json).
- [Build, timing, boot and connection history](new-layout-25mhz-candidate.md).

Focused connection/protocol checks: 66 passed; one unchanged legacy
image-generation test assumes boot NS[6] while saved state selects NS[10].
Command-envelope, guarded-admission and routing checks: 95 passed.
No saved Namespace assignments, LUMPs, resident revisions or user inventory
were changed to obtain these results.

Recheck the retained evidence without network or hardware access:

```sh
python3 scripts/verify_installed_image_reload_evidence.py
```

The verifier requires the recorded startup-halt timeout and initial shadow
difference to remain explicit; a passing evidence check is not a pristine
reset, installed-memory equality or release-acceptance claim.

## Initial project completion blockers and software corrections

The physical observation and its read-only evidence verifier passed, but the
configured project completion validation did not. These failures are not
waived by the hardware result:

- `wukong-relay-deployment-guard`: the publish configuration specifies
  `cloudrun`; the stateful relay test requires `vm`.
- `boot-change-validation`: Thread scheduler continuation/frame checks fail,
  including resumed execution faults. Reconcile with the approved
  program-relative continuation convention; do not simply relax assertions.
- `mint-authority-removal-tests`: a fixture encounters `CHANGE CR13 is
  reserved` instead of completing its expected flow.
- `save-realignment-handoff-tests`: save succeeds but simulation preparation
  returns HTTP 409; the expected executed-revision handoff is not completed.

The operator subsequently authorized software-only correction:

- Restored the previously approved `vm` publish setting, without publishing.
- Updated synthetic scheduler frames and expected addresses to the approved
  program-relative convention; all 87 scheduler/boot checks passed.
- Replaced the Mint test's reserved CR13 handoff with an authored indexed
  CR6 capability lookup; the full configured Mint command passed.
- Aligned portable/symbolic binding evidence with the complete saved
  assignment context rather than the resident-only copy subset. Old preview
  keys are invalidated; explicit Bind is still required.
- Corrected simulator CALL admission to bound executable code by the
  Namespace access limit rather than requiring that limit to include the
  entire allocation and tail C-list. It does not widen stored bounds.
- Updated the save regression to perform the real explicit Bind and retry,
  retain missing-evidence diagnostics, and verify native execution while
  preserving draft, conflict, activation-failure and immutable-history checks.

No further board command, retained image modification or programming operation
was performed for these corrections. The configured completion checks remain
the final software gate; physical evidence does not waive them.

## Post-reload startup halt investigation (software-only)

The physical result above is unchanged: the New Layout 64 KiB transfer was
acknowledged, execution reached Mallory's expected denial, and the automatic
post-sentinel halt timed out. Nothing in this investigation upgrades that
timeout to a successful startup pause. No board command, reflash, image
replacement, or reset-policy change was performed.

### What the existing implementation can guarantee

`hardware/wukong_top.py` clears `step_mode` and `step_halted` when recovery
re-arms the sentinel. Instruction fetch is gated by `sentinel_req`, which
clears when the last sentinel byte is accepted by the UART transmitter, not
when the bridge receives it or responds. Entry execution can therefore begin
before the host can send its nonce-bearing Halt. A pre-entry pause is **not
guaranteed by this protocol**. Guaranteeing one requires a separately approved
FPGA/protocol change; sending Halt faster is not a substitute.

The bridge previously called `read(128)` with a 50 ms serial timeout. A short
sentinel could wait for that timeout before parsing. It now waits for one
byte and drains available bytes, removing that avoidable batching delay.
This improves best-effort post-sentinel Halt latency but is not physical
acceptance evidence and does not establish the sole cause of the recorded
timeout.

Source inspection also found that the current UART arbiter gives Halt-state
bytes priority over trace/snapshot bytes without a whole-frame ownership
guard. A Halt arriving during a frame can therefore interrupt that frame.
The retained capture does not establish whether this happened in the reload
above. This needs separate RTL framing validation before any hardware release;
the current change does not modify RTL or teach the parser to accept damaged
frames.

### Reporting and correlation

- A successful serial write remains only `halt_requested`.
- Matching nonce, bridge session and board-state counters are required for
  automatic Halt confirmation, just as request correlation is required for
  explicit Halt.
- A fault trace from the same session with a bridge trace counter greater
  than the sentinel baseline reports `fault_stopped`. It is not
  `awaiting_first_step` and does not prove a successful startup pause.
- The counter boundary handles a rapid fault arriving at the server before
  boot-info because fault telemetry has delivery priority. Older-boot and
  wrong-session evidence cannot establish this state.
- Fault evidence is retained independently of the latest trace: queued
  non-fault telemetry arriving after the prioritized fault cannot hide it.
  Retention is keyed by authenticated bridge session and does not require
  its initial status report to arrive first; rendering still requires an
  exact match to the trusted boot session and counter boundary.
  A new boot's counter boundary excludes the old fault, and confirmed
  Skip Fault completion clears the retained live fault, not its history.
- A later Halt confirmation does not erase a current program fault.
  Halt confirmation evidence remains separately recorded.
- Missing evidence remains timed out/unavailable. Both polling endpoints use
  the same interpretation, and the UI observes state changes within one boot
  timestamp instead of suppressing them as duplicates.

Focused software regressions cover short serial reads, timely nonce-bound
Halt, rapid fault delivery in either HTTP order, late Halt after fault,
stale-session/old-counter rejection, timeout consistency, and UI transitions.
They do not certify a new physical reload or a pause before entry execution.
