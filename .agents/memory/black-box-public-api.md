---
name: Black-box public API
description: User-directed Church Machine encapsulation boundary for public API versus internal binding evidence.
---

The user requests: “Simplify the API to represent a black box and hide the details in the tradition of the Church Machine.”

**Why:** The interface should explain what a caller can invoke, supply and receive,
not implementation language, code offsets, allocation or dependency capabilities.
Repeated dependency permissions and metadata must not be presented as the public
calling contract.

There must be one canonical, bindable black-box API. The embedded API and the
API shown to callers must be the same definition, not a mixed internal record
plus a different filtered public definition.

**Why:** The user explicitly rejected the display-only separation. “Embedded”
describes where the API is stored, not a second kind of interface.

**How to apply:** Preserve public method selectors (never renumber after filtering
private methods), input/output conventions and caller-required capability types
and rights. All interface and binding declarations needed by the linking loader
must be in the one canonical API within the Build & Test LUMP, not separately
supplied linker metadata or a second API. Do not invent methods absent from
the authoritative artifact. Retain intrinsic binding evidence and immutable
historical bytes. The compiler, binding loader, attestation and readers must
agree on the serialized boundary; removing a UI heading alone does not implement
this decision. Until that coordinated transition, retain the exact compiler
records rather than breaking existing attestation with a display projection.

The API · Build & Test LUMP is self-contained for both bitstream construction
and lazy loading.

There must be exactly one minimal canonical JSON section serving a foreign
programmer, foreign IDE and linking loader alike.

**Why:** The user explicitly requires one definition containing everything
these consumers need, rather than consumer-specific APIs or supplementary JSON.

**How to apply:** Include public calling and symbolic binding contracts; omit
implementation detail and redundant information already defined by the binary
format. Minimality must not remove identity, rights or binding evidence needed
for safe foreign use. Destination-specific GTs remain the loader's output.

The canonical JSON must not duplicate details, permissions or names.

**Why:** The user explicitly requires a single definition of each fact, not
merely one JSON container holding repeated representations.

**How to apply:** Define each named entity once and reference that definition
elsewhere. Do not repeat equivalent permissions under both rights and grants.
Do not repeat facts already unambiguously defined by the binary format.
Keep semantically distinct authority requirements separate even when their
permission values happen to match; deduplication must not merge their meaning.

**Why:** The user explicitly rejects the linking loader consulting any other
information source to interpret the LUMP's binding contract.

**How to apply:** No source, editable copy, sidecar, catalog-derived declaration
or hidden compiler metadata may fill gaps in that contract. Required symbolic
imports, requested rights and binding evidence must travel in the canonical API.
The destination Namespace still supplies the actual target objects and live
versions to resolve and validate; it must not substitute an alternative API.
Reject missing declarations rather than reconstructing them.

The user approved retaining the existing binary content framing for the compact
canonical JSON and is willing to recompile affected LUMPs.

**Why:** Adoption is an explicit new-compilation transition, not permission to
rewrite historical artifacts or silently change an approved build.

**How to apply:** Coordinate producers, readers, loader and attestation around
the new definition. Preserve saved history and approval boundaries; do not
claim the format is adopted while only its displayed projection has changed.

Backward compatibility for the new format only needs to preserve loading the
unchanged original source of old revisions into the editor. Full inspection,
old API interpretation and legacy linking/execution need not be maintained
after the agreed cutover.

**Why:** The user explicitly accepts old LUMPs no longer being viewable provided
their unchanged source can still be opened and recompiled.

**How to apply:** Preserve exact source extraction from the old Full artifact
and exact-revision master links for Compact/API variants. Never substitute the
latest source or reconstruct stripped comments. If the original source cannot
be recovered, report that explicitly. This removes legacy runtime-format
support obligations, not historical retention or approval boundaries, and does
not authorize altering the currently running image during migration.

This format transition requires recompiling only the three code LUMPs selected
for the target build, not the entire library.

**Why:** The user explicitly narrowed the recompilation scope to those three.

**How to apply:** Recover their exact selected sources and prioritize the
compiler/save/loader changes needed for that build. Leave unrelated artifacts
alone. Still validate declared destination dependencies; do not silently
recompile or replace them. This is a migration scope, not a permanent limit
on future programs or Namespace membership.

Canonical dependency names must match explicit destination-Namespace identities;
the linking loader must not reconstruct aliases from the compiling IDE's private
leaf definitions or guess a match from suffixes.

**Why:** Removing the duplicated local name / canonical-leaf pair exposes a real
identity distinction between programmer-side aliases and Namespace object names.
A compact JSON definition does not by itself authorize translating between them.

**How to apply:** Treat source aliases as compiler inputs only. Carry canonical
binding requirements in the API, and resolve them against declared Namespace
identities. Changes to destination identity declarations require the ordinary
Namespace preparation and approval boundary; do not rename live assignments as
a side effect of recompilation.
