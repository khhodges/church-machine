# Method-dispatch release gate

Run `bash scripts/run-all-tests.sh method-dispatch-rtl-release` (or select the
matching validation workflow). `--group release` includes this gate and the
existing Wukong release-bundle check. An unfiltered test run deliberately skips
this expensive replay; it is not complete firmware-release evidence.

The gate creates an unapproved SelfTest candidate in `/tmp`, then replays all
13 dispatch fixtures and that exact candidate through the same-elaboration
observation recorder, the actual `hardware/gen_rtlil.py` conversion pipeline,
and four-state Icarus comparisons. It cannot resume, omit SelfTest, use an
alternate emitter, or accept a partial report. The standalone diagnostic
runner's `--first-case` option is not release evidence.

Workers default to two, with a maximum of four. Yosys conversion is limited to
120 seconds, each Icarus compilation to 600 seconds, simulation to 60 seconds,
and the entire matrix to 14400 seconds (four hours). The isolated negative-consumer
test has a 900-second outer deadline. These enclosing budgets allow conversion,
model recording and cleanup as well as compilation; the matrix budget covers
all 14 cases even with `--jobs 1`. They are maximum durations, not expected
run times. A saved release fixture compiled successfully in 470 seconds on the
validation droplet, exceeding the former 180-second limit.
The gate kills the matrix process group
on deadline. Missing tools, timeouts, compiler errors, simulation errors,
unknown-value mismatches, and changed inputs all fail the gate.

The printed temporary directory retains `candidate.log`, `replay.log`, the
candidate bytes and review metadata, and `evidence.json`. Successful evidence
includes every result plus SHA-256 hashes for source and candidate inputs,
checked again after the run. Recorder failures also retain generated RTL,
testbench, and available compiler/simulator logs in a printed temporary
directory. Evidence is valid only for those exact inputs, not for later edits.
No output is an approval or permission to install or flash anything.

The workflow first runs policy tests, including an isolated deliberately
incompatible method-table consumer. That consumer must be rejected, not counted
as a successful release replay. These checks do not synthesize an FPGA or
replace the separate end-to-end Wukong build validation.