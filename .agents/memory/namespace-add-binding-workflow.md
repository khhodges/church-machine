---
name: Namespace Add binding workflow
description: Add records placement and checks dependencies; explicit BIND alone materializes GTs.
---
Binding evidence must use a shared saved-assignment context across review and
execution preparation, not whichever resident subset a consumer happens to copy.

**Why:** Bind can review Lazy assignments too. Recomputing its evidence key from
only resident bodies makes legitimate explicit binding disappear at preparation
time. The reverse shortcut—ignoring changed Lazy destinations—can accept stale
authority. Source identity, destination generation and owner contract must stay
bound while residency filtering stays separate.

**How to apply:** Keep shared context normalization, invalidate old preview keys
when semantics change, require explicit rebinding, and exercise the real Bind
action in save-to-execution tests rather than implicitly granting SELF.

The user approved one Add to Namespace action, with binding validation automatic
after saving, instead of competing design-placement and executable-install buttons.

**Updated boundary:** The user subsequently specified that only clicking BIND
may materialize local GTs, including SELF. Add must preserve portable bytes;
automatic validation is advisory only, not creation of a bound derivative.
See portable-lump-binding-boundary.md.

**Why:** The two buttons exposed internal implementation stages and made ordinary
Mint placement confusing. Missing references should be named by validation,
not left for the programmer to discover through a separate install action.

**How to apply:** Preserve unfinished placements and explicitly report “saved,
not ready” when references cannot bind. Never infer resource provisioning from a
declared name, substitute newer artifacts, or activate a runtime/hardware image.
Binding checks passing still requires separate simulation preparation.

The Namespace toolbar also needs an on-demand list of unfinished abstractions
and missing resources, immediately ahead of Add.

**Why:** The user wants the current things to fix available from the Namespace
view rather than a static chat list.

**How to apply:** Recompute on each opening, identify the saved profile and source
of evidence, and keep this advisory inspection read-only.

Issues should form a top-to-bottom next-build review list with collapsible
details and an “Ignore for now” choice.

**Why:** The user wants to reduce detail and defer issues without losing the
remaining work list.

**How to apply:** Ignoring is a browser-local, profile-specific review choice,
not resolution or a build-check exemption. Keep ignored issues restorable and
return changed evidence to the active list.

Only items occupying slots in the selected Namespace belong in this list.

**Why:** The user explicitly excluded library-only abstractions from next-build
review.

**How to apply:** Use exact selected artifacts, not latest catalog revisions.
Attach absent-dependency details to the placed owner, never show absent
resources or unrelated source files as standalone items.

Every attention finding must include a concrete next step, including inspection
warnings.

**Why:** The user specifically called out missing-source warnings that explained
the limitation but not how to proceed.

**How to apply:** Give issue-specific actions. Missing source requires exact-
revision source evidence or an explicitly reviewed replacement, not a claim
that the binary is broken or that same-named editable source proves its contents.

Attention inspection must recognize both intrinsic source and the LUMP view's
verified exact-revision source companions; unverified sidecar text is not enough.

**Why:** Checking only the primary binary falsely flagged eight abstractions
whose verified source was already available in the LUMP view.

**How to apply:** Reuse the view's verification path rather than independently
inferring source absence; preserve genuine companion verification failures.
