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
