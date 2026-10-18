# CREATE — reset API draft

Status: proposal consolidated from the guided input review. Not an implemented
register ABI or an approval to install a LUMP. The older 12-word request and
the current editable source are not this interface.

## Logical interface

```text
CREATE(initialGT, sizeAndCase, permissions, passkey) -> newGT
```

Passkey is one logical credential: its authorizing GT plus its private
128-bit proof (four 32-bit words), not the GT alone. The proof is not a second
credential. Splitting these components across CR2/CR3 is a proposed calling
convention, not a separately approved requirement.
The creation case is packed into the power-of-two allocation size, as directed
by the programmer on 2026-10-18. This supersedes selection by CR4 permissions
alone. The supplied definition must match the selected case; it still supplies
the object details. Abstract Owner comes from its owning abstraction.

## Proposed register assignment

| Register | Input or result |
|---|---|
| CR2 | Authorizing Passkey GT |
| CR3 | Readable GT for the four-word Passkey proof |
| CR4 | Object-specific initialization GT |
| DR2 | Power-of-two allocation size in words, packed with creation case 1–4 |
| DR3 | Requested permission selection |
| CR1 | Returned object GT |
| DR1 | Completion: 1 only after successful completion |

This assignment is proposed, not separately approved. CR2/CR3 and CR1/DR1
retain the existing draft's authorization/result convention. CR4 replaces the
old request-record role; DR2/DR3 carry the two remaining scalar inputs.
There is no second generic content buffer or 12-word request record.

## Meaning of the initialization GT

| Object being created | CR4 initialization input | Source access |
|---|---|---|
| Namespace | GT identifying the C-list used to populate the Namespace slots | LS |
| Thread | GT of the application abstraction Amoeba will start | E |
| Abstraction | GT identifying the defining LUMP as binary data | R is sufficient; RW also provides read access |
| Data | GT identifying the supplied initial data | R or RW |

The packed DR2 case distinguishes these input forms within CREATE,
without adding another argument. Namespace LS describes access to the
source C-list; its contained GTs retain their individual permissions and need
not themselves be LS. Mint reads the source LUMP and writes its new allocation;
it does not require write permission on the source LUMP.

These source permissions are separate from DR3's requested permissions for
the returned GT. Validate the expected source structure, not merely permission
bits.

### Individual case review

The case reviews below established initializer and result semantics. The later
packed-size decision supersedes their original size-only DR2 and inferred
case-selection descriptions; the consolidated table reflects that decision.

Namespace and Thread cases confirmed individually by the programmer on 2026-10-18:

| Item | Namespace — agreed | Thread — agreed |
|---|---|---|
| CR4 | LS GT to the source C-list | E GT to the application abstraction |
| DR2 | Requested Namespace allocation size | Requested Thread allocation size |
| DR3 | NONE | NONE |
| Passkey | Authorizes creation and supplies the memory allowance | Authorizes creation and supplies the memory allowance |
| Mint action | Allocate the Namespace and populate its slots from the supplied C-list | Allocate and prime the Thread with Amoeba |
| Initialization detail | Contained GTs retain their individual permissions; not all required to be LS | Amoeba subsequently starts the application identified by CR4; CR4 is not Amoeba or an existing Thread |
| Result | Namespace GT, permissions NONE, B=0 | Thread GT, permissions NONE, B=0 |
| Case selection | CR4 LS selects Namespace creation under this CREATE convention | CR4 E selects Thread creation under this CREATE convention |

Neither case needs a separate kind selector. These approvals do not settle the
detailed Amoeba handoff or approve implementation of the whole register ABI.

Abstraction case also confirmed individually by the programmer on 2026-10-18:

| Item | Abstraction — agreed |
|---|---|
| CR4 | R or RW GT to the defining LUMP |
| DR2 | Requested Abstraction allocation size |
| DR3 | E, LS or L for the returned GT |
| Passkey | Authorizes creation and allocation |
| Mint action | Create the Abstraction from its defining LUMP; zero-fill remaining allocated space |
| Source access | Read only is sufficient; source W is not required |
| Definition | Supplied by the LUMP, not a second description record |
| Result | New Abstraction GT with requested permissions and B=1 |

Data initialization was subsequently confirmed individually by the programmer
on 2026-10-18: use an R or RW GT to the supplied initial data in CR4.

