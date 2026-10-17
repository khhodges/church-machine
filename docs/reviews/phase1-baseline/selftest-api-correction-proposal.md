# Proposed SelfTest identity correction — not applied

Status: **review proposal only; no candidate binary generated or selected**.
Requirements: RES-SelfTest and IDE-04.
Basis: [exact-byte finding](selftest-api-identity.md) and
[approved Phase 1 target](approved-target-namespace.md).

## Preserve now

Keep approved SelfTest at slot 6, Resident, sequence 0, with the exact selection
recorded in `selftest-api-identity-evidence.json`. Keep CapabilityTest at slot 10
as the boot entry. Preserve historical and selected binaries byte-for-byte.
Do not rename the Namespace row to RunAbstraction, hide the warning, reinterpret
SELF as an API name, or choose the newest catalog revision.

## Proposed correction, subject to explicit authorization

1. Establish the exact authored source and intended public API corresponding to
   the selected artifact. The selected API says `language: assembly` and has an
   empty method list. Do not assume a current `SelfTest.cloomc` or catalog source
   is equivalent; compare instruction bytes, source provenance and CALL entry
   behavior before deciding the source of a replacement.
2. In an isolated staging directory outside live artifact stores, compile a
   **new** artifact with an explicit SelfTest declaration using the trusted
   compiler path. Do not patch the old file's JSON, header or integrity fields.
   Do not issue signatures or fabricate approval metadata manually.
3. Record the new API, compiler evidence, full binary hash, size and an exact
   old/new comparison. If executable words, entry format, C-list rights or
   dependencies change, state that this is more than a name correction. Verify
   SELF and destination binding independently; all seals remain internal.
4. Present the candidate as a proposed replacement for the **same slot 6**.
   Preserve the current selection until explicit adoption. Do not create a
   second slot or silently promote the candidate. This design-only approval
   must not be treated as installation or resident hot-replacement permission.
5. After adoption is separately authorized, verify exact selection persistence,
   API identity and binding diagnostics. Simulator, RTL and board acceptance
   require their own evidence and authorization; they are not consequences of
   a matching API name.

This proposal does not approve migration, image installation, simulation
activation, hardware access or resident replacement. The current task stops at
evidence, regression coverage and this plan.
