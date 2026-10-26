# Runtime reboot: capability authority versus LOAD-shadow telemetry

2026-10-26. Offline investigation; no FPGA, bridge, network, saved Namespace,
or immutable candidate changes. Reset semantics have **not** been changed.

## Finding

The anomalous counter 7 is not evidence that LOAD acquired or used the reported
GT. The exact word at byte `0x3504` is `0x00000002`: opcode LOAD, condition EQ.
With Z clear this instruction retires **without executing LOAD**.

`hardware/core.py` captures `trace_load_shadow_gt` only on `load_start_sig`,
which is gated by conditional execution. That diagnostic latch is not cleared
by FAULT_RST. `TraceEventDecoder` in `hardware/wukong_top.py`, however, chooses
LOAD_SHADOW/LOAD_NEW events solely from the retired opcode, without a condition-
passed indication. Consequently a skipped LOAD can report the last executed
LOAD's old-destination GT, even across runtime reboot. LOAD_NEW here reports
the current destination GT; it is not proof of a new grant.

This explains why the programming capture starts with shadow zero while the
reload capture reports `0x4a000011`. It is a **stale diagnostic value**, not a
retained live register descriptor at this boundary. That does not establish
universal reboot safety or certify the physical image.

## Evidence and independent checks

The frozen input remains 65,536 bytes, SHA256
`2a16403e94639abac7716ea9cf56a35f5bbc6bf5e3a99e805457bcd1f563a451`.
No instructions, descriptors, seals or Thread homes in this input are
translated or repaired for the checks.

- Physical evidence: the retained pre-upload runtime-reboot snapshots at NIA
  `4` show CR0–CR14 all zero, with only the newly established CR15 Namespace
  root nonzero. They are CRC-verified snapshots, not observations of every
  reset cycle. Counter 7 at `0x3504` reports the old shadow; counter 8 reports
  zero. See the original [reload report](installed-image-reload-result.md).
- RTL core replay: `scripts/probe_runtime_reboot_core.py` starts
  `ChurchCore` with the exact candidate and the guarded profile's reset ROM
  marker, runs to the Mallory fault, restores the exact frozen external memory
  words to model a completed reload, then pulses the normal `reboot_req` input.
  It observes the real reset and execution paths, not forced register clearing
  or an injected shadow. External memory is a synchronous simulated bus;
  the reload itself is explicitly a model input, not UART transport proof.
  Assertions compare **all sixteen three-word capability descriptors** at
  NIA `4` (before boot CHANGE), `8` (before boot CALL), `0x3504` (before the
  conditional LOAD), `0x3508` (before the first executed application LOAD)
  and `0x350c` (before application CHANGE). Cold and reloaded descriptors
  and M bits/flags must match, all descriptors and M bits must pass through
  zero on reboot, and both
  executions must reach BOUNDS at `0x2e08`. The skipped LOAD must reproduce
  shadow zero versus `0x4a000011` while live descriptors remain equal.
- Small RTL checks in `tests/hardware/test_runtime_reboot_authority.py`
  independently dirty all descriptor words and M bits, assert reset even
  against simultaneous writes, and require complete clearing. A separate
  production trace-decoder check reproduces the misleading opcode-only pair.
- Independent JavaScript checks in `simulator/test_runtime_reboot_authority.js`
  decode the exact candidate word and confirm EQ is false with reset flags.
  Synthetic dirty-bank reset checks attempt LOAD, CALL and CHANGE immediately
  after reset: LOAD/CALL fault NULL_CAP, CHANGE faults TYPE, and no descriptor
  is restored by those attempts.

**Simulator limitation:** its real image loader rejects this experimental
ascending candidate because it is not the supported Namespace Header V2
format. The test explicitly requires that rejection. It does not silently
boot the default image, bypass admission, or claim a full candidate replay
in JavaScript. The independent software evidence covers decoding and reset
authority, not end-to-end candidate execution.

