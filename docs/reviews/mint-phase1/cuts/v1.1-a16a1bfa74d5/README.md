# Mint Phase 1 — definition cut

This freezes the latest Mint definition, including Abstract GT issuance,
CREATE/DESTROY, GC interworking, resident/Outform destruction exclusions and
DESTROY's purpose of reducing garbage.

**Status: definition cut complete; ordinary CLOOMC implementation and LUMP
not delivered. Do not install the inspected historical/test sources.**

`definition.md` is the byte-for-byte frozen definition. Its SHA-256 is:

`a16a1bfa74d5732aaed5755cd2a381f8db42f37cd593785e6911de47f0275064`

`compiler-evidence.json` records source/compiler hashes and actual diagnostics:

| Source | Ordinary compilation errors |
|---|---:|
| Legacy Mint source | 12 |
| Archived Mint draft | 16 |
| Protected-profile Mint source through ordinary assembler | 10 |

An independent ordinary compiler control passes. The errors are not evidence
that ordinary CLOOMC cannot implement Mint; they show that the existing source
candidates do not provide the requested implementation.

The protected-profile source uses private MINT operations and post-assembly
word replacement. Its runtime performs service work in JavaScript. Its bytes
must not be packaged or presented as an ordinary-CLOOMC Mint release.

Remaining source work includes the real CREATE/DESTROY bodies and their
explicit dependencies. The frozen definition also leaves hierarchy routing,
credential issuance/delivery, GC roots/safe points/cycle ABI and representation
method ABI open. Those interfaces must be completed without inventing ISA
authority, accepting stubs or host-side services.

No live LUMP, Namespace, boot image, hardware or runtime configuration changed.

To regenerate current inspection evidence without touching those live assets:

```sh
node scripts/cut-mint-phase1.js
```

This writes a separately fingerprinted bundle under `generated-artifacts/`.
Do not overwrite this frozen definition when continuing implementation.
