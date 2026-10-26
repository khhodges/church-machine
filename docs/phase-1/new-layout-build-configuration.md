# New Layout candidate configuration — frozen, not build-ready

## Latest independent compile result

The unchanged retained production Verilog **passed Icarus compilation** with
exit code 0 in **332.82 seconds**, within the explicit 600-second diagnostic
budget. The earlier 90- and 240-second deadlines were insufficient for this
file; no RTL change was needed between those attempts.

The generated simulator executable is 76,931,560 bytes, with SHA-256
`ac2910c5ea3056477f37e544ef092cf5769eb161ca4931a297cb21870c236f4f`.
Its hash and the recorded source fingerprint were checked again after completion.
The Verilog hash remains
`2b8733b8e2d3737275b499a9ae1bf25cbff4d28e4e7fd79c62e42959ac262c1b`.

Evidence is in
`reload-evidence/new-layout-amoeba-runtime/production-verilog-compile-600s.json`
and `production-verilog-compile-600s-output.txt`.

This closes the independent compilation check, **not behavioral replay**.
The compiled root is the production top without a stimulus testbench; simply
launching it does not establish clocked boot or program execution. Next, drive
and observe the exact generated design with bounded, fault-aware replay.
Full UART reload, vendor release gates, and physical verification remain pending.
No FPGA commands, vendor synthesis, or flashing occurred.

### Exact-executable replay driver

`scripts/replay_guarded_top_vpi.c` drives only the compiled top's external clock,
inactive reset and idle UART RX. It reads initialization, boot, instruction and
fault signals without changing internal state or rewriting the compiled design.
The executable hash is checked against the successful compilation before launch.

The retained executable has simulation time precision of one second, so this
driver uses logical clock cycles, not claims of nanosecond timing accuracy.
Production clock/baud **counter parameters** remain unchanged. Instruction
observations are labelled `RETIRE_PENDING` because sampling occurs before the
next rising edge; these are not independently asserted commit records.

The initial bounded run has a 600-second wall deadline and a two-million-cycle
ceiling. Neither limit counts as success. The observer stops on a fault or an
unknown sampled control, and retains the actual observation rather than
equating any clean process exit with a passing program.

Two small fixture tests validate clock driving, signal lookup, known-fault
reporting and unknown-control detection. They are driver checks, not production
program evidence. The production run reported initialization completion at
cycle 3,679, then stopped at cycle 99,298 with `UNKNOWN_RETIRE`, after 525.98
seconds. Boot completion was not observed. This is **not a pass**, nor was it a
wall-timeout, despite the supervisor and simulator exiting zero.
The initial observer combined unknown bits from retirement-valid, retirement
NIA and instruction reads; this result alone does not identify which field was
unknown or its cause. Next, separate those observations and trace the affected
input before changing RTL or relaxing checks.
The result and output are retained in
`reload-evidence/new-layout-amoeba-runtime/production-executable-replay.json`
and `production-executable-replay.txt`.
The follow-up observer now checks retirement-valid separately (including Z,
whose value bits can be zero), then reports address and instruction unknowns
independently. On stopping, it records value bits and X/Z masks for control,
retirement and instruction-fetch signals, including ROM versus DMEM selection.
Six focused fixture cases passed; these validate the observer, not the design.
The new observer is compiled separately, preserving the earlier observer binary.
Its source and binary hashes are captured **before** launching the unchanged
production executable. The diagnostic replay remains bounded to 600 seconds;
its result is pending.

### Field-specific result: removed observation bits, not unknown fetch data

The diagnostic reproduced the stop at cycle 99,298. Retirement-valid was known
and asserted; retirement NIA and fetch address were both known `0x00000004`.
ROM address was 1 and both ROM data and fetched instruction were known
`0x27000001`. There was no asserted machine fault.

Only retirement instruction bits 0–26 were unknown (`xz_mask=07ffffff`).
The exact generated Verilog declares those bits `unused_bits` and contains
drivers only for bits 27–31. The production trace consumer uses the opcode;
the lower bits of that internal observation wire have been optimized away.
The previous whole-word observer therefore imposed an unsupported requirement.
This result does not establish successful boot, but it does explain that stop
without diagnosing an unknown instruction fetch or changing the circuit.

The observer now reports the preserved five-bit retirement opcode and NIA,
explicitly marking the lower 27 instruction bits unavailable. It never fills
them with zeros or substitutes the current fetched word for a retired word.
Unknown opcode, NIA or valid bits still stop the run. Nine fixture checks passed,
including removed lower bits and genuinely unknown opcode bits.

