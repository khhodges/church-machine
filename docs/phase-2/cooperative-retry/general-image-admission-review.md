# General prepared Namespace image admission — design review

Status: **proposal only, 13 November 2026**. No loader policy, executable source,
saved design, build package or hardware was changed. This review does not
authorize implementation, vendor builds, transfer, programming or execution.

## Finding and recommendation

The combined configuration currently admits two particular byte strings, not
a general class of prepared Namespace images. Boot2's rejection is correct
under that policy. Adding its digest as a third special case would only repeat
the limitation; accepting a digest supplied by the UART sender would remove
the trusted approval boundary.

Recommend a reusable, protected **image-approval verifier**: verify an
authority-signed preparation manifest, then compare its image digest against
SHA-256 of the actual received RAM. Keep physical maintenance authorization and
the existing separate receive / validate / start lifecycle. A protected trust
root and supported image profile replace permanent per-image constants.
Individual image hashes remain necessary evidence, but become authenticated
package data rather than new RTL constants or a new bitstream per image.

This is an architectural recommendation, not a claim that signature verification
is already implemented, cheap in this FPGA, or approved. The approving authority,
key custody, verifier implementation and profile must be agreed before coding.
Do not substitute a host-side signature check for the protected verifier.

“Ordinary prepared” means images within a declared hardware/ISA/layout profile;
it does not mean every image produced by the IDE can run on this configuration.
Preparation, admission, successful boot, useful execution and Lazy publication
are five different claims.

## Evidence and current implementation

Reviewed `starter_top.py`, `prepare_combined.py`, `starter_transport.py` and
`combined_protocol.py`, with `starter_lifecycle.py`, `starter_sha256.py` and
`combined_receiver.py` as supporting implementation.

| Boundary | Current behavior | Consequence |
| --- | --- | --- |
| Source preparation | `prepare_combined.prepare` checks `APPROVED` images and old/new LUMP hashes, then replaces the historical `IMAGE_HASHES` in an isolated copy of `starter_top.py` | Default starter and combined copy have different pinned image identities. Editing a preparation dictionary is not general admission. |
| Image transport | CSI1 has a one-bit stored image selector; header requires selector less than two, fixed 65,536-byte BEGIN and zero-length control operations | Selector is a lookup/correlation value, not a runtime capability or identity proof. |
| Received-memory check | `StarterTop.elaborate` compares `sha.digest` to `IMAGE_SHA256[verify_image]` and checks captured epoch and selector | RAM SHA is genuine integrity measurement, but the allowlist defines which images can become READY. |
| Lifecycle | BEGIN holds execution in reset and increments a non-wrapping epoch; FINISH requires all ordered words; validation leads to READY; separately authorized START releases execution | Partial or rejected images cannot start. Failure does not restore overwritten RAM. |
| Runtime | Guarded ROM boot and ChurchCore execute after reset release; program writes and watchdog remain gated | Admission must not replace GT, boot-entry, CALL, CHANGE/SWITCH or memory-access checks. |
| Complete-LUMP path | CLP1 records are checked at elaboration by `validate_records`; exactly two records, 64/256 words, slots 40–59, bounded disjoint allocations in `0x8000..0xa000` | This is a separate demonstration policy, not a general image validator. |

Retained evidence: `generated-artifacts/boot2-offline-check/admission-evidence.json`
and `candidate/boot2.bin`. The candidate is 65,536 bytes, SHA-256
`1edceb0e6f1008098ac7a1aebc1c6e1db968d39270dfe509a0974df390f99014`.
Both selectors measured that digest, reached FAILED, held execution reset and
refused START. The selected combined digests were:

- selector 0, All Waiting:
  `bfd60b47f5346768a81a53276876634f8b87b52d05f4ffa9a986a232d6ffc3d7`
- selector 1, USER B:
  `1d2417387397d64640ab976322232158db60de8b61483fd52a27b010eac302eb`

The evidence is a received-RAM SHA/lifecycle **RTL slice**, not a full UART/top
or core replay. Its captured source hashes can be checked against the retained
`rtl-inputs` files. It does not establish what Boot2 would do after admission.
Generated evidence is local retained material, not a tracked release artifact.

## Trust choices

