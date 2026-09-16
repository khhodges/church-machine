---
name: Trusted compiler and untrusted LUMP paths
description: Normative trust boundary for local compiler output, uploaded LUMP admission, explicit placement, and runtime enforcement.
---

Use two distinct paths: the Trusted Home IDE compiler is authoritative for
artifacts it creates; uploaded or unknown LUMPs remain inert until the IDE
completes the applicable structural, integrity, trust, and containment gates
and Mint issues an E-GT.

**Why:** A downstream approval system duplicates the compiler's authority and
creates a second trust surface that can disagree with valid compiler output.
Unknown uploads require adversarial admission because the trusted compiler did
not construct them.

**How to apply:** Do not re-adjudicate local compiler output through hidden
approval, fixed-resident, freshness, canonical-source, or abstraction-specific
policy. Protect the compiler output record as TCB evidence, and sign the exact
final bytes only after server-owned canonicalization; intermediate compiler
evidence must not be reused after SELF or destination binding changes. For uploads,
verification precedes vivification. Namespace placement and revision selection
are explicit and fail closed when omitted or ambiguous. A locally bound copy is
a derivative layered on the unchanged portable artifact and seal; Mint owns its
destination-local SELF, and Navana publishes the derivative, Namespace row, and
admission evidence atomically. Publication must be recoverable before executable
reads after restart. Static resident Namespace identity uses the minted SELF GT,
while its immutable artifact filename remains bound to the derivative bytes.
The one-use human intent must bind the exact placement choices, normalized
grants, and full external c-list capability identities; never consume request
echoes as authority. Quarantine objects are immutable and addressed by full
SHA-256 through the locked publication check; an 8-hex UI token is never enough.
Compiler attestations use a dedicated, high-entropy server-only key and fail
closed when it is missing; session-secret defaults must never anchor compiler
authority.
Keep dynamic
ISA checks at runtime. Report deferred or undefined checks as unsupported or
unavailable, never passed. See
docs/TRUSTED_COMPILER_AND_UNTRUSTED_LUMP_ADMISSION.md.
