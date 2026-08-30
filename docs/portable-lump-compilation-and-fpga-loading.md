# Portable LUMP Compilation and FPGA Loading

**Status:** Architecture draft  
**Normative rule:** **Compile names; verify tokens; load bindings.**

## 1. Purpose

A LUMP must be transferable between IDE instances, simulators, and FPGA
devices without being tied to the Namespace layout of the machine that
compiled it.

The compiler must therefore use universal pet names and preserve symbolic
capability references. It must not turn those references into
machine-local Golden Tokens during ordinary compilation.

The destination simulator or FPGA performs the later binding step. It verifies
the requested artifact and dependencies, assigns local Namespace slots and
sequences, and materializes the local Golden Tokens required by the target
image.

This is not merely a UI improvement. It separates portable artifact identity
from destination-specific runtime authority.

## 2. The three things that must not be confused

There are three distinct concepts:

| Concept | Scope | Purpose | Portable? |
|---|---|---|---|
| Universal name `N` | Global | Identifies the intended abstraction and issuance | Yes |
| Content token `T` | Global | Verifies that the resolved content is the expected content | Yes |
| Golden Token / binding | Local | Grants authority to a local Namespace object | No |

### 2.1 Universal name `N`

The canonical universal name is:

```text
petname.Abstraction#issue
```

For example:

```text
church.Bank#1
alice.Cryptography#4
```

The name is the portable locator and human-facing identity. It is not a
runtime capability and it does not contain a Namespace slot.

The issue number is part of `N`. It distinguishes one valid issuance from
another and participates in the identity seal.

### 2.2 Content token `T`

`T` is the universal, issue-blind content token for the canonical LUMP
content. It verifies what bytes or canonical genotype were supplied. It is not
a capability and authorizes nothing.

The issue number is deliberately excluded from `T`:

```text
same canonical content + different issue number → same T
```

but:

```text
different universal issue identity → different N and identity seal
```

This distinction allows content identity and issuance identity to remain
independent. Re-issuing unchanged content must not silently produce a
different content token merely because the issue number changed.

The full binary/content digest may also be stored alongside `T`. The compact
32-bit `T` and a full `binary_hash` must not be treated as interchangeable:

- `T` is the Namespace content-token/cache value used by promotion and
  restore paths.
- `binary_hash` is the stronger full-artifact content fingerprint.
- `identity_hash` seals the complete universal name, including its issue.

None of these values is a local GT.

### 2.3 Local Golden Token binding

A runtime Golden Token contains destination-specific authority, including
information such as:

- local Namespace index;
- local slot sequence/generation;
- capability type;
- permission domain and permission bits.

The sequence/generation is the local slot-version counter used for revocation
and stale-capability rejection. It is incremented when a slot is revoked or
reused. It is not portable and must not be included in a LUMP's universal
identity.

The same portable dependency may therefore bind differently on two machines:

```text
Machine A: church.Bank#1 → NS[54], sequence 3
Machine B: church.Bank#1 → NS[12], sequence 8
```

The portable LUMP is the same. The target images are different.

## 3. Canonical portable representation

A portable LUMP must preserve, in its canonical representation or associated
integrity-covered relocation metadata:

- its universal name `N`;
- its issue number and identity seal;
- its content token `T`;
- its full binary/content digest where available;
- each declared dependency's universal name;
- required permissions and capability type;
- the C-list row in which each dependency is used;
- the compiler-owned symbolic `Self` reference;
- the canonical code and data.

The canonical representation must not use these as identity:

- a local Namespace slot;
- a local slot sequence/generation;
- a locally minted Golden Token;
- the current simulator's device registry;
- the order of unrelated LUMPs in the compiling machine's Namespace.

Local GTs may exist in a linked or loaded image, but they are destination
materialization and not the portable LUMP's canonical identity.

## 4. `Self` is an intrinsic symbolic reference

`Self` is not an ordinary global pet name that the compiler should search for
in the active device registry.

It means:

> The current LUMP's own universal identity `N`.

For a Bank LUMP, the symbolic meaning is equivalent to its canonical identity,
for example:

```text
church.Bank#1
```

The compiler-owned C-list row zero must therefore be represented as a symbolic
Self reference during portable compilation. The final Self GT is materialized
only after the destination assigns the LUMP a local Namespace slot and current
slot sequence.

The sealed portable value is the symbolic universal identity. The
slot-bearing Self GT is a local binding and must not be allowed to alter the
portable content seal.

This distinction explains the error:

```text
Capability "Self" is unresolved in the active namespace/device registry.
```

That message indicates that the compiler has invoked a local linker too early.
It is not evidence that the Bank source has a missing user declaration.
Compilation should succeed once the source and universal identity are valid.
Failure to bind Bank locally belongs to the install, run, or FPGA-load phase.