1. **Recommended: signed preparation manifest plus physical maintenance.**
   The authorized preparer approves exact final localized bytes and profile.
   A protected verifier authenticates that approval independently of UART.
   Many images can use one trust root without changing runtime GT semantics.
   Costs include protected verification, key provisioning and revocation policy.
2. **Possible smaller policy, not currently approved: physical operator alone.**
   Maintenance would explicitly authorize any structurally compatible image,
   with RAM SHA only identifying it and checking transfer consistency. This
   deliberately trusts all content injected while maintenance is enabled;
   a sender-provided hash is not authentication. The existing physical-input
   approval was paired with a two-image allowlist and does not authorize this
   weaker policy. Do not introduce it as a fallback if signatures are difficult.
3. **Reject as a general solution:** keep adding image hashes, trust a host
   PASS flag, treat a selector as approval, or accept an unsigned expected hash
   as authority. CRC/SHA alone cannot distinguish an authorized image from an
   attacker supplying both replacement bytes and their digest.

There is no claim here of authenticating the serial sender. Image authenticity
and permission to stop/start execution are separate decisions. A signature over
an image also does not confer runtime privileges on that sender.

## Proposed authenticated package and protected boundary

Use a versioned, bounded, canonical manifest encoding with a domain-separated
signature. Reject unknown versions, duplicate/ambiguous fields, unsupported
algorithms, oversized metadata and arithmetic overflow. Specify its exact wire
encoding and signature algorithm in the separately approved implementation.

The signed content must bind:

- image SHA-256, exact byte length and little-endian word encoding;
- target hardware/runtime compatibility profile and image format version;
- Namespace identity and intended boot selection;
- complete layout/reserved-region policy identifier and preparation provenance;
- approval key identifier and policy version (with any approved rollback rule).

The image digest covers **all final received bytes**, including descriptors,
localized C-lists, Thread homes, embedded content and padding. Signing portable
pre-localization LUMPs or a catalog name is not approval of a localized image.
Any metadata repeated from the image must match its actual contents; metadata
cannot override them. A whole-image digest alone is not proof of correct
allocation or valid boot structure.

Trust anchors, accepted profiles and verification results must be outside
replacement RAM and inaccessible to UART/application writes. Do not put a
trusted key in the incoming Namespace and ask it to approve itself. Key
rotation/revocation needs a separate protected provisioning decision; do not
add an unauthenticated serial “update key” command.

Keep the first proposed profile at the existing 64 KiB geometry. Define
structural checks for its Namespace header, descriptor and Thread geometry,
boot root/entry, supported versions, alignment, bounded allocations and
reserved regions. Check address ranges before truncation: current top-level
RAM addressing slices to 16 bits, so incompatible high addresses must not
silently alias low RAM. Include ROM visibility and MMIO mappings in profile
compatibility. This does not authorize changing the ISA, repairing bad GTs,
rewriting descriptors, guessing layouts or relocating an incoming image.

A trusted preparation attestation may certify expensive layout checks only
if that delegation is explicit in the approved profile. The device must still
check authenticated profile, length, actual RAM digest and transaction binding.
Never label an unimplemented device-side structural check as implemented.
Structural validation is not advance execution of every GT: authored faulting
programs can remain valid images, and runtime checks still decide each access.

## Preserve receive / validate / start

1. **Authorize and begin.** Physical maintenance permits replacement, not a
   runtime GT grant. Capture a bounded candidate manifest, open a fresh epoch
   and hold the execution domain/watchdog in reset. The control/verifier
   remains outside that reset domain. Clear prior admission validity.
2. **Receive.** Only sequential words within the fixed image length reach RAM.
   Transport supplies bytes and correlation information, never a PC, GT,
   permission override, host PASS, or Namespace publication command.
3. **Seal and validate.** FINISH is distinct from the last word. Freeze bytes
   and manifest; exclude all loader, CPU and CLP1 staging writes until START
   or abandonment. Authenticate the manifest, check the supported profile and
   required structure, and hash actual RAM. Bind the result to the current
   epoch, digest, manifest identity and policy identity. Delayed results from
   an abandoned/replaced transaction cannot make another image READY.
4. **Ready.** Expose admitted identity/status but keep execution reset asserted.
   READY means admitted, not booted or successfully executed. No automatic start
   on FINISH, signature success or hash completion.
