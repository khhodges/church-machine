# SWITCH Instruction — Lifecycle and Chain of Trust

## Contract

**Phase 1 fixed destinations — approved:** SWITCH loads the destination
Namespace into CR15 and then activates its slot-2 Thread into CR12. Ordinary
`CHANGE CRn` instead selects its incoming Thread GT from CRn and activates
CR12 without changing CR15. There is no general-purpose isolated-register
LOAD through CHANGE or SWITCH in Phase 1. Context save/load still changes
the associated execution state. CR13 stays reserved.
This settles destinations, not the pending exact instruction-field allocation.

For Phase 1, CHANGE is THREADSAVE → THREADLOAD; SWITCH inserts LOAD
NAMESPACE(CR15) between those halves. CR13 is reserved NULL and never touched.
The earlier blanket CR12–CR14 isolated-LOAD qualification is not reaffirmed.
The existing CR15 form performs the complete
Namespace-and-Thread handoff defined in the master ISA. It is not a register
swap, a PassKey install, or an authority carried by the source.

These are architectural requirements, not a claim that existing simulator,
RTL, saved programs, or boot images already implement the CR15 correction.

At instruction acceptance the machine latches the complete destination index
and that destination register's M bit. Execution succeeds only when:

1. This approved handoff uses CRd=CR15; CR13 is not an available destination.
2. The latched CRd.M value is set.
3. CRs is exactly CR0–CR11 and holds a valid ordinary c-list capability with L permission.
4. `CRs[row]` passes the normal LOAD bounds, version, integrity, and type checks.
5. Reserved encoding bits are zero.

Retain the destination field without aliasing/truncation. Other destinations
are not approved by this Phase 1 handoff contract. Source M is never consulted.

## M-bit device and custody

M is per-register machine state, not a seventh GT permission and not part of
the `{R,W,X,L,S,E}` field. A dedicated I/O object exposes one 32-bit register.
Bits 0 through 15 are CR0.M through CR15.M; writing 1 sets the corresponding M
bit and writing 0 clears it. Bits 16 through 31 are reserved.

The object has one Namespace-table entry like the other hardware I/O registers.
Only the Namespace abstraction receives its capability during
initialization. Ordinary abstractions cannot mint, discover, attenuate into, or
use them. A capability missing from the caller's c-list, issued to another
abstraction, bound to another CR, addressed at the wrong port, or lacking the
required right fails closed without changing M.

## Operation lifecycle

Successful combined `SWITCH CR15` never loads, restores or clears CR13.
No IRQ Thread is installed in Phase 1. Ordinary CHANGE leaves CR15 unchanged.

1. Namespace presents the M-bit I/O capability and writes the complete M word.
2. The instruction decoder accepts `SWITCH`, latching CRd and CRd.M.
3. The destination and encoding are validated.
4. The ordinary LOAD pipeline validates `CRs[row]`. No source-M bypass exists.
5. For CR15, the validated value must identify a Namespace: save the outgoing
   Thread under the old Namespace, load CR15 at the microcode midpoint, and
   activate the destination's slot-2 Thread using a hardwired permissionless
   Inform GT with version 0. Successful handoff consumes CR15.M.
6. A subsequent SWITCH to that register fails until Namespace authorizes it
   again through the matching device capability.

The latch prevents a concurrent or later M-device transition from changing the
authorization decision for an already accepted instruction.

There is no ordinary instruction boundary inside the CR15 handoff, no extra
Thread operand, and no required following CHANGE. Fixed entry selection must
still validate the actual descriptor, version, Thread, frame, and C-List.

## Fault behavior

An M-clear destination faults with `PERM_L`. A CR0–CR11 destination, CR12–CR15
source, or malformed encoding faults with `INVALID_OP`. A NULL or non-L source,
out-of-bounds row, stale token, or integrity failure faults before
source admission completes. An executed SWITCH targeting CR13 faults
`INVALID_OP` before any instruction effects, including Thread save or source
admission effects. Condition-false instructions skip the CR13 check and have no
instruction effects. The same rule applies to `CHANGE CR13`; CR13 is not an
enabled isolated-load or Thread-activation path. Independent fetch/encoding
faults are not waived.

For CR15, outgoing-save writes are not transactionally rolled back if a later
phase fails. Default to hard fault, not retry, alternate target, silent repair,
or continued execution of partial state. Fault attribution follows the GT in
the faulting CR. Hardware and transition/fault microcode never change versions;
authorized software management owns version-based blacklisting. A stale GT
still faults without causing another slot-version change.

Conditional instructions whose condition is false are skipped normally and do
not consume M authorization.

## Boot and recovery

Bootstrapping isolated registers is a trusted boot operation. After boot,
runtime reauthorization is exclusively the Namespace-owned M-bit device
protocol above. Successful SWITCH consumes the destination's M state; faults
do not silently grant, move, or infer M. A Boot Thread fault leaves the CM in
purgatory. Do not assume management remains reachable or add a new recovery
strategy to complete a failed Namespace handoff.

## Security consequences

- A capability with L can supply the loaded value but cannot authorize its
  placement into an isolated register.
- A source carrying unrelated machine metadata gains no additional authority.
- Device capability attenuation cannot change its bound destination.
- CR12–CR15 retain the existing encoding and destination-M authorization;
  only CR15 adds the Namespace/Thread transition.
- The Namespace/device boundary, not an Abstract sentinel value, is the root
  of runtime SWITCH authority.

## CapabilityTest provisioning

Namespace initialization actually sets CR12.M with its private CR12-bound
M-bit device capability immediately before CapabilityTest execution, and
leaves CR13.M clear for the negative case. This is an explicit initialization
step, not a test assumption. CapabilityTest then demonstrates one successful,
M-consuming CR12 SWITCH followed by the CR13 `PERM_L` path.

## Related files

- `docs/instruction-set.md` — concise instruction definition
- `docs/isa_reference.md` — encoding and faults
- `docs/namespace-security.md` — LOAD validation and Namespace custody
- `scripts/disasm_lump.py` — canonical decoding
- `simulator/examples/capability_test.cloomc` — M-present/M-absent artifact cases