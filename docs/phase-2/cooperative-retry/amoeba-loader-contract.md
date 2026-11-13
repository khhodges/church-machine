# Native Amoeba review candidate

This is local source and an inert, portable review LUMP. It is not an installed
bitstream or a replacement for the current saved boot design.

## Saved review and verification

Saved through the normal compile, save-plan, approval and save APIs:

- Abstraction: `ide.Amoeba`, revision 1.
- File: `server/lumps/ide.Amoeba.1.0c3e9bc9.lump`.
- Catalog token: `0fe93c8c`.
- Binary SHA-256: `ab367d8598b585e01f6b9b664316865a78655bfe05ad93a1052020073c7dbcba`.
- Source: `simulator/examples/amoeba_loader.cloomc`.
- Source SHA-256: `50c1eec3655ef0dc0eecc5073d409da8eb1e43537db042c2ad66f995ede63f2d`.
- Code region: 65 words, including method table; full review allocation:
  2,048 words (8 KiB), including embedded source/API.

The saved source and instruction words were read back and matched the current
compiler output. Compilation produced no warnings. The saved Namespace and
boot image hashes remained unchanged; no existing AmoebaStartup was replaced.

Local verification passed **48 tests**: 14 general receiver checks, 31
neighboring receiver/lifecycle checks, and three combined native executions:
USER Lazy load/resume/RETURN, corrupt delivery hard fault without publication,
and SYSTEM explicit load-before-CALL. Positive runs returned the target's
value 37 and committed exactly one transfer. The three native tests emitted
only pytest XML-format warnings, not compiler/runtime warnings.

Receipts: `generated-artifacts/amoeba-review/save-receipt.json` and
`generated-artifacts/amoeba-loader-local-20261113/amoeba-native.xml`,
`amoeba-neighbor-tests.xml`. No physical-board acceptance is claimed.

## Scope

Only `ide.Amoeba` executable code starts resident in the isolated fixture.
Namespace/Thread structures, a private target capability table and device
descriptors remain resident data. The target body starts with its valid sealed
descriptor and zero-code header; its remaining words are zero.

Native CLOOMC performs destination selection, geometry checks, the complete
copy, header-last publication and return to the suspended caller. The host
supplies bytes only. The new local RTL receiver hashes actual staging RAM
against programmer-selected, provisioned localized artifact digests. A UART
sender cannot change those digests, target sizes or selected slots.

This fixed-allocation implementation deliberately excludes retirement, GC,
allocation reuse, Namespace-type Lazy loading, multiple-USER scheduling,
dynamic replacement of the selected-record table, and hardware programming.
It is a first loader, not the complete future Amoeba lifecycle.

## CLOOMC entry points

| Method selector | Method | Contract |
| --- | --- | --- |
| 0 | Run | SYSTEM entry and bounded one-USER service loop |
| 1 | EnsureResident | DR1 = selected Namespace slot; return DR1 = 0 and retain CR1 |
| 2 | UserStart | USER entry wrapper; CR1 is its application's E-GT; reload SYSTEM Thread after RETURN |

`EnsureResident` is synchronous to its SYSTEM caller. It waits by real
self-CHANGE and does not fabricate successful completion when a LUMP is
unavailable. This first implementation services one outstanding request, not
an asynchronous multi-request scheduler.

`Run` optionally loads and calls one SYSTEM startup target: initial DR1 names
its slot and initial CR1 holds its E-GT. DR1=0 skips that step. After startup,
Run selects the configured USER Thread. On the retained core's LLR handoff,
DR5 holds the absent target slot and Z marks the handoff. Ordinary USER yield
does not create a load request. After installation, ordinary CHANGE restores
the USER and the hardware retries the original CALL.

The runtime capability/integrity gate still authorizes the eventual CALL;
a slot number is a selection key, not a replacement capability or grant.
Direct SYSTEM CALL of an absent target remains a hard fault.

## Private grants and required provisioning

The portable LUMP declares:

1. SELF E.
2. `ide.AmoebaTargets` L: a private 64-row table indexed by Namespace slot.
   Each enabled row is the RW grant for exactly that target's reserved body.
   All other rows are NULL.
