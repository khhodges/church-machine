# Static exact-artifact HARDFAULT maps

Status: **superseded as standalone work by the Phase 1 bitstream, per user
direction on 2026-10-14**. Retain this implemented verification proposal as
design evidence, not an approved binding or completed release gate. Emission
remains disabled. The unfinished standalone release checks are not PASS;
binding, enablement and acceptance belong to the Phase 1 bitstream work.
The selected word is `0xF7000000`. This document does not authorize
compiler lowering, signing keys, installation, release, or hardware use.
See [candidate evidence](HARDFAULT-CANDIDATE-VERIFICATION.md).

## Contract (version 1)

An untrusted artifact sidecar may supply `hardfault_map`:

```
{
  "keyId": "<approved compiler signing key identifier>",
  "map": {
    "version": 1,
    "encoding": 4143972352,
    "binaryHash": "<lowercase SHA-256 of complete immutable big-endian LUMP>",
    "codeHash": "<lowercase SHA-256 of header and all code words, big-endian>",
    "sites": [
      {
        "offset": 2,
        "reason": "PASSKEY_MISMATCH",
        "method": "Example.Check",
        "sourceLine": 17,
        "explanation": "The supplied passkey does not match."
      }
    ]
  },
  "signature": "<128 lowercase hex characters: Ed25519 signature>"
}
```

Offsets are **header-relative word offsets**, starting at 1. Source lines are
one-based lines of the immutable compilation source, not a current draft.
The method and explanation are static compiler-authored metadata. Entries are
strictly increasing, unique, nonempty, and bounded by the code length. Method
names are at most 128 characters; explanations 512; neither contains control
characters. Reasons match `[A-Z][A-Z0-9_]{0,63}`. Unknown fields are rejected.

Signing bytes are UTF-8 `church-hardfault-map/v1\n` followed by compact JSON
in the property order shown above for **map only**, with site properties in
the shown order. `signingBytes()` is the canonical implementation. The
signature covers all site fields, both hashes, encoding, and version.
Key IDs select locally trusted keys; a supplied key, digest, `secure` flag,
or disassembly match cannot authenticate a map.

This detached format avoids a circular artifact hash. A future approved signer
must sign only the compiler's finalized immutable output and explicit
intentional-site provenance, never accept user-submitted site lists as compiler
truth. Emitters must account for method-table insertion and relocation before
recording offsets. Assembly `WORD` data, even identical bytes, must never
produce map entries. High-level compilers must propagate original method/line
provenance through lowering rather than infer it from generated assembly.
No signer or emitter is enabled by this change. Existing compiler paths through
the assembler reject HARDFAULT with an explicit approval-gate diagnostic.

## Verification and presentation

`simulator/hardfault-map.js` independently checks the signature, recomputes the
complete immutable artifact hash and header/code hash, compares every captured
header/code word, and requires a secure captured artifact identity matching
the signed hash. Every mapped site must contain the selected word. Attribution
also requires captured INVALID_OP, the exact raw word, occurrence identity,
and the same captured header-relative fault offset. An identical WORD at an
unlisted offset is accidental/unclassified, never an intentional HARDFAULT.

`app-run.js` forwards historical simulator evidence; `app-lumps.js` supplies
the inspected exact binary and its untrusted sidecar envelope. It appends
verified static text using textContent only. Verification never replaces raw
INVALID_OP, location, word, or artifact-comparison diagnostics, never executes
a report/CALL, and never changes the editor to reflect reason text. Navigation
or a newer attribution request invalidates pending asynchronous results.
No verified-result boolean is persisted or trusted on reload.

Only the five static site fields can leave the verifier. CRs, DRs, proofs,
passkeys, authority envelopes, private state, and runtime-derived explanations
are neither accepted in maps nor exported by this feature. Existing raw fault
history remains unchanged; this does not claim to redact its existing register
snapshots. The future signer must additionally ensure authored static text
does not itself contain secret literals; schema validation cannot detect them.

The current browser has **no trusted map keys** and no key setter. It therefore
fails closed for every map until this binding and key provisioning are
explicitly approved. The CommonJS verifier factory accepts test-only public
keys so the full positive and adversarial paths can run in isolated tests.
Do not obtain a key from the artifact, browser storage, or request parameters.

## Evidence boundaries

The verifier authenticates the map independently of disassembly matching; it
still relies on the simulator's captured secure execution identity as origin
evidence. It is not a defense against compromised application JavaScript or
forged entire browser history. The complete immutable binary is hashed, while
loaded code is compared with the captured code: destination-localized C-lists
must not be hashed as though they were the canonical artifact.

Hardware snapshots currently lack the required authenticated installed-artifact
identity and complete captured code. They remain unsupported/raw. Do not
convert a hardware NIA using a later live capability or attach a simulator
identity to it. Hardware byte-to-word conversion, full target fault hold,
transport, independent RTL replay and physical acceptance remain separate
gates described in the candidate document.

## Focused verification

```
node simulator/test_hardfault_map.js
node simulator/test_hardfault_candidate.js
node simulator/test_fault_code_navigation.js
node simulator/test_fault_snapshot_labels.js
```

These checks do not publish artifacts or contact hardware.
