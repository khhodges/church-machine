# CREATE — reset API draft

Status: proposal consolidated from the guided input review. Not an implemented
register ABI or an approval to install a LUMP. The older 12-word request and
the current editable source are not this interface.

## Logical interface

```text
CREATE(initialGT, requestedWords, permissions, passkey) -> newGT
```

Passkey is one logical credential: its authorizing GT plus its private
128-bit proof (four 32-bit words), not the GT alone. The proof is not a second
credential. Splitting these components across CR2/CR3 is a proposed calling
convention, not a separately approved requirement.
The object definition supplies kind, GT type and Domain; Abstract Owner comes
from its owning abstraction. How that definition is selected is the open
interface point below, not an assumed hidden lookup.

## Proposed register assignment

| Register | Input or result |
|---|---|
| CR2 | Authorizing Passkey GT |
| CR3 | Readable GT for the four-word Passkey proof |
| CR4 | Object-specific initialization GT |
| DR2 | Requested allocation size, in 32-bit words |
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
| Data | Exact initialization convention has not been separately settled by this review | Unsettled |

This revised proposal distinguishes the three input forms above within CREATE,
not by adding a numeric kind argument. Namespace LS describes access to the
source C-list; its contained GTs retain their individual permissions and need
not themselves be LS. Mint reads the source LUMP and writes its new allocation;
it does not require write permission on the source LUMP.

These source permissions are separate from DR3's requested permissions for
the returned GT. Validate the expected source structure, not merely permission
bits.

### Individual case review

Namespace case confirmed by the programmer on 2026-10-18:

| Item | Namespace — agreed |
|---|---|
| CR4 | LS GT to the source C-list |
| DR2 | Requested Namespace allocation size |
| DR3 | NONE |
| Passkey | Authorizes creation and supplies the memory allowance |
| Mint action | Allocate the Namespace and populate its slots from the supplied C-list |
| Contained GTs | Retain their individual permissions; not all required to be LS |
| Result | Namespace GT, permissions NONE, B=0 |
| Case selection | CR4 LS selects Namespace creation under this CREATE convention; no separate kind selector |

This case approval does not settle Data initialization, the detailed Amoeba
handoff, or approve implementation of the whole register ABI.

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
2. Round requested allocation up to a power of two, with a 64-word minimum
   in this redraft.
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

No interface-version constant, numeric object-kind selector, independent GT
type or Domain, caller B flag, numeric Owner, raw Abstract payload, or reserved
padding words. No new Abstract GT encoding or credential protocol is proposed.

## Open point: definition versus initializer

The revised proposal uses a CREATE-specific input convention: capability-list
LS for Namespace, application E for Thread, and readable defining-LUMP data
for Abstraction. The E-GT still identifies the application, not an existing
Thread; this proposed convention is what gives it its CREATE meaning.

R/RW alone cannot distinguish a defining LUMP from ordinary Data. Data
initialization and its distinction from Abstraction creation remain unresolved,
as does the detailed Amoeba handoff ABI. Do not silently restore a numeric kind
selector or invent a definition record to fill these gaps. This is not yet a
complete executable ABI.
