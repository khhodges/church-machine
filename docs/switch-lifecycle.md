# SWITCH Instruction — Lifecycle and Chain of Trust

## Contract

`SWITCH CRd, CRs, #row` is the special LOAD form for isolated capability
registers CR12–CR15. It is not a register swap, a PassKey install, or an
authority carried by the source.

At instruction acceptance the machine latches the complete destination index
and that destination register's M bit. Execution succeeds only when:

1. CRd is exactly CR12, CR13, CR14, or CR15.
2. The latched CRd.M value is set.
3. CRs is exactly CR0–CR11 and holds a valid ordinary c-list capability with L permission.
4. `CRs[row]` passes the normal LOAD bounds, version, integrity, and type checks.
5. Reserved encoding bits are zero.

The four-bit destination field preserves all four isolated registers without
aliasing or truncation. Source M is never consulted.

## M-bit device and custody

M is per-register machine state, not a seventh GT permission and not part of
the `{R,W,X,L,S,E}` field. A dedicated I/O device exposes target-bound controls
for CR12, CR13, CR14, and CR15. Each control capability names exactly one
destination. The device requires the exact capability, target, port, and write
right; raw address knowledge supplies no authority.

Only the Namespace abstraction receives these device capabilities during
initialization. Ordinary abstractions cannot mint, discover, attenuate into, or
use them. A capability missing from the caller's c-list, issued to another
abstraction, bound to another CR, addressed at the wrong port, or lacking the
required right fails closed without changing M.

## Operation lifecycle

1. Namespace presents the target-bound M-bit device capability and sets M for
   one isolated destination.
2. The instruction decoder accepts `SWITCH`, latching CRd and CRd.M.
3. The destination and encoding are validated.
4. The ordinary LOAD pipeline validates `CRs[row]`. No source-M bypass exists.
5. On success the loaded capability replaces CRd and CRd.M clears.
6. A subsequent SWITCH to that register fails until Namespace authorizes it
   again through the matching device capability.

The latch prevents a concurrent or later M-device transition from changing the
authorization decision for an already accepted instruction.

## Fault atomicity

An M-clear destination faults with `PERM_L`. A CR0–CR11 destination, CR12–CR15
source, or malformed encoding faults with `INVALID_OP`. A NULL or non-L source,
out-of-bounds row, stale token, or integrity failure faults before
architectural commit. No failure may mutate any capability register, M bit,
Namespace entry, memory word, or source capability.

Conditional instructions whose condition is false are skipped normally and do
not consume M authorization.

## Boot and recovery

Bootstrapping isolated registers is a trusted boot operation. After boot,
runtime reauthorization is exclusively the Namespace-owned M-bit device
protocol above. Successful SWITCH consumes the destination's M state; faults
do not silently grant, move, or infer M. Recovery therefore starts from either
the unchanged pre-fault state or a separately specified reset path, never a
partially installed capability.

## Security consequences

- A capability with L can supply the loaded value but cannot authorize its
  placement into an isolated register.
- A source carrying unrelated machine metadata gains no additional authority.
- Device capability attenuation cannot change its bound destination.
- CR12–CR15 have identical encoding and authorization rules.
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