**RTL limitation:** this is current source RTL with the exact frozen runtime
bytes, not simulation of a read-back installed netlist. A full-top bit-by-bit
UART replay was stopped after more than 17 minutes; it is not counted as
passing. The bounded core replay isolates reset from transport, which is
covered only by the pre-existing physical observations. The physical bitstream
remains operator-attested, and full installed-memory equality remains unavailable.

## Observed core replay result

The [retained result](reload-evidence/new-layout-amoeba-runtime/runtime-reboot-core-result.json)
records all boundary descriptors, M bits, flags, retirements and source hashes.
Both runs pass through completely zeroed live descriptors and M bits.

| Boundary | Cold shadow | Reloaded shadow | Live state comparison |
|---|---|---|---|
| `4`, before boot CHANGE | `0` | `0x4a000011` | All descriptors, M, flags equal |
| `8`, before boot CALL | `0` | `0x4a000011` | All descriptors, M, flags equal |
| `0x3504`, skipped LOAD.EQ | `0` | `0x4a000011` | All descriptors equal; M=`0x40`, flags=`0` |
| `0x3508`, executed LOAD | `0` | `0x4a000011` | All descriptors equal; M=`0x40`, flags=`0` |
| `0x350c`, CHANGE | `0` | `0` | All descriptors equal; M=`0x40`, flags=`0` |

At `0x3508` the actual LOAD replaces the diagnostic shadow with its own
destination's old value. Both runs then fault at `0x2e08`, BOUNDS (`8`).
The four focused pytest checks pass, including the replay and retained-event
hash check. The independent Node checks pass. The earlier related trace and
NULL-LOAD regression run passed 49 checks (before the two additional focused
checks were added); these are not a full project-suite claim.

## Persistent state is a different question

Runtime reboot clears live CR descriptors, DRs, flags and M bits; it does not
erase DMEM. Approved Thread activation can restore authority from Thread homes,
and boot legitimately establishes CR15, CR12, CR5, entry CR0 and then CR6/CR14.
Nonzero registers after boot are not, by themselves, retained live grants.
Conversely zeroing a diagnostic latch would not revoke persistent grants.

A preliminary reboot-only model run (without re-uploading the frozen bytes)
cleared the live descriptors but faulted at NIA `4`, code `18`, instead of
replaying the candidate. It is not counted as a successful exact-image reload:
the previous execution had mutated persistent state. No automatic repair,
erasure, version change or recovery was added.

## Policy decision before any reset change

No reset-semantics change is justified by counter 7 alone. If the desired policy
is to revoke persistent Thread-home authority on runtime reboot, that is a
separate architecture decision: specify which homes survive, how boot authority
is re-established, and whether reboot means restart or revocation. Do not
silently clear memory, rewrite GT versions, or broaden activation to make a
reboot succeed.

There is a narrower telemetry choice: report condition-failed instructions as
skipped (or suppress their LOAD-specific events), rather than presenting stale
shadow data as an executed LOAD. Merely clearing the shadow at reboot would
hide this instance but leave stale shadows on skipped LOADs within a run.
Any trace-format/consumer change should be explicit and preserve historical
capture interpretation.

## Reproduce offline

```sh
python3 scripts/probe_runtime_reboot_core.py > /tmp/runtime-reboot-authority.json
python3 -m pytest tests/hardware/test_runtime_reboot_authority.py -q
node simulator/test_runtime_reboot_authority.js
python3 scripts/verify_installed_image_reload_evidence.py
```

The core replay uses the full 64 KiB candidate without simulating UART bits.
These checks do not authorize installation, publishing, programming or recovery.

The historical reload-evidence verifier cannot finish in this fork because
`attached_assets/wukong-corrected-program-20261026T200751646720Z_1793045631780.bin`
is absent. That command is listed for environments retaining the original raw
capture; it is **not** reported as passing here. The retained JSON evidence is
still available. The new RTL replay and independent checks do not substitute
for or weaken that historical raw-capture verification.
