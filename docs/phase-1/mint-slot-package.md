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

This is not full-core RTL execution, synthesis/timing evidence or physical
FPGA acceptance.

The old Mint allocator still supplies a pool-relative offset rather than
the agreed physical byte address, and does not yet supply trusted version
and never-used inputs. `TODO_CREATE_BIND_DESCRIPTOR_INPUTS` intentionally
blocks that connection. Once those inputs are supplied, enter
`create_descriptor_prepare`; its continuation checks DR12 before entering
the slot-write path. Later Namespace eligibility/publication and GT issuance
remain separate unfinished steps. No live LUMP or boot image is changed here.
