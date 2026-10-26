---
name: Generated RTL replay pitfalls
description: Constant combinational emission and preserving the elaboration used by model-side debug observations.
---

Model simulation success is not evidence that emitted plain Verilog simulates
identically. Check constant-only combinational blocks with a four-state simulator.

Vivado 2026.1 can expose NSTD-1 and UCIO-1 as Critical Warning after synthesis.
An Error-only assertion must explicitly enforce Error and verify the checks
are enabled, not assume that stage already supplies the final strict severity.

**Why:** A completed droplet synthesis stopped on this default, not on an
observed missing pin or I/O-standard assignment. Local mocks had incorrectly
assumed Error by default.

**How to apply:** Keep exact board-port/pin checks, promote severity rather than
accepting weaker checks, recheck at routing, and test both promotion failure
and disabled checks. Bind any resume to unchanged inputs and the saved checkpoint.

For build-package handoffs, confirm the recipient's archive hash before treating
a successful download or SCP exit as delivery.

**Why:** The file-tree folder download produced a 22-byte empty ZIP and the
original archive was not visible to the user. A downloadable base64 text copy
was restored on Windows and the user confirmed the exact original SHA-256.

**How to apply:** Prefer the original archive when accessible. If the file UI
cannot deliver it, a text-encoded transport copy is acceptable with exact-byte
verification after decoding. Do not rename ZIP to tar.gz, rebuild different
inputs, or weaken package verification to accommodate the transfer.

Bind long-running replay evidence to the observer source and binary captured at
launch, as well as the retained design executable.

**Why:** An observer can be edited while a simulation still uses its already
loaded plugin. Hashing the source only at completion can misattribute results.

**How to apply:** Preserve earlier observer binaries; change observations in a
separate build without modifying the frozen design, and record both identities.

An internal bus name surviving optimization does not mean every bit remains
observable. Verify the frozen netlist's unused-bit metadata and actual drivers
before requiring a whole internal word to be known.

**Why:** The mapped retirement observation retained its opcode drivers but not
unused operand bits; a whole-word VPI check falsely rejected known instruction
fetches. This is an observation boundary, not permission to suppress X values.

**How to apply:** Bind the observed-bit contract to the exact netlist hash.
Report removed bits as unavailable, never as zeros or reconstructed words.
Continue failing on unknown live/control bits; a fully preserved debug word
requires separately identified instrumentation, not a claim about frozen RTL.

Also run structural RTL conversion when changing acceptance/busy multiplexers.
Do not select a unit's busy output using its accepted-start signal.

**Why:** Accepted start is qualified by the core's aggregate busy signal.
Selecting busy with start closes a combinational loop that behavioral simulation
may settle, while netlist conversion rejects it.

Read-address selection must also be independent of accepted start in both the
arbiter and the selected unit's idle logic. A registered busy selector alone
does not remove feedback hidden in a mux input.

**Why:** Structural conversion traverses both mux inputs; logical exclusivity
does not make a start → operand read → permission result → start path safe.

**How to apply:** Derive read selection from decode/state, then use permission
results to gate acceptance and state changes. Cover both NULL and missing-rights
targets, with an unrelated register deliberately holding valid authority.

**How to apply:** Keep busy selection registered; acceptance-cycle overrides
should affect only the operand-read path, not the whole output bundle.

Subsystem mapping evidence must preserve the production clock/reset domain.
Extract the actual subsystem from the same full-top elaboration rather than
re-elaborating a standalone replacement with an implicit reset.

**Why:** A reset-bearing standalone initializer can map differently from the
reset-less production initializer even when its reset pin is tied inactive.
Passing that substitute does not close the production mapping question.

**How to apply:** Retain the original boundary and input hashes, map the
extracted fragment, and state separately whether the surrounding system was
word-level synthesized or fully technology-mapped.

Where successful mLoad completions are established, accept that the intended
Namespace slots were found; do not pursue a hypothetical alternative Namespace.
Do not equate a GT-only trace payload with a completed, no-fault load, or combine
different trace excerpts and snapshots without matching execution identity.

