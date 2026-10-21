# Native Mint slot-preparation package

The private blocks between `BEGIN NATIVE SLOT PACKAGE` and
`END NATIVE SLOT PACKAGE` in `simulator/cloomc/mint.cloomc` implement the
agreed FPGA-first field calculations. They are not a separate service LUMP.

## Inputs and outputs

| Register | Input |
|---|---|
| DR8 | Allocator-supplied physical **byte** address, word aligned |
| DR6 | Nonzero allocation size in words, at most 2^21 |
| DR7 | Reserved slot number, 2–65535 |
| DR2 | Current slot version, 0–511 |
| DR3 | Trusted slot-history indication: 1 if never used, otherwise 0 |

The allocator must already have validated the actual reserved memory extent.
The history indication is not inferred from an empty slot or version zero.

On success, DR8–DR11 contain W0–W3 and DR12 is 1. DR1 is zero: preparation
is not CREATE completion. On retirement, DR12 is 0, DR4 is 511, and W1–W3
are zero. The package does not persist retirement or select another slot.
Malformed inputs hard-fault.

DR5, DR6, DR7, DR8 and every CR are preserved; remaining DRs and condition
flags are scratch. Normal architectural DR-home updates still occur.
The package performs no explicit memory writes or Namespace reads, and does
not issue authority.

## Agreed calculations

- W0: allocator's physical byte address unchanged.
- W1: inclusive word limit `size - 1`, new sequence in bits 21–29, F/G zero.
- Sequence: first use at zero; otherwise current + 1; 510 advances to retired
  511 and 511 stays retired. Never wrap.
- W2: `ROL32(W0,7) XOR ROL32(W1 & 0x3FFFFFFF,13) XOR 0xDEADBEEF`.
- W3: Inform DATA RW B=1 GT for the slot and new sequence; Phase 1 T equals GT.

The sequence and integrity helpers use single-site local BRANCH entry and
fixed continuations under the same CR14. They do not create opcode-7 frames
or consume Mint's enclosing CALL continuation. They are not recursive or
general multi-caller functions.

No new rotate or XOR instruction is assumed. Rotates use SHL/BFEXT/BFINS;
three-way XOR uses the parity of three bits, repeated 32 times. The loop uses
register-form MCMP because immediate comparison lowering uses DR15 as scratch.

## Verification and integration boundary

`node simulator/test_mint_slot_descriptor.js` executes the exact source blocks
in disposable simulator memory and compares their output against the FPGA's
Python integrity and GT-encoding reference functions. Tests cover first use,
increment, retirement, field boundaries, malformed inputs, preserved context,
and absence of non-register-home memory writes.

### Full-core RTL replay

Run `python3 -m pytest tests/hardware/test_mint_slot_core.py -q` for the
private `ChurchCore(iot_profile=False)` replay. The image emitter
`tests/hardware/mint_slot_image.js` extracts the source blocks, assembles them,
and checks equality with the native CLOOMC compiler body. It does not translate
instructions to make them pass. Fetch follows RTL NIA, including local branches;
Python reference functions are expected-output oracles only.

The 19 replay tests pass: first use, ordinary increment, 509→510, retirement
at 510/511, limit boundaries, malformed inputs, physical-byte location,
F/G clearing, W2 integrity and exact W3 equality. The 32-iteration integrity
loop executes in RTL, including an immediate-MCMP mutation that demonstrably
corrupts W2.

The initial replay exposed legacy signed-15-bit backward branches in shared
code generation. With user approval, code generation, simulator execution
and disassembly were aligned to the existing RTL's register index plus/minus
18-bit magnitude (subtract bit 18). No RTL behavior or instruction was added.
Saved binaries were not rewritten; legacy backward-branch words must be
recompiled explicitly before use with this instruction format.

A separate full-core compare-form test checks DR15 directly: register-form
`MCMP DR4, DR0` preserves the live `0xDEADBEEF` constant; immediate-form
`MCMP DR4, #0` lowers to ISUB writing DR15. It does not stand in for executing
the whole integrity loop.

The harness exits the boot privilege window before replay, seeds nonzero
capabilities and heap state using test-only setup, and checks every execution
cycle for capability changes or memory/Namespace/C-list bus accesses.
Its synthetic context is not proof of legal Mint provisioning, an operational
allocator, enclosing CALL setup, or outward RETURN behavior. No saved LUMP,
boot image, Namespace configuration or physical board is changed.

This passing full-package RTL replay does not establish synthesis, timing
closure, or physical FPGA acceptance.

Shared branch regressions run with `node simulator/test_branch_rtl_encoding.js`,
`node simulator/test_idx1_runtime.js`, and
`node simulator/test_idx1_execution_envelope.js`. These cover generated loops,
IDX1 admission/execution and server/browser target parity.

The broader bootstrap-resident-identity validation is not acceptance evidence
for this change: this checkout lacks historical catalog inputs expected by
those tests (including the archived `7ccff26f` manifest record), and its
approval inventory refers to absent historical bodies. The tests report 11
failures and 37 passes. No catalog or approval files were repaired or fabricated
to bypass those checks. The broad assembler suite also has an independently
reproduced pre-change constructor failure.

The old Mint allocator still supplies a pool-relative offset rather than
the agreed physical byte address, and does not yet supply trusted version
and never-used inputs. `TODO_CREATE_BIND_DESCRIPTOR_INPUTS` intentionally
blocks that connection. Once those inputs are supplied, enter
`create_descriptor_prepare`; its continuation checks DR12 before entering
the slot-write path. Later Namespace eligibility/publication and GT issuance
remain separate unfinished steps. No live LUMP or boot image is changed here.
