# Combined candidate: build-only handoff

## Authorization and evidence

The user approved proceeding with preparation of a build-only runner after the
vendor initialization/boot runner and combined recovery-model runner returned
successful exit codes. The build gate independently requires the explicit
pass markers and recovery result before accepting the checkpoint.

This does not authorize programming, persistent flash writes, production RTL
replacement, live Namespace changes, or bridge commands.

## Input binding

- Exact original combined package checksum manifest is pinned.
- Model support supplement checksum manifest is separately pinned.
- Original and resumed synthesis manifests must agree on mapped RTL and DCP.
- The corrected observer may differ only by moving the counter declaration.
- Vendor boot evidence must name entry 0x4610.
- Recovery evidence must use the approved image, report continuation-resumed,
  boot completion after authorization, one fault, and 100 retirements with
  the expected third address 0x2870.
- A fresh output directory receives the checkpoint and copied evidence.
- Input/evidence hashes are checked again before and after implementation.

## Implementation

No synthesis rerun. Reuse the established implementation Tcl and clock-topology
guard. One shared flock, two Vivado threads, and a 240-minute timeout, which is
a limit rather than a duration estimate.

Verify device, board pins, 25 MHz clock topology, DRC errors, precise setup/hold
slack, and setup/hold/pulse timing summary before producing the BIT. Retain the
routed checkpoint, reports, and hash-bearing build receipt. Existing asynchronous
input exceptions remain unchanged; internal timing is not external UART
electrical timing certification.

The legacy verifier module is included only as a dependency for its tested
timing-summary parser. The new combined verifier, not its historical hardcoded
checkpoint pins, controls this handoff.

## Verification and limits

41 offline Python/Tcl tests passed, covering invalid/missing evidence, wrong
recovery results, excess observer edits, preservation of evidence, no-overwrite
preparation, isolated bundle imports, shell syntax, and pre-bitstream failures
for clock, DRC, setup/hold, and pulse timing.

These are tool tests, not a new vendor build. The droplet still must perform
placement/routing and bitstream generation. No timing result, new BIT, or
physical-board acceptance is claimed by this handoff.