**Why:** The user explicitly set this diagnostic boundary after repeated
discussion of whether plausible results could come from unrelated memory.

**How to apply:** Investigate the discrepancy between successful slot lookups
and the reported zero CR15 state, rather than trying to explain the successful
lookups as random data.
Keep the existing build and memory layout unchanged while diagnosing this
failure; the user wants the defect understood before any corrective changes.
**Why:** Replacing the layout or boot privilege behavior during diagnosis would
change the system whose failure is being explained.
Review simulation one instruction at a time before adopting its observations
as expected results for physical single-step tests.
**Why:** The user selected this workflow to resolve conflicting LOAD trace and
snapshot evidence. Simulation agreement is not automatic ISA approval.
**How to apply:** Read full committed register storage, preserve approved inputs,
label the exact model, and pause for review before advancing the walkthrough.
Physical stepping and reset still require separate authorization.
CR8 must not be used as an architectural scratch register for boot CHANGE.
**Why:** The user explicitly rejected CR8 involvement in the Thread/Heap setup.
**How to apply:** Treat observed CR8 writes as an implementation discrepancy,
not an ISA requirement; diagnosis does not authorize a corrective RTL change.
All CM implementations must follow the authoritative ISA; successful boot is
not permission to substitute hidden authority for required architectural state.
**Why:** The user emphasized that CM integrity depends on conformance in every
implementation, not merely matching visible output or reaching an instruction.
**How to apply:** Derive acceptance expectations from the ISA, flag divergence
as release-blocking, and never adopt a model's observed defect as the FPGA oracle.
The agreed direction is a systematic ISA-conformance audit and correction of
all discovered deviations before approving a replacement bitstream, not another
isolated boot patch.
**Why:** The user rejected piecemeal boot success as an adequate integrity gate.
**How to apply:** Track requirements and evidence for each instruction and its
supporting protection/context mechanisms across assembler, IDE simulator, RTL,
mapped design, and eventually the identified physical image. Resolve unspecified
ISA details rather than inventing them; disclose unverified coverage. Building,
programming, and board operation remain separate authorization boundaries.

Name the implementation whenever reporting a simulation result.
**Why:** Calling both the JavaScript IDE simulator and an HDL circuit replay
"the simulator" led to confusion about which implementation violated the ISA.
**How to apply:** Say IDE simulator, optimized hardware-model replay, or mapped
netlist simulation explicitly. None proves historical build approval or the
programmed image without exact provenance.

Validate state capture separately from execution and correlate by occurrence.
**Why:** GT trace values and accepted full snapshots gave conflicting accounts;
a CRC proves packet integrity, not that the correct registers were sampled.
**How to apply:** Compare committed register writes, emitted trace, snapshot,
and IDE display for the same instruction. A zero GT does not establish a zero
base/limit. Do not dismiss either record or infer different runs solely from
displayed timestamps.
The intended correction for the existing 64-slot table is to seed CR15's limit
with 63, not a temporary 18 that a later mLoad is expected to correct.
**Why:** The user prefers a consistent bootstrap state rather than relying on
mLoad to repair it. This does not waive normal LOAD destination writes or
authorize applying the correction before the diagnostic walkthrough finishes.
The user confirmed the key distinction: zero is also the intended Wukong
Namespace base, so a zero-valued base can still locate the correct descriptors;
the incorrect zero limit is a separate question. Do not infer a wrong table
address solely from an all-zero CR15 snapshot.

Derive post-instruction capability expectations from the instruction's memory
inputs and semantics, not the reset/bootstrap seed.
**Why:** A replay incorrectly expected the bootstrap Namespace GT to survive
the first LOAD. That assertion obscured successful initialization and a correct
loaded limit; the LOAD legitimately replaced the GT field.
**How to apply:** Keep exact full-capability checks, but distinguish reset and
post-LOAD states. Inspect mismatching fields before changing RTL or masking
fields out of an assertion.

