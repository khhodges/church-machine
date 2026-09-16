# Trusted Compiler and Untrusted LUMP Admission

## Status

This document records the agreed normative architecture for locally compiled
and externally supplied LUMPs. It is the target for implementation. Existing
code may still contain legacy approval, resident-selection, freshness, and
SelfTest-specific guards that conflict with this agreement.

## Core rule

There are two distinct artifact paths:

1. The Trusted Home IDE compiler is authoritative for artifacts it creates.
2. An unknown or uploaded LUMP remains inert data until the Trusted Home IDE
   verifies it and Mint admits it.

Downstream code must not apply a second hidden approval system to an artifact
created successfully by the trusted compiler. The compiler's integrity-protected
output record is the evidence for that artifact.

The static/dynamic boundary is:

> The Trusted Home IDE verifies static properties before admission; the Church
> Machine enforces dynamic properties during execution.

## Trusted compiler path

For a locally compiled LUMP, Compile owns:

- syntax, instruction, operand, and entry-point validation;
- capability declarations and C-list construction;
- SELF construction and internal identity consistency;
- header, allocation, layout, and embedded-content framing;
- static type, permission, and reachability checks;
- binary and identity hashes;
- source and portable-content seals supported by the active trust regime;
- destination binding when the programmer explicitly chooses a destination;
- an integrity-protected output record naming the compiler identity and version.

A successful compiler result may still fail at runtime under the Church
Machine's dynamic ISA rules. It must not be rejected later merely because a
separate approval ledger, canonical-source reconstruction, fixed resident
profile, freshness policy, or special-case abstraction rule disagrees with it.

The compiler and the mechanism protecting its output record are part of the
Trusted Computing Base. Removing a redundant approval ledger consolidates trust
into the compiler; it does not eliminate the need to protect that trust.

## Unknown or uploaded LUMP path

An uploaded LUMP is untrusted. It must be stored and processed as inert,
read-only data. It must not be Entered, made live, installed as a boot entry, or
given an executable GT before all applicable admission gates pass.

### Gate 0 — provenance and transport

1. Confirm that this source is authorized to submit an upload. During bootstrap,
   this is explicit human authorization in the Trusted Home IDE; later it may
   be a connection capability.
2. Reject truncated, oversized, or impossible file representations before
   parsing the artifact.

### Gate 1 — structural validity

1. Validate the LUMP magic and declared format.
2. Validate the declared power-of-two allocation and supported size range.
3. Validate that code length and C-list count fit the allocation.
4. Validate code, freespace, and tail C-list placement.
5. Validate the embedded API/source frame, raw-DEFLATE source where declared,
   lengths, and zero padding.

### Gate 2 — claimed type and static capability validity

1. Validate the declared LUMP type.
2. Validate row-zero SELF and its required E authority.
3. Reject prohibited permission combinations such as XE.
4. Validate that the entry point resolves inside the declared code.

### Gate 3 — integrity

1. Verify the declared whole-binary hash.
2. Verify the identity seal and its projection into SELF.
3. Verify the source seal when embedded source and the applicable bootstrap
   mechanism are available.
4. Verify the portable or almost-binary seal before relocation.
5. Verify canonical filename/content binding when the artifact claims one.
6. Verify per-GT parity or ECC only if the normative serialized GT format
   defines it.

A check that is not implemented or not defined by the active format must be
reported as **unsupported** or **unavailable**. It must never be reported as
passed.

### Gate 4 — trust and authority

1. Verify supported signatures against the applicable trusted key.
2. Verify the name-to-token authority under the active trust regime.
3. Verify that the recomputed token is the specific authorized token.

During bootstrap, authority is supplied by the Trusted Home IDE and explicit
human authorization. Results must be identified as bootstrap-authorized or
human-vouched, not genesis-verified. Deferred genesis certificates or
portability seals must be reported as unavailable.

### Gate 5 — containment

1. Audit requested reachability against the capabilities the artifact is
   authorized to receive.
2. Statically reject prohibited attempts to write row zero or access protected
   structural registers where such attempts can be proven from the artifact.

Only after all applicable gates pass may Mint issue the E-GT that makes the
artifact live:

> Verification precedes vivification.

## Portable artifacts and local binding

Verification and relocation are separate operations.

1. Verify the immutable portable artifact and its portable seal.
2. Preserve that artifact and seal unchanged.
3. After the programmer explicitly chooses a destination, create a distinct,
   locally bound derivative containing the destination-local materialization.
4. Add local binding evidence to the derivative. Do not replace, rewrite, or
   reinterpret the original portable seal as a seal over the derivative.

The original proves the portable content. The local evidence proves how that
content was materialized for this Church Machine.

## Namespace placement and boot selection

Artifact verification does not select a Namespace slot or boot entry.

After compilation or upload admission, the programmer explicitly chooses:

- the exact artifact revision;
- the destination Namespace slot;
- whether to replace an existing entry or create a new one;
- whether the artifact is resident;
- whether it is the boot entry;
- whether to prepare and run the resulting image.

Removing automatic “eligible latest” and fixed-resident selection must not
create a fail-open default:

- no explicit selection means no new preparation or implicit run;
- ambiguity means stop and request a programmer choice;
- the IDE must never silently choose “latest,” an older revision, a resident
  substitute, or a different destination;
- an already prepared image may be run only as the exact identified image the
  programmer explicitly selected;
- newer or different compilations are visible comparisons, not reasons to
  silently replace or invalidate the selected bytes.

## Runtime enforcement

The Church Machine continues to enforce dynamic ISA rules, including:

- capability type and permissions;
- bounds;
- generation validity;
- NULL and unavailable capabilities;
- dynamic Namespace resolution;
- CALL and RETURN context;
- row-zero and structural-register protection;
- hardware and memory faults.

Static admission does not replace runtime enforcement, and runtime enforcement
must not silently repair, redirect, approve, or substitute an artifact.

## Persistence and delivery

Storage and hardware delivery may enforce only integrity and operational safety:

- atomic writes;
- corruption detection;
- image framing and size limits;
- exact-byte transfer verification;
- target compatibility;
- explicit programmer-selected history behavior.

They must not impose a second artifact-validity policy based on hidden
approvals, fixed abstraction identities, revision freshness, or special-case
post-compile C-list rewriting.

## Required migration direction

Implementation work following this agreement must:

1. Remove duplicate approval gating for Trusted Home IDE compiler output.
2. Remove fixed resident and hidden “eligible latest” artifact policy.
3. Remove SelfTest-specific post-compile validity and C-list mutation.
4. Convert freshness rejection into an exact, visible comparison requiring an
   explicit programmer choice.
5. Keep structural validation at every boundary that accepts untrusted bytes.
6. Implement the Gate 0–5 admission pipeline for unknown uploads.
7. Keep uploaded bytes inert until Mint admits them.
8. Preserve dynamic Church Machine ISA enforcement.
