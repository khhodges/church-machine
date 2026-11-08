# Hardware-address map and capability-controlled diagnostic MMIO

## Status and scope

This Phase 2 reference records the declared Church hardware-address range,
the approved GTMint address `0xFFFFFF14`, WDT control address `0xFFFFFF18`,
and the approved diagnostic
direction: ordinary Church capability-controlled access. These are specification
and design-direction approvals only, not approval of capability provisioning, RTL integration,
image installation or physical-board operation.

The user suggested diagnostic access to the full range, citing the MMIO
approach used for PP250. That is a design precedent reported by the user,
not evidence that the current FPGA has an equivalent interface. The access
model is selected; the detailed interface and implementation remain unresolved.

## Complete declared range

The range is `0xFFFFFF00–0xFFFFFFFF`. In the tables, offsets are hexadecimal:
`18` denotes `0xFFFFFF18`. Every value in the range is accounted for, including
unassigned gaps. A declared port is not proof of an implemented device.

These values are preserved exactly as declared. Existing simulator comments
call them word addresses; they must not be silently treated as a byte-packed
bank of 32-bit registers. Address units, access width, alignment and any bus
translation must be settled explicitly before integration.

### Capability-register ports: `00–0F`

| Offset | Port | Architectural role or qualification |
|---|---|---|
| `00` | CR0 | Capability register 0; prepared bootstrap entry capability |
| `01–04` | CR1–CR4 | Capability registers 1–4, respectively |
| `05` | CR5 | Thread heap |
| `06` | CR6 | Current abstraction's C-list |
| `07–0B` | CR7–CR11 | Capability registers 7–11, respectively |
| `0C` | CR12 | Active Thread identity/context |
| `0D` | CR13 | Reserved under the current ISA |
| `0E` | CR14 | Current executable/code capability |
| `0F` | CR15 | Current Namespace capability |

The historical port declarations describe L authority for CR loads and S
authority for CHANGE stores. They do not establish a generic raw-register
read/write API or override current instruction rules. In particular, executed
CHANGE/SWITCH operations targeting CR13 hard-fault with INVALID_OP; stale
“interrupt handler” comments do not grant CR13 a current role.

### Control area: `10–1F`

| Offset | Assignment | Status |
|---|---|---|
| `10–13` | Unassigned | No function established by the inspected map |
| `14` | GTMint | Approved specification address; not implemented |
| `15–17` | Unassigned | No function established by the inspected map |
| `18` | WDT control | Approved specification address; not wired to the local RTL unit |
| `19–1B` | Unassigned | No WDT countdown/status ports proposed |
| `1C` | M-bit control | Declared single 32-bit M-bit object |
| `1D–1F` | Unassigned | No function established by the inspected map |

The M-bit word's bits 0–15 correspond to CR0.M–CR15.M. Writing each bit sets
or clears that M state; bits 16–31 are reserved. This object is separate from
the watchdog control word. Its declaration is not a grant of diagnostic access.

Phase 2 separately approves GTMint's dedicated GT.M as a seventeenth M bit.
Its control mapping is still undecided: this does not assign bit 16 here or
change the declared CR0–CR15 mapping.

### Device area: `20–EE`

| Offset | Declared port |
|---|---|
| `20` | UART_TX |
| `21` | UART_STATUS |
| `22` | UART_RX |
| `23` | LED0 |
| `24` | LED1 |
| `25` | LED2 |
| `26` | LED3 |
| `27` | LED4 |
| `28` | LED5 |
| `29` | BUTTON |
| `2A` | TIMER_TICKS_LO |
| `2B` | TIMER_TICKS_HI |
| `2C` | TIMER_TOD_EPOCH |
| `2D` | TIMER_ALARM_CMP |
| `2E` | TIMER_CTL |
| `2F` | DISP_DMA_SRC_LO |
| `30` | DISP_DMA_SRC_HI |
| `31` | DISP_DMA_LEN |
| `32` | DISP_DMA_CTL |
| `33` | DISP_CMD |
| `34` | TOUCH_X |
| `35` | TOUCH_Y |
| `36` | TOUCH_Z / pressure |
| `37` | TOUCH_STATUS |
| `38` | PET_NAME_WR: named C-list-slot annotation write |
| `39–EE` | Unallocated device-port space; `39` is the next unallocated port |