Budget integrated replay time for UART trace backpressure, not just core cycles.
**Why:** At 57,600 baud, two 12-byte events consume about 4.17 ms and three
consume about 6.25 ms. A 10 ms replay passed initialization and the first LOAD
but stopped at the boot CALL before the trace traffic could drain.
**How to apply:** Allow for the startup banner and each instruction's event
count, observe trace-drain/halt state, and retain a bounded wall-time budget.
Do not call a short timeout a core stall or force away trace backpressure to
claim equivalence with the retained hardware.

The user authorized a separate experimental bitstream build in parallel with
the long Mallory replay, with the user running Vivado on the droplet.

**Why:** Exact mapped-design replay is slow at production UART timing; the user
wants vendor build evidence in parallel rather than waiting serially.

**How to apply:** Freeze the same inputs, retain the previous build, enforce
vendor timing/physical-I/O checks and mark unresolved execution/reload gates.
Experimental synthesis is not release certification or board-programming
authorization; never weaken the legacy release guard to enable it.

Treat unassigned top-level debug ports as a board-safety review requirement,
even when retained constraints downgrade NSTD-1 and UCIO-1 to warnings.
**Why:** The frozen board XDC describes debug outputs as internal-only, but
the routed I/O report assigned them real package pins with default LVCMOS18
standards; utilization reported 72 bonded IOBs, only six fixed. The 66 debug
outputs are not disconnected merely because NSTD-1/UCIO-1 were downgraded.
**How to apply:** Inspect the routed I/O report and actual buffers before
approving a bitstream. Preserve the original reports; do not infer safe pin
usage from a successful routing exit or waive negative setup slack.

When synthesis folds a registered ROM address into a synchronous BRAM read,
check the initial output and first enabled read, not only the ROM contents.

**Why:** The inspected Wukong netlist feeds next-counter bits into the BRAM
address, enables its read with the initialization write, and initializes the
output to zero. Retained behavioral ROM entry zero instead contains a nonzero
Namespace limit. The initialization-write waveform confirmed that the first
expected address/data pair was replaced by a zero write to address zero;
every subsequent pair matched the retained ROM. Correct INIT contents alone
therefore do not establish startup equivalence.

**How to apply:** Capture the first initialization writes before proposing a
fix. Compare addresses, data, enables, and initial outputs against the retained
elaboration; do not infer equivalence from later valid entries or clean timing.
Require a valid ROM output before the first write and verify both the first
and final entries through the synthesized mapping, not behavioral RTL alone.

Check whether the primitive library implements functional behavior before
interpreting unknown mapped-BRAM output. The local Yosys RAMB36E1 model can
contain timing declarations without functional behavior.

**Why:** Such a stub can compile successfully but return unknown ROM data.
Generic gate synthesis is independent evidence, not vendor BRAM equivalence.

**How to apply:** Preserve failing logs and model hashes. Xilinx's public
XilinxUnisimLibrary supplies functional XC7 primitives loadable by Icarus with
a library directory and separate `glbl` root. Pin its revision and retain model
bytes; use an explicit timescale for global startup reset. Passing this replay
is not proof of Vivado synthesis or a routed design.

Separate fetch/write phases alone do not establish startup correctness.
**Why:** Synthesized replay of the two-phase initializer still started the ROM
at entry one: the fetch phase enabled only the BRAM output register, while
the array read occurred in the write phase. Stable half-cycle observations and
the actual RAM clock edge confirmed a zero write to word zero. Extra waiting
alone cannot recover an entry that the mapped address path never requests.
**How to apply:** Verify entry-zero addressing and array/output-register enables
in a small synthesized initializer test before another full-system synthesis.
Keep first-entry and final-entry evidence mandatory; model tests are insufficient.

