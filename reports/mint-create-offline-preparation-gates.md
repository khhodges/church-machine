# Offline Mint preparation — stopped at validation boundary

The user approved the fresh disposable layout for offline preparation.
The following probes ran entirely in memory; no candidate image was saved,
published, installed, or executed.

## Namespace-table alias

The exact frozen reference image passed `validate_image` with boot target
slot 21, sequence zero.

Starting with a copy of that image, the probe added only the proposed
slot-22 descriptor `[0, 255, integrity32(0,255), 0]` and incremented the
metadata member count. Ordinary validation rejected it:

```
NS[22] body overlaps the ascending table
```

This is an offline image-validator restriction, not a newly discovered FPGA
access-rule restriction. `server/namespace_ascending_image.py` rejects every
non-self descriptor whose resident base is inside the table.

The same validator also assumes resident objects have LUMP headers. The
proposed raw pool and one-word scratch alias cannot be treated as ordinary
header-bearing LUMPs. Supporting this layout needs an explicit distinction
between owned bodies, data ranges and aliases; simply removing the table
overlap rejection would not establish safe, correct validation.

## Unused NULL dependencies

The ordinary `server.symbolic_binding.bind` function accepted the candidate
contract and bound rows 0, 1, 2, 3, 5 and 6 to the proposed destination slots:

```
4A000017 32000019 1A00001B 3200001A
00000000 32000016 4A000018 00000000
```

Rows 4 (`ide.MintV4Verifier`) and 7 (`ide.MintApproval`) remain NULL and are
reported as `unresolved`; the overall binding status is `unresolved`.
The binder does not reject this outright, but it does not certify it as
fully bound either. The ignored passkey does not require filling those rows.
No fake verifier or approval authority was introduced.

## Work stopped

No validator was changed or bypassed. No caller was compiled, no fresh Thread
was instantiated, and no startup handoff was selected. The requested caller
preparation remains incomplete because these findings require review before
an image can be described as ready.

Recommended next action: review a bounded candidate-validation contract that
recognizes explicitly provisioned data/alias descriptors and deliberately
unresolved, unused dependencies without presenting them as fully bound.
Preserve runtime permission, sequence, integrity and bounds enforcement.
Any implementation or startup change requires a separate decision.