3. `ide.AmoebaReceiver` R: seven words at MMIO byte address `0x4000001c`.
4. `ide.AmoebaControl` W: three words at MMIO byte address `0x40000028`.
5. `ide.AmoebaUserThread`: the single configured USER Thread.
6. `ide.AmoebaSystemThread`: SYSTEM Thread, reloaded after application RETURN
   rather than assuming a scratch capability survives the call.

The provisioning boundary must match each target table row, selected digest,
sealed E descriptor, generation, destination RW descriptor and allocation.
These grants are private to Amoeba; do not expose its loading method or its
target table as an untrusted-user publication service. No general Namespace
write grant is needed. Protected records and all staging/executable regions
must be disjoint from Thread, Namespace and Amoeba storage.

The local test binds these into a disposable fixture. Saving the portable
LUMP does not create these objects or assign it to a live Namespace.

## Receiver/control ABI

Receiver offsets are 32-bit words:

| Offset | Read |
| --- | --- |
| 0 | Next validated staging word; reading consumes it |
| 1 | State: EMPTY=0, RECEIVING=1, SEALED=2, VERIFYING=3, READY=4, COPYING=5, CONSUMED=6, FAILED=7, WAITING=8 |
| 2 | Selected Namespace slot |
| 3 | Current transaction |
| 4 | Selected allocation size in words |
| 5 | Reserved (zero) |
| 6 | Selected executable header |

Control offset 0 commits the completely consumed transaction. Offset 2 requests
the selected Namespace slot. Invalid requests/commits fail closed. Transactions
never wrap. Reset or image-epoch replacement clears outstanding receiver state.
Validated staging is locked against subsequent UART input until native
consumption/commit or execution reset.

## Wire protocol

SYSTEM request: 16 bytes, `CAR1` followed by slot, image epoch and transaction,
each an unsigned 32-bit big-endian integer. There is no host publication flag.

Delivery header: 20 bytes, `CLA1`, operation u8, slot u8, two zero bytes,
epoch u32 BE, transaction u32 BE, payload length u32 BE.

BEGIN=1 is followed by exactly the selected complete localized LUMP, encoded
as little-endian 32-bit RAM words. FINISH=2 has length zero and starts actual
staging-RAM SHA verification. ABORT=3 fails the outstanding transfer; it does
not roll back any previously published executable.

Only the requested slot/epoch/transaction can be delivered. Malformed,
wrong-identity, truncated, oversized, tampered or unsolicited delivery cannot
become READY. WAITING without a partial frame does not time out. An interrupted
active transfer does fail; Amoeba reports a hard fault rather than retrying
or substituting another target.

CLA1 is separate from historical CLP1. CSI2 remains the whole-image loader;
this change does not reinterpret CSI1, CSI2 or CLP1.

## Local reproduction

```sh
python docs/phase-2/cooperative-retry/prepare_starter.py \
  --output generated-artifacts/amoeba-check-NEW
cd generated-artifacts/amoeba-check-NEW
PYTHONPATH="$PWD:$PYTHONPATH" python -m pytest \
  ../../docs/phase-2/cooperative-retry/test_amoeba_receiver.py \
  ../../docs/phase-2/cooperative-retry/test_amoeba_native.py -q
```

The receiver suite uses real staging RAM and SHA. The native test uses decoded
UART bytes, real whole-image transport/RAM SHA, guarded boot, retained core,
receiver SHA, native copy/publication and CALL/CHANGE/RETURN. Its delivery byte
spacing matches the configured serial throughput, but it does not test UART
pins, vendor synthesis/timing or physical hardware.

The fixture uses an explicit historical 46/419 boot pair matched to its
guarded Thread/Namespace structures. It is not the original 0/0 Boot2 image,
and does not claim to have qualified all eleven Boot2 dependencies.

The subsequent [actual Boot2 qualification](amoeba-boot2-qualification.md)
provisions all eleven exact selections in isolated Amoeba-only images. It
demonstrates native CapabilityTest delivery but records a downstream SYSTEM
absence fault and first-CHANGE USER context faults; Boot2 is **not qualified**.
