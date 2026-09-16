---
name: Live LUMP manifest uniqueness
description: How publication reconciles duplicate live runtime-token or destination records without destroying history.
---

Each publication must leave at most one live manifest row for its runtime token and published destination. Conflicting live rows are retained as archived history, not deleted. If publication replaces their filename, the old bytes must first move to a unique immutable archive locator and the retired row must point there. A save reservation compares against its exact live filename/version row so pre-existing duplicates can be reconciled without trusting manifest order.

**Why:** Token-only mutation and execution must remain fail-closed when records are ambiguous, while an exact, approved publication needs a safe way to repair legacy duplicate live rows.

**How to apply:** Perform reconciliation under the same cross-process lock and multi-file transaction as binary, approval, manifest, and Namespace publication. Never loosen token-only resolution to choose a winner.