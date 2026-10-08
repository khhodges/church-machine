---
name: Generated RTL replay pitfalls
description: Constant combinational emission and preserving the elaboration used by model-side debug observations.
---

Model simulation success is not evidence that emitted plain Verilog simulates
identically. Check constant-only combinational blocks with a four-state simulator.

Derive post-instruction capability expectations from the instruction's memory
inputs and semantics, not the reset/bootstrap seed.
**Why:** A replay incorrectly expected the bootstrap Namespace GT to survive
the first LOAD. That assertion obscured successful initialization and a correct
loaded limit; the LOAD legitimately replaced the GT field.
**How to apply:** Keep exact full-capability checks, but distinguish reset and
post-LOAD states. Inspect mismatching fields before changing RTL or masking
fields out of an assertion.

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

**Why:** The saved timed-out compilation completed successfully with a longer
diagnostic deadline and its four-state RTL replay passed; that did not execute
the enclosing Python negative-consumer assertion.

**How to apply:** Keep compiler, enclosing case and full sequential matrix
budgets consistent and bounded. Report saved replay success separately from
the negative-consumer test and complete fresh release evidence.