Preserve the real reset-less clock domain in reduced startup reproductions.
**Why:** Adding a synchronous reset can change register-to-ROM folding and
provide extra array reads before enable, masking the initialization defect that
the reduced test is meant to reproduce.
**How to apply:** Use the original reset model and export its clock explicitly;
require the baseline failure to reproduce before calling a candidate a
controlled fix.

Distributed ROM is a supported candidate remedy for the startup retiming defect,
not a full-system release approval.
**Why:** A paired synthesized initializer experiment reproduced the baseline's
zero first write, while the distributed-ROM candidate passed the complete
retained sequence with pauses and sticky completion.
An additional paired test using the extracted original startup controller and
the complete frozen ROM also reproduced the baseline's zero first write and
passed every candidate write with distributed mapping. This rules out the
replacement two-phase controller being necessary for that isolated remedy.
**How to apply:** Preserve the ROM mapping constraint through the release
emission pipeline, verify absence of block RAM for this ROM, and repeat the
exact-payload comparison plus boot validation in the integrated netlist.

For synthesized-waveform checks, reconstruct memory data from the physical
RAM primitive pins rather than assuming a surviving named bus is full-width.
**Why:** Synthesis can split or narrow the original write-data bus while routing
its remaining bits through separate logic. Checking the truncated bus can
incorrectly diagnose missing high bits.

**Why:** With Amaranth 0.5.9 and Yosys 0.51, partial constant GT assignments were
emitted as `always @*` blocks with empty sensitivity lists. Icarus never ran
them, leaving bits unknown and blocking Namespace initialization; the equivalent
SystemVerilog `always_comb` emission passed. This does not itself prove an FPGA
synthesis defect.

**How to apply:** Report SystemVerilog success separately from default-Verilog
failures. Check the actual release emission pipeline before granting release
confidence; never silently initialize unknown bits to force a passing replay.

Do not infer that the board release must switch to SystemVerilog from this
failure alone.

**Why:** The bare converter and the Wukong release converter use different
lowering stages. The inspected board output had continuous constant assignments
where the bare output had empty-sensitivity blocks. That inspected output was
stale, so it was evidence of the distinction, not proof of current conformance.

**How to apply:** Replay through the actual release conversion stages using
fresh temporary inputs before recommending an emitter or dialect change.

Replay instrumentation must use the same elaborated design as the model run.

**Why:** Re-elaboration creates fresh internal signals, while debug observations
can still refer to the original signals. A prepared Amaranth fragment also
contains inherited clock-domain copies and needs explicit clock/reset ports
when wrapped for emission.

**How to apply:** Preserve the recorded elaboration and its observed expressions;
avoid a second independent elaboration of the DUT under the old debug taps.

Keep the full method-dispatch release replay outside the default IDE test loop.
Partial/resumed diagnostic runs are not release evidence.

When a fully bit-lowered frozen Verilog replay is impractically slow, a
hash-verified retained RTLIL elaboration can be converted with
`proc; flatten; opt; write_verilog` for a separate diagnostic replay.

**Why:** Preserving word-level operations can make the retained elaboration
tractable without importing or re-elaborating today's source. This is not
equivalent evidence to replaying the final bit-lowered release file.

**How to apply:** Label the conversion and evidence boundary explicitly, retain
cycle limits and logs, and never treat a shell exit of zero at a testbench
timeout as a passing boot. Include the bridge's UART inputs before claiming to
reproduce a physical run that used automatic halt and snapshot commands.

**Why:** Each Icarus compilation is expensive, and a partial run cannot establish
that the complete matrix and the exact SelfTest candidate passed together against
unchanged source. Boot harness imports also depend on the selected artifact
catalog, shared architecture contracts, and server approval validation.

**How to apply:** Use bounded workers and temporary output, hash the actual
isolated catalog as well as source inputs, and retain failure logs. Negative
consumer tests must preserve those harness dependencies or they merely test a
missing import rather than incompatible method dispatch.

Bound the effective hardware catalog, not only the test-isolation catalog, and
time out compiler process trees rather than just the `iverilog` launcher.

