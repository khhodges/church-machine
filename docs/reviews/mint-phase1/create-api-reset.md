# CREATE — reset API draft

Status: proposal consolidated from the guided input review. Not an implemented
register ABI or an approval to install a LUMP. The older 12-word request and
the current editable source are not this interface.

## Logical interface

```text
CREATE(initialGT, requestedWords, permissions, passkey) -> newGT
```

Passkey means the authorizing GT plus its separate proof, not the GT alone.
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

| Object being created | Initialization input |
|---|---|
| Namespace | GT identifying a preformatted set of slots |
| Thread | E-GT of the application abstraction Amoeba will start |
| Abstraction | GT identifying the defining LUMP |
| Data | Exact initialization convention has not been separately settled by this review |

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

The supplied initializer does not always identify the kind being created:
for Thread creation it identifies an application Abstraction, not a Thread.
Consequently CREATE cannot infer “create a Thread” solely from that E-GT.

The existing object definition must identify the creation kind. Its binding
to this call needs to be explicit before this becomes an executable ABI.
Do not silently restore a numeric kind selector, invent a definition record,
or guess from permissions. The register proposal above does not solve this
missing distinction by itself.