The next replay checks the exact Verilog/executable hashes, verifies the
`unused_bits` declaration and five opcode drivers before launch, and preserves
the earlier observer binaries. Only observations and the wall budget changed:
the unchanged executable runs with a 1,800-second limit, normal banner/trace
timing and idle UART RX. Results are retained under
`production-executable-replay-opcode.json` and `.txt` in the same evidence folder.

The run ended at its 1,800-second wall-time limit, not at a successful program
result. Initialization completed at cycle 3,679, and the reset-marker retirement
observation at cycle 99,298 now passed the preserved-opcode check. Progress
continued through cycle 250,000 with boot-complete still false. No fault or
unknown-signal terminal observation was recorded before termination.

This is incomplete execution evidence, neither a boot pass nor proof of a
hardware deadlock. The supervisor exited normally after terminating the timed-out
simulation; that exit must not be interpreted as a design pass. No hardware
commands were sent, and UART RX remained idle throughout. The next diagnostic
needs boot-state and UART/trace-backpressure observations around the reset-marker
handoff before another expensive replay or a claim that more time alone suffices.

### Read-only handoff diagnostic

Source inspection establishes an important budget constraint, not a successful
runtime observation: CHANGE queues three 12-byte trace packets. With 8N1 at
50 MHz / 57,600 baud (868 clocks per bit), their wire time is approximately
312,480 clocks, plus arbitration/handshake overhead. Fetch is held while that
queue drains. The earlier replay's last progress report was only 150,702 clocks
after the reset-marker observation. Its lack of another retirement therefore
does not by itself indicate a stuck boot.

A separate observer build now samples boot state, activation, guarded CALL
readiness, halt controls, trace queue length/packet/byte position, UART busy,
acknowledgement, sentinel and recovery state every 10,000 clocks. It reads only;
the executable, image, clock parameters, UART RX idle input and normal trace
backpressure are unchanged. Twenty observer fixture cases passed, including
the new sampling path and existing unknown-value checks.

The diagnostic is bounded at 130,000 clocks or 1,200 seconds. Its purpose is
to establish whether the trace queue advances after the handoff, not to claim
full boot or full queue drainage. Retained evidence is
`production-executable-replay-handoff.json` and `.txt` in the evidence folder;
the separate observer source/binary and working log are retained under
`generated-artifacts/new-layout-production-rtl-lambda-operand/observer-handoff/`.

The diagnostic completed its 130,000-cycle limit in 636.24 seconds. At cycles
100,000 / 110,000 / 120,000 / 130,000, packet index remained 0 while byte index
advanced 0 / 1 / 2 / 3. Queue length was 3 and UART busy was asserted at each
sample. Thread activation and guarded CALL readiness were asserted, NIA was 8,
trace stall and halt request were asserted, and manual step-halt was clear.
These sampled values had no unknown bits. No fault/unknown terminal marker was
recorded.

This establishes advancing trace transmission during the sampled interval,
not a deadlock at that point. It does not establish eventual queue drainage,
CALL completion, boot completion, program outcome, or physical UART delivery.
The next execution gate is a sufficiently budgeted unchanged-executable replay
through queue drainage and the boot CALL; the diagnostic limit is not a pass.

The boot-handoff replay is now staged in a separate `observer-boot` directory,
using the same verified executable and RTL. It stops on observed boot completion
after checking fault/unknown controls, or at 600,000 clocks / 5,400 seconds.
This permits the approximately 312,480-clock trace interval after the reset
marker plus the boot CALL, with wall-time margin for host simulation speed.
It does not bypass UART timing or claim execution of the entry program.
Thirty observer fixture cases passed, including boot-stop behavior and ensuring
unknown/fault observations are not replaced by the boot-success marker.
Retained results are `production-executable-replay-boot.json` and `.txt` in the
same evidence folder. Observer source and binary hashes are captured at launch;
no hardware commands are issued.

The unchanged-executable replay reached boot completion at cycle 411,792 in
1,668.86 seconds. The preceding cycle observed CALL retirement at NIA 8,
opcode 2. At completion, boot-state was 6, boot-complete was asserted, fault-valid
and fault code were zero, and NIA / requested instruction address were `0x3504`,
the retained ActorManager entry. All those observed fields had zero unknown masks.
The earlier CHANGE trace queue advanced through packet 2, byte 11 before the
CALL. This closes the boot-handoff observation gate for this exact executable,
without changing RTL or suppressing production trace backpressure.