**Why:** Hardware catalog selection can be overridden independently of the test
runner. Icarus starts child compiler processes, which can survive termination
of their launcher and continue consuming resources after failure.

**How to apply:** Include the effective catalog in before/after hashes; keep
descendant-kill regression tests for both nonzero exits and tool deadlines.

Do not diagnose a compiler hang solely from the release compilation deadline.

**Why:** On an Ubuntu droplet, Icarus 12 compiled the preserved 8.6 MB negative
consumer Verilog successfully in 470 seconds after the 180-second gate timed
out. This establishes compilation success only, not behavioral or release
success.

**How to apply:** Diagnose saved inputs separately with a bounded command and
durably recorded exit status. Remote diagnostics should survive terminal
disconnects. Do not silently increase release limits or count partial replay
as full release evidence.

The user authorized increasing release time budgets while preserving every
behavioral assertion and failure check.

Windows archive restoration instructions must put decoding, verification and
writing inside one invoked script block with local variables and terminating
errors; never give these as separate top-level interactive statements.

**Why:** PowerShell can continue accepting later pasted statements after an
earlier statement throws. Old session bytes can then be written under a new
archive name and followed by a misleading success message.

**How to apply:** locate the actual downloaded file first, then use an isolated
script block that writes and reports success only after hash and length match.

**Why:** The saved timed-out compilation completed successfully with a longer
diagnostic deadline and its four-state RTL replay passed; that did not execute
the enclosing Python negative-consumer assertion.

**How to apply:** Keep compiler, enclosing case and full sequential matrix
budgets consistent and bounded. Report saved replay success separately from
the negative-consumer test and complete fresh release evidence.

Use a regular Tcl file for remote Vivado batch diagnostics, not
`-source /dev/stdin` with a shell heredoc.

**Why:** Vivado 2026.1 on the build droplet printed `source /dev/stdin` and
exited without observable script execution or the report-ready marker.

**How to apply:** Write a fresh temporary Tcl file, pass its path to `-source`,
and require the explicit completion marker plus the resulting report before
treating diagnostics as successful.

Distinguish the time-zero X-to-low clock initialization from an executed
falling edge in UNISIM testbenches.

**Why:** XSim reports the initialized clock output as a negedge before the
MMCM can lock; a falling-edge observer otherwise faults at time zero.

**How to apply:** Exempt only time-zero falling-edge settling. Independently
reject every unlocked rising edge and retain lock/period checks on all later
falling edges. Test delayed lock plus X-to-low initialization explicitly;
never skip an arbitrary startup interval or wait for lock before arming faults.

Keep remote vendor replay evidence distinct from locally hashed executable
replay when preparing experimental build packages.

**Why:** A user-supplied XSim transcript can report exact-input checks and
successful observation without supplying an exported executable digest.

**How to apply:** Bind the retained input archive, source fingerprint,
testbench, runner and transcript, explicitly label the evidence origin and
missing executable proof, and never invent a digest or treat boot evidence as
full-program or physical acceptance.

Use a unique purpose-and-checksum filename for user-downloaded build transport
text, and keep subsequent restore commands aligned with that exact name.

**Why:** Identical download basenames in multiple generated folders caused
repeated selection of an older package and browser duplicate-name suffixes.

**How to apply:** Include the archive checksum prefix in the visible filename;
verify decoded length and hash before any write/upload. Do not rely on a
generic basename or silently select the newest browser download.

Do not assume Vivado's reported MMCM feedback clock period equals the
calculated VCO period.

**Why:** The 25 MHz candidate's synthesized checkpoint passed the MMCM
parameter and output-clock checks but reported 20 ns on CLKFBOUT, causing a
guard expecting the 1 ns VCO period to stop before implementation.
The subsequent constrained project report confirmed an auto-derived
multiply-by-one feedback timing object from the 50 MHz input master, while
the separate output clock was correctly reported at 25 MHz.