| Item | Namespace | Thread | Abstraction | Data |
|---|---|---|---|---|
| CR4 | LS GT to source C-list | E GT to application | R/RW GT to defining LUMP | R/RW GT to initial data |
| DR2 | Size packed with case 1 | Size packed with case 2 | Size packed with case 3 | Size packed with case 4 |
| DR3 | NONE | NONE | E, LS or L | RW, R or W |
| Passkey | Authorizes creation and allocation | Authorizes creation and allocation | Authorizes creation and allocation | Authorizes creation and allocation |
| Mint action | Populate Namespace slots | Prime with Amoeba | Create from defining LUMP | Copy supplied initial data |
| Returned CR1 | Namespace GT | Thread GT | Abstraction GT | Data GT |
| Returned B | 0 | 0 | 1 | 1 |

For Data, the source must be readable even when the returned GT is W-only.
Mint zero-fills unused destination space. Copying must remain within both the
established readable source extent and the destination allocation; DR2 does
not establish readable source extent.

The packed creation case distinguishes ordinary Data (4) from a defining LUMP
(3), even though both source GTs provide R/RW access.

Mint always primes a Thread with Amoeba; it must not bypass Amoeba by
starting the supplied application directly. The application's E-GT is not a
formatter to execute during CREATE. This defines roles, not the detailed
Amoeba handoff ABI.

Abstraction initialization uses its LUMP, including the established header
and method-routing table; do not invent a second scalar description.
Initialization and padding belong to the relevant object format, not an
unconditional copy of an allocation-sized source span. Where shorter content
is copied, Mint supplies zero padding; the caller need not make a padded copy.

## Allocation and Passkey accounting

1. Validate the Passkey and authority for the operation before protected work.
2. Use the power-of-two size decoded from DR2, with a 64-word minimum still
   proposed in this redraft. Round any original size request before packing;
   never round or charge the packed size-and-case value.
3. Require the Passkey's remaining memory allowance to cover that allocation.
4. Charge that same rounded allocation; a positive but insufficient allowance
   is not enough.

This redraft applies the power-of-two/64-minimum sizing rule to allocation,
not to the number of source words to read. Do not invent a content-length
input again or assume that allocation size proves readable source extent.

Accounting must agree with committed allocation. These statements do not
promise rollback after a partially completed operation or define a new
Passkey-record layout.

## Permissions and Bind

| Category | Allowed requested permissions | Returned B |
|---|---|---|
| Data | RW, R, W | 1 |
| Thread | NONE | 0 |
| Namespace | NONE | 0 |
| Church | E, LS, L | 1 |

All methods are Passkey-limited. Neither B nor the permission selector
replaces Passkey validation. No caller-supplied B value is needed.

## Result and failure

On success, return the newly issued GT in CR1 and completion 1 in DR1.
Failure hard-faults rather than returning a fabricated successful result.
Do not report success before initialization, required Namespace/lifetime
bookkeeping and memory accounting are complete.

## Inputs intentionally absent

No interface-version constant, separate object-kind argument, independent GT
type or Domain, caller B flag, numeric Owner, raw Abstract payload, or reserved
padding words. No new Abstract GT encoding or credential protocol is proposed.

## Packed size and creation case

The programmer directed that the exact case 1–4 be packed into the unused
space in the power-of-two size. No additional parameter or definition record
is required. The case numbers follow the individual review order:

| Case | Creation |
|---|---|
| 1 | Namespace |
| 2 | Thread |
| 3 | Abstraction |
| 4 | Data |

Proposed bit layout (not separately approved):

```text
DR2   = sizeWords | case
case  = DR2 & 0b111
size  = DR2 & ~0b111
```

Literal cases 1–4 need three bits. This layout requires a power-of-two size of
at least eight words, so it fits the currently proposed 64-word minimum without
overlap. It does not independently approve that minimum. For 64 words, DR2 is
65, 66, 67 or 68 for cases 1, 2, 3 or 4 respectively.

Validate case 1–4 and a supported power-of-two decoded size; reject malformed
values. Validate the CR4 source for the selected case rather than guessing the
case from its contents or permissions. Passkey accounting uses decoded size,
never the packed value.

The detailed Amoeba handoff ABI remains unresolved. Packing resolves case
selection but does not by itself complete or authorize an executable ABI.