It does not prove ActorManager executed: at the stopping boundary fetch-valid
was low, the old ROM fetch was still visible, and the CALL's own three-packet
trace queue was newly pending. Program execution, full UART image reload,
vendor implementation/timing, and physical-board acceptance remain unverified.

### Program replay toward the expected Mallory denial

The user confirmed that the intended endpoint is Mallory's “steal” attempt
being denied, not a clean halt. A separate `observer-program` run preserves the
same image, generated RTL, executable, UART timing and idle RX input. Its limits
are 6,000,000 clocks and 28,800 seconds, stopping earlier on any fault, unknown
control, or unexpected DREAD start/completion. Forty observer fixture cases pass.

The retained earlier model supplies a comparison sequence of 16 address/opcode
observations through ActorManager, Alice and AmoebaStartup to Mallory. This is
comparison evidence, not an independent ISA oracle. Its endpoint was LOAD
`0x070b0020` at `0x2e08`, with BOUNDS code 8, before DREAD at `0x2e0c`.
The source comment's NO_CAPABILITY expectation remains a separate unresolved
fault-code conformance question; an arbitrary fault cannot satisfy this trial.

Pending output is `production-executable-replay-program.json` and `.txt` in the
evidence folder, with raw observations, sequence comparison, exact hashes and
actual terminal markers. No physical transfer, installation, memory persistence
across recovery, or full data-integrity claim follows from this execution test.

## Separate experimental droplet package

Following the user's request to build in parallel, a distinct experimental
vendor path is available; see [the droplet runbook](guarded-candidate-droplet-build.md).
It freezes the exact replayed RTL, retains the legacy release guard unchanged,
rejects timing overrides, and records output hashes without claiming release
approval. Thirteen package-integrity/mock-vendor checks passed; Vivado has not
yet run on this package. Its experimental build authorization is separate from
programming and from the remaining release gates described below.

The actual production boot sequencer
waits for its UART banner before starting the core; no banner or trace
backpressure is bypassed.

The intended configuration is recorded in
`hardware/profiles/new_layout_guarded.json`. It is a separate candidate profile;
it does not change the default build or authorize synthesis or programming.

| Setting | Candidate value |
|---|---|
| FPGA / top | xc7a100tfgg676-2 / church_wukong_xc7a100t |
| Clock / constraint | 50 MHz / 20 ns |
| UART | 57600 baud |
| DMEM | 16,384 × 32-bit words (64 KiB) |
| Namespace | Ascending, 64 slots; metadata 0, self 1, entry Thread 2 |
| Entry | ide.ActorManager, slot 20, first code byte 0x3504 |
| Guard | 23971; Namespace version 46; root Thread version 419 |
| Saved NIA | Program-relative word offset from first code word |
| Image | Exact retained ActorManager + AmoebaStartup corrected runtime trial |
| Image SHA-256 | 2a16403e94639abac7716ea9cf56a35f5bbc6bf5e3a99e805457bcd1f563a451 |
| Build policy | Two Vivado workers; timing violations not accepted |

The part and constraints are established by the existing Wukong project, not by
fresh identification of the connected board. The model used accelerated clock
and UART parameters; production clock/pin/timing behavior is not yet verified.

## Production wiring update

The two input-selection gaps below have now been addressed without changing
legacy defaults. `hardware.guarded_build_profile.build_inputs` loads the frozen
configuration and validates the exact 64 KiB image. Explicit guarded generation
passes both `expected_boot_guard=23971` and `runtime_image_words` with
`sim_mode=False`. That same image feeds the hardware initializer's ordered pairs
and count; the simulation-only override remains separately restricted.

The opt-in command is:

```
python3 -m hardware.gen_rtlil /path/to/fresh-candidate-output --profile new-layout-guarded-relative-nia-v1
```

The first real production RTL conversion failed
at Amaranth's combinational-cycle check, before emitting IL or Verilog.
Constructor and stubbed generator-routing tests establish selection, byte
identity, and metadata plumbing only—not generated-RTL equivalence or vendor
acceptance.

The detected path was: LAMBDA accepted-start → CR read-address selector →
CR read data → permission checker → fault-valid → LAMBDA accepted-start.
The selector in `hardware/core.py` uses `lambda_start_sig | lambda_busy`,
while start itself was gated by the permission result. The correction had to
break this feedback without bypassing permission validation.

The exact command, image/source identity and full exception are retained in
`reload-evidence/new-layout-amoeba-runtime/production-rtl-generation-result.json`
and `production-rtl-generation-failure.log`. The output directory remained
empty. No vendor synthesis or hardware commands ran. RTL replay and physical
reload remain unverified.