The timer at `2A–2E` is not the execution watchdog. PET_NAME_WR is an existing
lazy-resolution-related declaration, not approval of a new Phase 2 service.

### Remaining tail: `EF–FF`

No assignment is established by the inspected current hardware map.
Historical references to `0xFFFFFFFE` and `0xFFFFFFFF` as passkeys in an
Abstract Address Space must not be imported as hardware-port assignments.

## WDT control at approved offset `18`

The control-word semantics and address `0xFFFFFF18` are approved. Capability
provisioning and the implemented access path remain unresolved.

| Bits | Meaning |
|---|---|
| `0` | Exemption: 1 = exempt; 0 = enforce selected timeout |
| `2:1` | Timeout selector |
| `31:3` | Reserved; read zero and must be written zero |

| Selector | Timeout |
|---|---|
| `00` | 0.25 seconds |
| `01` | 0.5 seconds |
| `10` | 1 second |
| `11` | 2 seconds |

- Existing bootstrap initialization is `0x00000005`: one second, exempt.
  This documents the inherited bootstrap rule, not a universal default for
  every later deployment.
- Reset retains selector and exemption, not elapsed countdown time.
- Readback returns configuration, never remaining time.
- A reserved-bit write is rejected atomically with INVALID_OP (`0x0B`).
  It cannot partially update control or renew the interval.
- A selector-only change takes effect at the next approved start/renewal,
  not by changing the active deadline. Exemption exit starts a fresh interval;
  a combined selector/exemption-exit write uses the new selector atomically.
- Successful CHANGE/SWITCH and completed internal LLR entry renew the timer.
  CALL/RETURN, retirement, stalls and failed/skipped transfers do not.
- Expiry wins equality, including a simultaneous exemption-enabling write.
  WATCHDOG is `0x1F`; existing instruction-fault reporting precedence and
  write-containment requirements remain applicable.
- SecurityRegulator exclusively holds direct control authority. SYSTEM may
  CALL its explicitly authorized methods without receiving that raw capability.
  There is no Thread-name privilege, automatic SYSTEM exemption or software kick.

The [local watchdog unit status](watchdog-local-unit-status.md) distinguishes
tested timing/control logic from outstanding core integration, write containment,
capability provisioning and recovery evidence.

## Existing Wukong MMIO is a different decoder

`hardware/wukong_top.py` selects `0x40000000–0x7FFFFFFF`, then uses address bits
`[5:2]` as a four-bit register selector. Higher address bits within that range
do not distinguish registers: the selection repeats every 64 byte addresses.

| Selector | Existing wrapper definition |
|---|---|
| `0–2` | LED RGB registers |
| `5` | UART transmit |
| `6` | UART status |
| `7` | UART receive placeholder, documented as zero in this build |
| `11–15` | Timer low/high ticks, epoch, alarm compare and alarm control |

This decoder neither establishes the full Church range nor proves that all
declared Church devices exist. Reusing its truncated selector for the full
range would alias distinct ports. No relocation or replacement is approved here.

## PP250-style diagnostic MMIO: approved access direction

The useful objective is **full-range test addressability**, not unrestricted
read/write authority over every port. A diagnostic test should be able to
target any declared address and observe either its authorized behavior or an
explicit rejection. Unassigned addresses must not silently alias a valid device.

Proposed requirements for review, not an implemented ABI:

1. Define one exact address translation and access-width contract covering the
   whole range. Preserve distinctions between all ports and reject unsupported
   accesses explicitly; do not copy the current four-bit peripheral selector.
