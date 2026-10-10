# Boot CALL: implementation observation and simulator distinction

## Release-blocking ISA discrepancy

Do not approve this observed transition as an FPGA test oracle. Boot CHANGE
failed the master ISA's CR12 installation requirement, and CALL proceeded
using separately held Thread state despite that incomplete architectural
state. Successful execution does not establish integrity or ISA conformance.
The IDE simulator's passing boot regression is not validation of this RTL.
Correction and independent ISA-derived acceptance checks are required before
release approval. This evidence does not identify the running board's image.

Fresh replay of the same archived optimized candidate full.v and unchanged
approved initialization inputs used for the first two reviews. No physical
Step command, mapped-production validation, or ISA approval is claimed.

Instruction at NIA 8: `17000000` (CALL CR0, method 0).
Retired without fault at cycle 621882. Simulation stopped before the callee's
first instruction. Snapshot input hashes remained unchanged.

## Observed result

- CR12 remains GT 02000001, base 0, limit 0.
- CR8 remains GT 2A000001, base 2600, limit FF.
- Separate active_thread_base is 2600.
- CR6 becomes GT 1A00000A, base 3DD4, limit A.
- CR14 becomes GT 4200000A, base 2E04, limit 24.
- CR0, CR5, CR15 and all other CRs remain as after CHANGE.
- DR1–DR15 remain zero.

CALL-local memory writes observed at clock edges:

| Address | Data |
|---|---|
| 29C8 | 4A00000A |
| 29CC | 0FFFF0F3 |
| 2644 | 000010F1 |

All addresses and data above are hexadecimal. The first two writes are the
frame; the last updates the protected Thread indicator.

## Why CALL proceeds

The archived core wires CALL's thread_base to active_thread_base, not CR12's
base word. CHANGE previously installed that separate base. CALL's
CHECK_CR5_CR12 checks CR5 null/read permission and CR12 null identity; the
non-null bootstrap CR12 passes despite its zero base/limit. Stack checks use
the separately supplied Thread base/header.

This explains progress in the model without establishing ISA conformance.
The preceding failure to install the incoming Thread into CR12 remains.

## IDE simulator differs

The current simulator/simulator.js boot CHANGE explicitly writes the
permissionless Thread GT and descriptor into CR12 via _writeCR. It restores
software capability homes, including CR8, then constructs CR5 using the Thread
slot/sequence. Its _activeThreadBase derives from CR12.word1; CALL uses that
helper. It does not use the hardware model's CR8-as-scratch boot path.

This comparison is a current source inspection, not a reproduction of the
historical build-approval run or proof of which simulator revision it used.
Simulator memory addresses are word-based; hardware addresses here are bytes.

The master ISA requires incoming Thread installation in CR12 at boot and
CALL's two-word frame with unchanged system-wide CR12/CR13. A simulator pass
does not prove the RTL implements that state transition.

## Evidence

`call-step-review-evidence.tar.gz` retains the bench, logs, exact pair files,
and hash report. Original full.v remains in the hash-identified source archive.

```
python3 scripts/replay_namespace_first_step.py --through-call --output /tmp/new-call-review
```

No hardware changes, image generation, reset, or board commands were performed.
