# Side-by-side starter: one new bitstream, three proofs

## User-approved goal and preservation rule

Develop the new starter alongside the working system. Never stop what already
works. Existing source packages, generated bitstreams, saved review Namespaces,
LUMP revisions and working hardware remain intact.

The earlier two-variant export remains historical evidence. Do not run its
instructions to create two new bitstreams for this demonstration.

This document records the direction, not an implementation or qualification
result. No new starter bitstream has been built or programmed.

## Demonstration sequence

Use the USER B scenario as the proposed starter workload. Equip the new starter
hardware for all three operations, rather than baking scenario-specific
addresses and a five-word payload into its loading contract.

1. **Lazy Load:** USER A waits on an absent LUMP while USER B progresses.
   SYSTEM obtains and validates the complete LUMP, then the original CALL
   completes. Preserve evidence of the request, delivery, installed bytes,
   USER B progress and original CALL continuation.
2. **Namespace image replacement:** load the All Waiting application image
   into the new test setup without synthesizing or programming a second
   bitstream. Record the unchanged FPGA configuration and both distinct image
   hashes. Do not use the preserved working setup as the replacement target.
3. **Same-size LUMP upgrade:** stage old and new revisions side by side.
   Check equal allocated size before adoption. Demonstrate a changed result
   from the new revision without disguising a Namespace reload as a LUMP
   upgrade. Retain the old revision and its valid active continuations; never
   overwrite code still executing. Reusing a slot or redirecting capabilities
   requires the normal identity/version rules, not fabricated authority.

## Boundaries still to implement and verify

- Protected lazy-CALL handoff and watchdog behavior on the new starter.
- A validated complete-LUMP delivery path instead of the fixed fixture copy.
- Namespace image installation on that same starter hardware configuration.
- Side-by-side revision allocation and safe caller adoption, with old calls
  able to finish against their original revision.
- Rejection of size mismatch and failed validation without damaging the old
  working revision.

Same size does not make an in-place overwrite safe. This direction does not
claim that concurrent revision adoption already exists.

Physical testing requires a separately identified test target. Neither building
the candidate nor recording this direction authorizes replacing the working
board's configuration, stopping it, or transferring to it.