## 5. Compiler responsibilities

The compiler is responsible for creating a portable artifact.

### 5.1 At compile time

The compiler must:

1. Parse universal pet names and canonicalize their spelling.
2. Validate the name format and issue number.
3. Validate requested permissions, capability domains, and declared types.
4. Preserve every dependency symbolically.
5. Record the dependency's C-list row and required rights.
6. Add the compiler-owned Self reference without treating it as a registry
   dependency.
7. Compute or preserve the canonical identity and content seals.
8. Produce a relocatable C-list representation.

The compiler must not:

- require the dependency to be installed in the active Namespace;
- resolve a universal name by matching only a short local label;
- write a local NS index into the canonical LUMP;
- mint a destination GT as part of ordinary compilation;
- silently replace a universal name with whichever local LUMP happens to have
  the same display name.

### 5.2 Compile-time diagnostics

Compilation may still fail for errors intrinsic to the portable artifact,
including:

- malformed universal name;
- missing issue number;
- duplicate or ambiguous canonical dependency identity;
- invalid permission letters;
- incompatible permission domain;
- invalid capability type;
- malformed source or generated code;
- a manually declared compiler-owned Self row.

Compilation must not fail merely because a valid universal dependency is absent
from the current device.

## 6. IDE responsibilities

The IDE needs to expose the difference between portable compilation and local
binding instead of presenting both as one operation.

### 6.1 Separate statuses

The IDE should show at least these states:

#### Portable

The source and canonical dependency declarations are valid. The LUMP can be
saved or transferred.

#### Resolved on this device

The IDE has found a destination Namespace object whose universal identity and
content token match the requested dependency.

#### Installable dynamically

The dependency is not currently resident, but a verified and authorized
install path exists.

#### Not loadable here

The destination cannot currently satisfy the dependency. Examples include:

- no matching universal identity;
- matching name but wrong `T`;
- content digest mismatch;
- untrusted or unauthorized fetched artifact;
- insufficient rights;
- incompatible capability type;
- stale or revoked local binding.

The last category is a load/install diagnostic, not a compile diagnostic.

### 6.2 Display both names and bindings

For each dependency, the IDE should be able to show both forms:

```text
Universal: church.Bank#1
Content T: 0x........
Local binding: NS[12], sequence 8
```

If no local binding exists, the universal name must remain visible and the IDE
must not replace it with an empty name or a guessed local slot.

### 6.3 Save and export

Save/export must preserve the portable universal references and their
relocation rows. It must not accidentally serialize the current simulator's
materialized GTs as if they were canonical dependency identity.

A portable export and a target-specific boot/upload image are separate
representations:

```text
portable LUMP → verify/link for destination → target image
```

## 7. Secure dependency resolution

Name matching alone is not sufficient. The correct resolution chain is:

```text
universal name N
    → locate candidate
    → obtain candidate token T
    → verify candidate content against T
    → verify full identity/content seals
    → authorize installation
    → allocate or locate local Namespace entry
    → mint local GT
```

The loader must reject a candidate that claims the correct name but has
different content.

### 7.1 Resident dependency

For an already-installed dependency:

1. Locate it by universal name.
2. Confirm its stored `T` matches the requesting dependency.
3. Verify the resident content against `T` and its full digest where present.
4. Confirm the full trusted identity, including issue.
5. Check that the resident abstraction grants the requested permissions.
6. Read its current local slot sequence.
7. Mint the required local GT.

### 7.2 Missing dependency and lazy load

“Install if missing” is not an implicit trust decision.

For a missing dependency, the loader must use the same trust boundary as any
Home-Base or lazy-load operation:

1. Fetch the artifact from an authorized source.
2. Verify the fetched content against the expected `T`.
3. Verify the full content digest and universal identity.
4. Apply the human/IDE trust gate required for unverified provenance.
5. Allocate memory and register the Namespace entry.
6. Materialize the requesting LUMP's local GT only after installation commits.

The registry must never be trusted merely because it returned an object with
the requested display name. A failed verification or authorization must leave
no partially installed Namespace entry or usable capability.

## 8. Destination binding and FPGA loading

The FPGA loader acts as a linker and installer for the target machine.

### 8.1 Load sequence

For a portable LUMP or boot-image build:

1. Parse the portable LUMP and relocation metadata.
2. Verify its universal identity `N`.
3. Verify its content token `T`.
4. Verify the full content digest and any required trusted identity.
5. Resolve every dependency by universal name.
6. Verify each resolved dependency by its expected `T`, not by name alone.
7. Apply the required trust/authorization gate for fetched dependencies.
8. Allocate dynamic Namespace slots where needed.
9. Read the destination slot sequence/generation.
10. Mint destination-local GTs with the requested rights and type.
11. Patch the target image's C-list rows.
12. Bind and verify the boot entry.
13. Commit the Namespace records and image atomically.

