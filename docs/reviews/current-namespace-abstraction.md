# Current Namespace as an abstraction

Status: concrete design definition for review, not a compiled or installed
abstraction. No live Namespace, LUMP, capability grant, or hardware is changed.

## Source and identity

This definition captures the saved ascending Namespace design used in the
preceding simulation discussion, not the legacy Namespace or a hardware snapshot.

- Source: `server/lumps/design-drafts/ascending-v1.json`
- Source SHA-256: `09b29da4e736715f730803ecf334e9210df61356a00213d4e77c4d05a3e77e10`
- Namespace name retained: `Boot.NS`
- Format: `ascending-nst-metadata-slot0-v1`
- Current instance capacity: 16,384 words; supplied through the variable
  `capacityWords`, not fixed by the abstraction.
- Table: 64 slots
- Selected output profile: `api`

## Programmer-facing definition

The following is descriptive notation, not assembler syntax or a new executable
schema. `CurrentNamespaceDefinition` is a name for this supplied construction
C-list and its layout annotations, not a newly issued GT.

```text
Namespace abstraction Boot.NS(capacityWords)
    definition: CurrentNamespaceDefinition
    capacity:   capacityWords
    slots:      64
    entry:      Boot.Thread at NS[2]
    startup:    ide.CapabilityTest, exact saved revision 4

    PrepareTable()
        construct or supply the table described by definition
        validate that the table and resident layout fit capacityWords
        return its exact reference and actual allocated extent for Regulator validation
        do not activate CR15 or grant M authority
```

The current instance supplies `capacityWords = 16384`. Other instances may
supply a different capacity within the machine's supported geometry and their
authorized memory allocation. A requested size is not itself allocation
authority. Preparation must reject insufficient or unsupported capacity rather
than silently change membership or residency. The Regulator validates the
actual allocated extent, not merely the requested number.

This parameterization does not define live resizing of an active Namespace.
The table's slot count is a separate dimension from memory capacity.

`PrepareTable` is a proposed method, not an existing service. The concrete method
ABI, constructor implementation identity and execution E-list remain undefined.
The construction C-list is independent of that E-list; its ordinal positions
need not equal the destination Namespace slots below.

## Supplied construction C-list and layout

Pet names below are copied from the saved design; do not silently rename them.
References are symbolic here, not invented numeric GTs. Membership does not
itself establish permission to construct, export, or activate an object.

| Destination slot | Pet name | Kind | Policy | Sequence | Exact selection or layout |
|---:|---|---|---|---:|---|
| 1 | Boot.NS | Namespace self | Resident | 0 | The table being constructed |
| 2 | Boot.Thread | Entry Thread | Resident | 0 | 256 words |
| 3 | LED_DEV | MMIO | Hardware | 0 | Address `0x40000000`, raw limit field 4 |
| 4 | BTN_DEV | MMIO | Hardware | 0 | Address `0x40000028`, raw limit field 0 |
| 5 | TIMER_DEV | MMIO | Hardware | 0 | Address `0x4000002C`, raw limit field 4 |
| 6 | SelfTest | LUMP | Resident | 0 | Revision 99; exact artifact below |
| 7 | ide.WukongCallHome | LUMP | Resident | 0 | Revision 1; exact artifact below |
| 8 | UART_DEV | MMIO | Hardware | 1 | Address `0x40000014`, raw limit field 2 |
| 10 | ide.CapabilityTest | LUMP | Resident | 0 | Revision 4; selected startup executable |
| 11 | Thread.2 | Thread | Resident | 0 | 256 words |
| 12 | Thread.3 | Thread | Resident | 0 | 256 words |
| 13 | M_BIT_DEV | MMIO | Hardware | 0 | Address `0xFFFFFF1C`, raw limit field 0 |

Slot 0 is format metadata, not an ordinary membership capability. Slot 9 and
slots 14–63 are unassigned. The definition preserves sparse placement.

The device limit values above are copied fields, not reinterpreted byte counts.
No permissions are inferred from this membership list. M_BIT_DEV's presence
does not grant its write authority to the constructor, its callers or other
members. The legal Regulator access path remains to be established.

### Frozen executable references

| Pet name | Selected token | Filename | SHA-256 |
|---|---|---|---|
| SelfTest | `bb1e4bed` | `SelfTest.1.fcf2c79d.lump` | `7063b718007e06115755042a302d957c0d85a7c941085c3837d66955caec3f02` |
| ide.WukongCallHome | `eca30d09` | `ide.WukongCallHome.1.8d0a25eb.lump` | `6af835f829b21b37e2074fcb0cb45a8d77e9c18e4cde1b653c5dd7d16d091f89` |
| ide.CapabilityTest | `ff353b57` | `ide.CapabilityTest.1.cc80b80a.lump` | `059cdada2d5e5c931e32c9e65649540a708004f52e9aff9b40f12330df9bcb5d` |

Names and revision labels aid inspection; filename, hash and selected token
identify the precise artifacts. Do not replace them with "latest." Preparation
must preserve their authority and use the established verified destination
binding rules rather than copying source-local GTs blindly.

The slot-2 Thread is the Namespace entry object; the slot-10 LUMP is the
selected startup executable. They are not interchangeable. Additional generated
Thread initial state must follow the existing preparation rules, not be invented
from this membership list.

## Three-layer operation

```text
Programmer:
    select Boot.NS with CurrentNamespaceDefinition
    request SecurityRegulator.SwitchNamespace(Boot.NS, Passkey)

Namespace abstraction:
    prepare its machine table from the supplied definition

SecurityRegulator:
    validate Passkey scope for the abstraction and transition
    request table preparation without exposing M authority
    confirm the exact table, geometry, bindings and entry Thread
    execute the authorized Namespace SWITCH
```

The API takes one Passkey credential, not separate independently managed
Passkey and Proof arguments. Its internal authentication is not specified here.
The construction C-list is not implicitly the Regulator's or constructor's CR6.

The Regulator validates machine requirements; it does not select members,
substitute versions, invent a scheduler, or decide the programmer's architecture.
The confirmed table must be the exact table consumed by SWITCH. The protection
against modification between validation and use is a required design decision,
not an established interlock.

This definition does not assert that a compiled Boot.NS constructor or
SecurityRegulator service already exists. It does not allocate their execution
capabilities or manufacture Passkeys. Executable method ABI, authority
provisioning, table protection, and suspended-call continuation must be resolved
before an operational end-to-end demonstration.
