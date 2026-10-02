---
name: Namespace Table is the bitstream LUMP source
description: The serialized Namespace Table, not the catalog manifest or loose files, determines which LUMPs are present in a bitstream.
---

The Namespace Table is the sole authoritative source of LUMPs and their metadata in a bitstream. Truth is ordered as: (1) the Namespace Table, then (2) the assigned slots and LUMPs represented by that table. The manifest is not authoritative for membership, metadata, identity, version, slot, size, or any other property.

Refresh capacity and Refresh Image must follow this same saved-slot authority, never require legacy catalog occupants or recover omitted bodies from the old image.

**Why:** The user explicitly rejected legacy rules after clearing slots left the capacity report demanding Tunnel and Ethernet.

**How to apply:** Validate the selected slot LUMPs and their real allocations. Saved Namespace/Thread design definitions are valid generated-body sources (see thread-lump-placement.md); otherwise report missing exact artifact selections rather than guessing from historical slots or catalog entries.

Every new or changed physical allocation must pass the same full-range check
under the Namespace commit lock, including replacement, growth, movement and
promotion to Resident. A client-side free-space check is advisory only.

**Why:** Add could install bytes before Save, while table-only Save checked
serialization rather than physical ranges, allowing overlapping assignments.

**How to apply:** Preserve rejected drafts without runtime installation. Size
from exact LUMP headers or architectural geometry, not access limits. Reserve
header/table/Thread space; do not invent absent catalog occupants. Permit
unchanged legacy defects during unrelated edits, but never new intersections.

Conflicting Namespace state must be inspectable and correctable by the user
through a general reviewed interface, not hidden behind symbolic-row labels
or repaired only through agent-written JSON. Clear/re-add is not an equivalent
repair because it changes capability generation.

**Why:** The user found that a design-only row hid a second executable identity
and explicitly required correction controls to cover all such cases.

**How to apply:** Expose both claims, field removals and unresolved diagnostics;
keep inspection read-only and bind application to the exact reviewed revision.
Explain type-specific restrictions rather than pretending every row is a LUMP.

Present Namespace audits as problems and how to fix them, not a general-purpose
metadata editor. Keep healthy evidence and advanced fields collapsed.

**Why:** The user explicitly found the full inspector too complex and asked to
see only problems with instructions for correcting them.

**How to apply:** Pair each confirmed issue with its relevant reviewed action.
Separate incomplete checks and dormant-image concerns from current blockers;
never hide them by claiming the whole configuration is valid.

A saved metadata correction is not proof that an entry is ready to execute.
Reinspect the persisted row and keep remaining binding and full-allocation
diagnostics visible; distinguish saved placements from private simulation
layouts and historical disk-image evidence.

**Why:** Fixing a conflicting assignment removed its superficial warning while
leaving incompatible token bindings and overlapping allocations undisclosed.

**How to apply:** Report what was saved separately from what remains invalid.
Never convert a successful table-save receipt into an “all fixed” claim.

Artifact lookup tokens are not runtime SELF capabilities. Never require their
equality or offer to rewrite the catalog token to cure that invented mismatch.
Validate actual SELF ownership against the Namespace slot and sequence, and
materialize the runtime descriptor from that verified authority.

**Why:** An IDE-only equality check rejected valid Alice/Mallory LUMPs and led
to misleading repair advice. The user explicitly required removing those
metadata blockers and following the Namespace layout.

**How to apply:** Exact Namespace-selected bytes outrank mutable catalog
records. Honor explicit saved locations; report real full-allocation overlaps
instead of silently relocating bodies. Keep actual integrity and capability
checks, and preserve original artifact lookup metadata.

This authority order also applies when saving LUMPs and Namespaces: an archived, missing, or
duplicated catalog row must not veto an independently verified Namespace
selection. Do not make catalog repair a prerequisite for a valid save.

**Why:** The user reaffirmed that the manifest is secondary and unreliable after
a stale archived flag blocked saving despite an intact Namespace-selected binary.

**How to apply:** Validate the Namespace locator and assigned bytes directly,
preserving integrity, authorization, CAS, and atomicity checks. Catalog metadata
must never select a replacement for authoritative Namespace state.

Apply this authority order at every save boundary, including browser selection,
image generation, and publication.
**Why:** Independent save paths can otherwise disagree about which bytes are authoritative.
**How to apply:** Preserve exact artifact identity across boundaries; distinguish
artifact hashes from descriptor seals that depend on physical placement.

Approval is bound to the complete reviewed Namespace revision, not just a
destination slot. A concurrent change requires fresh review; retries must not
silently fetch a new revision and reuse the old consent. Saving an artifact is
not permission to install it into the running simulator.

**Why:** The programmer explicitly required their approved Namespace to be the
only assignment authority after independent save paths produced contradictory
state. Preserving a slot number alone does not preserve the reviewed plan.

**How to apply:** Keep approved assignments, local uncommitted drafts, stored
image evidence, and hardware observations distinct. Invalid historical data
stays inspectable but cannot be silently normalized or published.

An assigned saved artifact is not automatically selected for an image. The boot
entry and explicitly resident bodies participate; dormant assignments remain in
the saved design but must not be probed, copied, promoted, or admitted as image
inputs. Generated architectural objects have their own construction rules.

**Why:** Preparation of CapabilityTest was blocked by missing compiler provenance
on unselected Tunnel because the preflight treated every filename-bearing row
as an image participant. The programmer explicitly required unselected items
to stay out.

**How to apply:** Use the same selection boundary for candidate resolution,
private staging, image generation, and provenance. Continue enforcing exact-byte
approval on selected bodies; never evade the check by dropping a selected item.

**Why:** The manifest contains catalog, lazy-load, example, and historical artifacts in addition to resident hardware content; treating it as authoritative makes Build Approval and image tooling report unrelated or stale LUMPs and metadata.

**How to apply:** Build-image generation and Build Approval must derive membership and metadata from the final Namespace Table and its assigned slot/LUMP data. The manifest may be treated only as an untrusted catalog or lookup aid, never as truth. Lazy/runtime catalog entries are not bitstream LUMPs unless explicitly represented in the Namespace Table.

The Namespace boot marker is part of that same authority and is protected by a
compare-and-swap transaction: marker and Namespace-save writes must carry the
read fingerprint and fail closed on a missing or stale fingerprint without
publishing any image, state, provenance, or compatibility projection. A boot
image's embedded entry, CR0, or other physical evidence is evidence of the
committed plan only; it can never select or override the Namespace `boot:true`
row. If the marker is missing, duplicated, or disagrees with a requested
entry, generation and startup inspection must report the actionable authority
error rather than infer a target from config, manifest history, browser state,
or image bytes.