2. Specify per-port read/write operations, side effects and capability checks.
   CR authority ports must not become raw mutation paths around protected
   CHANGE/SWITCH semantics; CR13 remains reserved.
3. Preserve SecurityRegulator's exclusive WDT custody. Diagnostic requests for
   watchdog control should use explicitly authorized methods, not a second
   broadly held raw WDT capability. Any different custody model needs separate
   approval.
4. Define safe observation separately from destructive or state-changing tests.
   A blind sweep is not safe merely because it reads: device reads can have
   side effects. Do not add a WDT countdown/status register for convenience.
5. Exercise positive and negative cases: exact boundary decode, no aliases,
   unavailable devices, unassigned ports, insufficient permissions, reserved
   operands/bits, and rejected writes with no partial effects.
6. Establish local simulation/RTL evidence before exact-build FPGA qualification.
   Physical tests require separate authorization; documentation grants none.

### Approved access model

Diagnostics exercise the ordinary Church capability-mediated access path,
testing the real runtime permission checks as well as address decoding.
A separate host/debug MMIO window is not selected by this decision.
WDT control remains private to SecurityRegulator; diagnostics use its explicitly
authorized methods rather than acquiring raw watchdog-control authority.

### Decomposed Diagnostic Abstractions

The user clarified that diagnostic MMIO need not be one dangerous GT spanning
the hardware range. Decompose it into several Diagnostic Abstractions with
separately scoped GTs for their respective functions. Full-range diagnostic
coverage is the collective coverage of those abstractions, not a requirement
for one caller or abstraction to hold authority over the entire range.

**GTMint is the first example:** its DATA-write/capability-load facility has a
dedicated manufacturing grant, separate from unrelated diagnostic operations.
This does not broaden Mint's private construction authority or change the
approved transient-result rule. WDT control remains separately held by
SecurityRegulator.

Each abstraction's GT bounds and permissions must match its intended operations;
authority for one function does not imply authority for the others. The remaining
decomposition, public methods and provisioning are not assigned here.

This approval selects the design direction only. It does not authorize
implementation or physical operations, grant a full-range capability, or settle
per-port access semantics, address units/translation, provisioning or method ABI.

No diagnostic Namespace slot, raw full-range capability, API method signature,
host bus address or new fault code is assigned by this document.

### Dedicated GT construction

The approved [Mint-private GT-construction port direction](gt-construction-port.md)
adds a separate manufacturing-authority requirement. Full-range diagnostic
addressability does not grant access to it. Its approved specification address
is `0xFFFFFF14`. The approved access contract uses a W port capability for
DWRITE and **GT.M**, a dedicated seventeenth M bit belonging to GTMint, for
capability LOAD. It does not reuse a CR-associated M bit or alter the 32-bit
GT format. Successful validated LOAD consumes this GT.M and the pending result.
GT.M control mapping, bus translation and integration remain
unresolved. This does not authorize hardware changes or restart outdated Mint testing.

## Sources and authority

- [Declared hardware constants](../../hardware/hw_types.py):
  CHURCH_HW_RANGE, CR_PORT, M_BIT_PORT and IO_PORT definitions.
- [Simulator](../../simulator/simulator.js): Church hardware-range declarations
  and their word-address terminology; legacy comments are not normative.
- [Wukong wrapper](../../hardware/wukong_top.py): actual peripheral MMIO decoder.
- [Phase 1 ISA](../phase-1/01-isa/instruction-set.md): reserved CR13 disposition
  and settled watchdog control, timing and fault rules.
- [Unified Phase 2 lifecycle](../lazy-lifecycle-unified.md):
  completed-LLR renewal and SecurityRegulator control custody.
- [Phase 2 objectives](README.md) and
  [watchdog local status](watchdog-local-unit-status.md): approval and evidence
  boundaries.
