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

## Native allocator binding

`create_data_allocate` now reaches the package directly through ordinary native
instructions. It loads MintState RW and MintPool RW from Mint's own C-list;
caller scratch never supplies address or history. This is FPGA-targeted CLOOMC,
not a host allocator hook or an RTL change.

MintState's private software layout is:

| Word | Meaning |
|---|---|
| 0 | LUMP header |
| 1 | Pool word-offset cursor |
| 2 | Exclusive pool word-offset end |
| 3 | Free-slot queue cursor (at least 7) |
| 4 | Exclusive free-slot queue end |
| 5 | Physical **byte** base matching MintPool RW's offset-zero address |
| 6 | Word offset of the slot-indexed history table |
| 7 onward | Queue of slot numbers; queue end must not overlap history |
| history base + slot | Bits 0–8 current version; bit 9 never-used; bit 10 reserved; higher bits zero |

Trusted provisioning must bind the physical base to the actual capability,
exclude metadata from the allocation interval, and initialize authoritative
history. This is an explicit provisioning obligation, not a new machine
interface or a claim that ordinary native code can inspect a CR's cached base.
Empty Namespace words do **not** establish never-used history. State must not
alias the pool, executable, Thread homes or public writable objects. The final
MintState c-list scratch word used for the Phase 1 credential comparison must
also remain outside queue/history storage.

Before reservation writes, the native allocator checks size, capacity, queue
geometry, slot width, history bounds/flags and actual pool bounds through
DREAD. It checks byte-address alignment and shift/add overflow, then produces
DR8 = base + cursor * 4 and reads DR2/DR3 from history. All ordering comparisons
on addresses/cursors are unsigned. DR6 and DR7 retain size and slot.

The real package continuation checks DR12. Success records the resulting
version with reserved=1 and never-used=0, advances the two cursors, then zeros
exactly the reserved interval while preserving W0–W3. Recording reservation
before cursor mutation prevents duplicate queue entries or retry after a
later fault from issuing the same slot twice. A fault can leak a reservation;
no rollback or recovery is promised.

For 510→511 or already-511, the continuation persists 511 and hard-faults.
Pool bytes and both cursors remain unchanged; repeated attempts still fault.
It neither wraps nor silently skips retired slots. Release must retain the
issued version and clear the reserved flag only after lawful destruction:
CREATE owns the next increment, not both release and CREATE.

`node simulator/test_mint_allocator_descriptor.js` runs the contiguous native
allocator, package, reservation and zero loop in disposable RAM with real
C-list loads and memory instructions. It checks first use, used-zero, 509→510,
retirement retries, duplicate slots, malformed state, exhaustion and unchanged
unallocated bytes. The existing native-path suite includes this regression.
Test setup provisions capabilities and private state; it does not prove legal
production provisioning or modify a running service.

### CREATE publication and issuance

The complete editable Mint source now compiles. The native CREATE continuation
loads the private `ide.MintNamespace RW` binding, checks reserved history and
an empty destination, writes and compares W0–W3, then materializes CR1 through
MintState's existing private scratch C-list row and ordinary LOAD. The scratch
row is erased after loading. It validates exact result identity, DATA RW, B=1,
slot and sequence before outward cleanup/RETURN. Allocation is not debited twice.

The Namespace capability must name the actual FPGA ascending table, offset zero
at slot zero, with an appropriate bound. It is an explicit trusted provisioning
obligation, not a binding installed by this source edit. Four writes are not
atomic. A fault never returns a result; the consumed reservation and any partial
entry remain abandoned, with no rollback or recovery machinery.

DESTROY, MakeOutform and MakeInform explicitly HARDFAULT as unsupported. Their
labels no longer prevent CREATE compilation, but they are not implemented.

`node simulator/test_mint_create_publication.js` checks compilation, isolated
native result issuance through real CALL/RETURN, retirement/occupied-destination
faults and unsupported-method rejection. Earlier native fragment tests exercise
publication/read-back. This is **not** complete CREATE FPGA acceptance.

The legacy simulator uses descending Namespace slots and word-valued locations,
unlike this FPGA-targeted ascending/byte-address path. Its full CREATE replay
therefore cannot establish acceptance: the regression records the mismatch
without rewriting native instructions or redirecting memory accesses. Isolated
issuance fixtures provision an already-committed legacy-table entry and do not
prove subsequent access reaches the allocated physical bytes.

Still outstanding: saved-design provisioning, durable history across
reboot/release, and full-path RTL/physical execution. No live LUMP, Namespace
assignment, boot image, simulator semantics or hardware is changed.

### Branch-format compatibility

Current compiler and Python factory/ROM emitters use RTL bit 18 for subtraction
and bits 17:0 for magnitude. Historical signed-15-bit backward branches are
incompatible: saved binaries and images must remain immutable and require
explicit source recompilation and approval before execution with this toolchain.
There is no automatic binary conversion or guess based on an operand's bits.
The simulator's out-of-range branch fault explains this requirement.
`simulator/test_factory_branch_encoding.js` executes exact Python-emitted
CallHome/demo loop edges and the boot return guard, and rejects the old -1
encoding. These are disposable instruction checks, not a live boot or flash.