If any step fails, the load must fail closed and preserve the prior valid
Namespace state.

### 8.2 `Self` during FPGA loading

For a dynamic LUMP such as Bank:

1. Use the LUMP's universal identity to identify the object being installed.
2. Allocate its destination Namespace slot.
3. Register the object with the current local slot sequence.
4. Mint the local Self E-GT.
5. Write the local Self GT to compiler-owned C-list row zero in the target
   image.
6. Materialize the remaining dependency rows.
7. Commit the installation.

The FPGA does not need to understand a global Namespace slot. It receives a
fully localized image in which each GT points to a local slot and carries the
current local sequence.

### 8.3 Resident and lazy-loaded LUMPs

The same identity rule applies to both resident and lazy-loaded LUMPs:

- resident LUMPs are verified and bound while constructing the boot image;
- lazy-loaded LUMPs are verified and bound when the loader promotes them;
- neither path may treat a local slot as the LUMP's universal identity;
- both paths must verify `N → T → content` before creating usable authority.

The Namespace Table remains authoritative for what is actually installed in a
particular image. A catalog or manifest may help locate an artifact, but it
must not override the destination Namespace state.

### 8.4 Wukong upload

Wukong receives a hardware-specific localized image, not an unmodified generic
portable representation.

The upload path must:

1. complete universal identity and content verification before projection;
2. resolve and materialize destination-local GTs;
3. project the resulting Namespace and selected resident LUMP into Wukong's
   fixed 16K-word forward-table DMEM layout;
4. validate the projected descriptors, headers, C-list, and capacity;
5. upload the complete image;
6. reboot only after the board acknowledges the valid image.

The universal pet names and content tokens remain the basis for verification.
The projected image contains the local slots and GTs required by that FPGA.

## 9. Security and portability invariants

The implementation is correct only if all of these remain true:

1. The same portable source and universal identity produce the same portable
   artifact on different machines.
2. Destination Namespace slots may differ without requiring recompilation.
3. Destination slot sequences/generations may differ without changing `N` or
   `T`.
4. A candidate with the right name but wrong `T` is rejected.
5. The issue belongs to `N` and its identity seal, but not to issue-blind `T`.
6. The symbolic Self identity is portable; its slot-bearing GT is local.
7. Missing dependencies cannot be silently installed without verification and
   authorization.
8. Revocation and slot reuse are enforced through the local sequence/generation.
9. No canonical LUMP identity depends on a local GT or local NS index.
10. All C-list relocations are applied atomically before the image becomes
    executable.
11. The Namespace Table, not a loose catalog, determines what is resident in
    the target image.

## 10. Acceptance examples

### Example A: Bank compiles without a local Bank slot

```text
Source abstraction: Bank
Universal identity: church.Bank#1
Declared external capabilities: none
Compiler-owned capability: Self E
```

Expected result:

```text
Compilation: PASS
Portable LUMP: produced
Local Bank binding: pending
```

The IDE may later report that the current FPGA cannot load Bank, but it must not
reject the portable compilation merely because Bank has not yet been assigned
an active local slot.

### Example B: Same LUMP on two machines

```text
Portable dependency: church.Bank#1
Expected T: 0x12345678
```

Machine A:

```text
church.Bank#1 → NS[54], sequence 3 → local GT A
```

Machine B:

```text
church.Bank#1 → NS[12], sequence 8 → local GT B
```

The portable LUMP and `T` are unchanged. Only the destination bindings differ.

### Example C: Name collision with altered content

```text
Requested: church.Bank#1
Expected T: 0x12345678
Candidate: church.Bank#1
Candidate T: 0x87654321
```

Expected result:

```text
Load: REJECT
Reason: universal name matched, content token did not
```

This is why name matching alone is insufficient.

### Example D: Re-issue without content change

```text
Issue 1: church.Bank#1
Issue 2: church.Bank#2
Canonical content: unchanged
```

Expected result:

- `N` and its identity seal change.
- `T` remains unchanged.
- The destination may still apply separate trust or ownership policy to the
  new issue.

## 11. Summary

The portable LUMP model is not a two-way split between a name and a local GT.
It is a three-way model:

```text
N = universal name       — what abstraction/issuance is intended
T = content token        — whether the content is the expected content
B = local binding / GT   — how this target authorizes it here
```

The complete rule is:

> **Compile universal names. Verify the expected content token. Resolve names
> to verified content. Materialize local bindings only during installation or
> FPGA image generation.**

That boundary makes LUMPs transferable without weakening tamper detection,
trust authorization, or local revocation.