---
name: Namespace Add binding workflow
description: Single Add action validates bindings without implying execution readiness.
---
The user approved one Add to Namespace action, with binding validation automatic
after saving, instead of competing design-placement and executable-install buttons.

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
