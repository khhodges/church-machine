# Ordinary SAVE metadata authority

`node tests/simulator/sim_save_s_only.js` runs disposable, assembled instructions
through real fetch/decode/step and capability gates.

## Expected behavior

The current [master ISA](../../docs/instruction-set.md#compact-indexed-loadsave-operand)
selects compact c-list indexing, not a data-read instruction.
[Golden Token permission domains](../../docs/golden-tokens.md) assign S to
c-list writes and R to data reads; mixing the two domains is invalid.
[LUMP structural rules](../../docs/CM_LUMP_SPECIFICATION.md#structural-mutation-rules-for-load-and-save)
restrict SAVE to rows 1 through cc−1.

Consequently, reading the header internally to locate SAVE's c-list uses the
same S authority as writing its selected row. It does not expose header data
to a DR or confer R. Namespace generation, seal, and header-address checks
still run. The exported GT must independently pass the ordinary B/export
gate. Destination S is not replaced by a register M bit; the existing isolated
source-register M authorization and consumption rules remain unchanged.

The assembled spelling used here is `SAVE CR1, CR8, #1`: CR1 supplies the
exported GT and CR8 supplies the c-list view. The reversed operand prose in
the older `isa_reference.md` SAVE entry is not the fixture's encoding oracle.

## Reproduction and scope

Before the fix, the assembled S-only case faulted at the header access with
`PERMISSION: SAVE CR8 lump-hdr: ... lacks R permission`, after its B=1 input
passed export validation. The regression now requires retirement, an exact GT
write, and readback through a separate L-only view. It checks both metadata
and row access under S and confirms that S cannot perform DREAD.

Negative cases cover unprivileged R/E/L views, B=0 exports, malformed tokens,
source and destination generation/seal/Namespace bounds, header-address and row
bounds, index overflow/underflow, SELF protection, and register M behavior.
They observe real fault snapshots and verify the c-list remains unchanged.

All initial descriptors and registers are synthetic **test privilege**, following
`tests/mint_phase1/result_containment_probe.js`. The ordinary success case uses
a domain-pure, B=1 Inform input and no M elevation or CR6 exception. This is
instruction evidence, not functional Mint provisioning, hardware qualification,
or authorization to install a LUMP or change a live Namespace.

## Adjacent validation limits

The focused SAVE suite, the original result-containment probe, the CR6 L-permission
LOAD suite, and the LUMP binary suite pass. Two broader suites also fail with the
original R-gated SAVE restored **in memory only**, so they are not evidence of a
regression from this change:

- `simulator/test_compact_load_save.js`: its compiler-worker fixture lacks current
  explicit method declarations and a canonical dot-name.
- `simulator/test_capabilitytest_save_roundtrip.js`: its initial LOAD loop fails
  before reaching the SAVE cases.

These remain real failing checks; neither was skipped or weakened to claim a pass.
