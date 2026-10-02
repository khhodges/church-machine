---
name: Generated RTL replay pitfalls
description: Constant combinational emission and preserving the elaboration used by model-side debug observations.
---

Model simulation success is not evidence that emitted plain Verilog simulates
identically. Check constant-only combinational blocks with a four-state simulator.

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