**How to apply:** Inspect actual clock objects, generation relationships and
connectivity before choosing a feedback assertion. Keep input/output clock
checks and routed timing gates; a mock using an assumed feedback period is
not evidence of Vivado's clock model.

Capture Vivado diagnostic stdout/stderr with shell redirection, not a Tcl
`redirect` wrapper.

**Why:** The droplet's Vivado 2026.1 Tcl interpreter rejects `redirect` as an
invalid command even though opening the saved checkpoint succeeds.

**How to apply:** Run a regular temporary Tcl script and capture its process
output to a unique report file. Require a final completion marker before
presenting the file as a completed diagnostic.

Inspect synthesized clocks through the project/run context or explicitly load
the original XDC; a standalone synthesis DCP may contain no clock definitions.

**Why:** A successful standalone open_checkpoint produced an empty clock
report, while the original open_run had loaded the board XDC and checked clocks.
Vivado also lowered BUFGCE to BUFGCTRL with XILINX_LEGACY_PRIM=BUFGCE and a
reported pin map.

**How to apply:** Verify the original inputs, open the project and completed
synthesis run without relaunching it, and inspect clock objects there. Check
the lowered primitive's actual pin mapping and constant controls, not only the
source primitive name; do not treat an empty standalone report as permission
to remove constraints or bypass clock guards.

Normalize XSim escaped object names for selector matching, but retain the exact
original object when calling get_value.

**Why:** Implemented-netlist core signals appeared with a leading backslash
and trailing whitespace. End-anchored selectors silently omitted error signals,
while unanchored boot-unit selectors continued to work and masked the omission.

**How to apply:** Trim surrounding whitespace and the leading escape only in
the comparison key. Include escaped scalar/bit-select fixtures in selector tests.
Do not interpret partial optimized bit aliases as a complete zero-valued bus.

When repeated implemented-model probes expose only synthesized aliases, obtain
the hash-pinned functional netlist and trace drivers before choosing more probes.

**Why:** A generated error-related net name and a preceding pulse establish
correlation, not the original validation expression; repeated remote simulation
startup makes speculative name-based probing slow.

**How to apply:** Preserve the exact export hash, inspect its fan-in offline,
and use any next bounded replay to test a specific mapped condition.

For reconstructed register values, map implemented flip-flop Q ports rather
than assuming a surviving source-like net is the register bus.

**Why:** Vivado retained source-like names for control expressions while
renaming actual register outputs to generated nets, including `_n_0` names.
A blanket exclusion of those names silently discarded real stored bits.

**How to apply:** Require a complete bit-index-to-Q mapping and fail on missing
or unknown values. Keep mapped runtime evidence separate from static fan-in
deductions.

A clocked source-level ROM read is not sufficient evidence of correct startup.
Validate the first accepted initialization write after synthesis, including
the memory's internal read stage and optional output register.

**Why:** Source simulation passed while the implemented initializer copied a
zero startup output before the array's first read, losing the first header
word even though the ROM contents were correct.

**How to apply:** Test a nonzero first entry at address zero, and compare every
accepted write with its exact input pair. Do not repair the image, preload the
expected result in a testbench, or weaken validation to hide an initialization
sequencing defect.

For isolated synthesis regressions, require the faulty baseline to reproduce
its specific failure as well as requiring the candidate to pass.

**Why:** Synthesis context can change memory/register mapping; an isolated
baseline that already passes cannot demonstrate that a correction addresses
the full-design failure.

**How to apply:** Label baseline non-reproduction inconclusive and retain both
results independently. Require later full-design verification before promotion.

Frozen-image exports must account separately for import-time factory context.

**Why:** Selecting an explicit runtime image does not prevent boot modules from
validating factory catalog selections during import. A source-only copy failed
before elaboration because that independent read-only context was absent.

**How to apply:** Retain and hash the actual required context in the isolated
tree; never invent selection records or bypass admission. Keep it explicitly
separate from the runtime image's authority. Child interpreters also need the
parent's package search paths when workspace-installed dependencies are used.