### Subsequent LAMBDA correction and real generation

The core now selects the decoded LAMBDA target before permission checking, and
the unit exposes its idle read address independently of accepted start. This
removes both feedback paths; permission results still gate acceptance and state
changes. No permission exemption was added.

Fifteen focused behavior/unit checks pass, including NULL and missing-X rejection
with valid authority in an unrelated register, and a valid target with NULL in
CR0. One additional structural core-conversion regression passes.

The exact production profile now converts successfully to RTLIL and Verilog in
`generated-artifacts/new-layout-production-rtl-lambda-operand`. The profile
sidecar hashes and current source-freshness stamps were independently checked.
The emitted Verilog SHA-256 is
`2b8733b8e2d3737275b499a9ae1bf25cbff4d28e4e7fd79c62e42959ac262c1b`.

An independent Icarus compile of that Verilog, using the Xilinx simulation-cell
library, timed out after 90 seconds without a diagnostic. No checker processes
remained. This is **unresolved**, not a syntax pass or evidence of a syntax error.
No production Verilog program replay has passed.

The next diagnostic used the **same unmodified Verilog**, Icarus verbose output,
and a 240-second deadline. Parsing completed in approximately two seconds.
The log subsequently passed elaboration/cleanup and island calculation and
reached `CODE GENERATION`. The deadline expired there without a reported HDL
error or a simulator executable. All compiler processes were stopped.
This narrows the unresolved check to a slow compilation, but does not establish
completed compilation, behavioral correctness, or a compiler hang.

The exact invocation, deadline outcome and verbose output are retained in
`reload-evidence/new-layout-amoeba-runtime/production-verilog-compile-240s.json`
and `production-verilog-compile-240s.log`. The supervisor's successful exit is
not a compile pass: the recorded compiler result is explicitly `timeout`.
Both generated files still match their profile hashes and current source stamps.

Next diagnostic: a longer bounded compile of the same retained file, with
process-tree cleanup and durable exit/output evidence, before considering any
RTL changes. Existing project experience includes successful Icarus compiles
that needed more than four minutes; a deadline alone is not a circuit defect.

Retained evidence:
`reload-evidence/new-layout-amoeba-runtime/production-rtl-lambda-correction-result.json`
and `production-rtl-lambda-correction.log`. Large generated outputs remain outside
Git. No vendor synthesis, upload, flashing, or physical execution occurred.

Guarded generation refuses the default build directory and nonempty output
directories. Its IL/Verilog headers and `guarded-profile.json` bind profile,
configuration and image identity; the sidecar hashes generated outputs.
Freshness inputs include the new module, configuration and exact image.
The source-closure check also exposed seven earlier omissions (ascending
authority/Namespace, boot guard, Thread activation/validation, ordinary CHANGE,
and reset marker); these are now covered by the core freshness manifest.

The legacy Vivado script explicitly rejects guarded output, including marked
Verilog with its sidecar removed. A profile-aware readiness/provenance path must
be completed before vendor synthesis. No timing or readiness gate is bypassed.

## Historical production mismatch

The current `generate_rtlil_wukong` call selects `sim_mode=False`, 50 MHz and
57600 baud, but **does not supply expected_boot_guard**. The constructor defaults
to `None`, selecting a different boot configuration from the tested model.

The tested exact image enters through `sim_boot_image_words`, which explicitly
rejects production mode. Production initialization currently derives from its
existing default image, not the frozen trial. The hardware initializer and its
ROM/sentinel counts must be generated from the exact candidate when the separate
production profile is implemented. Do not merely remove the simulation check.

Therefore running the normal synthesis command now would not implement the
tested configuration. No default generator, initializer or constraints were
modified during this audit.

## Remaining release work

Complete profile-aware vendor readiness and final bitstream provenance.
Perform generated-RTL replay and full UART reload checks before synthesis.
These remain separate gates; passing a constructor/configuration audit is not
sufficient evidence of synthesis or hardware readiness.

The retained `reload-evidence/new-layout-amoeba-runtime/build-configuration-audit.json`
records source hashes and both blockers. Reproduce with a fresh output filename:

```
python3 scripts/check_guarded_build_configuration.py /tmp/new-layout-config-audit.json
```

Exit 2 means input wiring is blocked; exit 0 means only that input wiring matches.
`readyForSynthesis` remains false until the remaining release gates are closed.
The audit only reads files; it
does not elaborate RTL, start vendor tools, access hardware or change saved data.