5. **Start.** Require a separate physically authorized START naming the current
   admitted transaction. Release through the existing guarded ROM boot, not a
   transport-supplied entry PC. Begin a fresh execution/watchdog epoch; normal
   runtime GT and fault behavior applies unchanged.
6. **Fail closed.** Malformed, incomplete, unauthenticated, incompatible or
   changed candidates stay non-executing. Explicit new BEGIN is required to
   replace failed bytes. No rollback to an assumed intact previous image,
   silent retry, automatic reset recovery or watchdog exemption.

Preserve current active-transfer abort on maintenance loss/UART error and
partial-frame timeout. Do not claim the current idle counter is a general
VERIFYING/READY timeout: it increments during data or partial headers.
Any new verifier liveness bound must fail closed, never start execution.
Retain epoch exhaustion refusal; a volatile epoch prevents in-session stale
results, not rollback of previously approved images after a power cycle.
Minimum-version/anti-rollback storage, if required, needs explicit policy;
do not advertise it without persistent protected state.

Introduce a versioned general-image transport rather than silently changing
CSI1 selector semantics. Retain CSI1 as the historical demonstration contract
or explicitly reject it in the new profile. New status should distinguish
receipt, authentication/profile failure, READY and started identity.

## Runtime and Lazy boundaries remain separate

For whole-image replacement, the authorized image defines initial Namespace
contents; the transport must not infer additional grants from its manifest.
After START, only normal instructions operating under their existing authority
may use or change those contents. Admission never makes arbitrary GTs valid,
sets a pass bit, repairs stale generations or bypasses retained-GT checks on a
retried CALL.

`combined_protocol.validate_records` is an elaboration-time validator for the
separate CLP1 path. `CombinedReceiver` compares staged RAM against protected
record digests, binds readiness to the old/new phase, and advances phase only
on SYSTEM's complete-consumption commit. The top wires a fixed staging area
at `0xa000` and a demonstration MMIO interface. The observer also has fixed
caller/revision assumptions.

General image approval must therefore either require a profile explicitly
compatible with those reservations/interfaces or use a separately reviewed
configuration where the incompatible receiver cannot write. Do not infer
compatibility from free bytes or a successful image signature. Generalizing
CLP1 record ownership, dynamic destinations or publication is a different
design change; it is not solved by changing the image verifier.

Boot2 execution, boot/ISA/layout compatibility, watchdog behavior and SYSTEM
Lazy consumption/publication have **not been tested beyond admission**.
Neither historical demo results nor the proposed verifier prove them.

## Bounded acceptance plan, only after separate approval

| Gate | Required evidence |
| --- | --- |
| Trust contract | Approved authority/key custody, signed schema, fixed profile, verifier placement, provisioning and replay policy. No implicit reduction to physical-only trust. |
| General admission slice | Same verifier/configuration admits at least two distinct authorized ordinary images without source/hash-list changes; measured RAM digest equals signed digest. Boot2 is eligible only after independent preparation approval, not merely because it is the retained test case. |
| Negative admission | Altered image, altered manifest, wrong/untrusted key, mismatched profile/length/layout, stale epoch, malformed envelope, truncated/extra/out-of-order words, interrupted validation and RAM-write attempts all fail closed. |
| Lifecycle | No program writes/boot before START; early or stale START rejected; maintenance loss and verifier failure leave reset asserted; BEGIN invalidates earlier results; epoch exhaustion never wraps. |
| First full-core replay | Replay one exact admitted ordinary image through normal ROM/core; record the first incompatibility and stop. Do not translate instructions, patch GTs or claim general simulator parity. |
| Lazy compatibility | Separate exact-image evidence for reserved staging, legitimate SYSTEM grants, retained-GT retry negatives, publication ordering and continued eligible-USER progress. Admission alone cannot close this gate. |

Existing two-demo evidence remains historical and unchanged. New evidence must
name the source/configuration, profile, authenticated manifest, measured image
and epoch. No vendor build or physical action follows automatically from these
local gates.

**Decision requested for future work:** approve or revise the reusable trust
contract first. Only then authorize a bounded offline implementation and
admission test. Beyond-admission replay is its own subsequent gate, not a
reason to broaden this review into a runtime or Lazy redesign.
