---
name: Editor test contracts
description: Avoid false failures and false passes when testing guarded editor navigation.
---

Editor navigation fixtures must model a stable editor element, ownership epochs,
and explicit replacement consent, not merely provide missing function names.

**Why:** Guarded navigation can correctly decline a request when a fixture has
no editor, duplicates its DOM ID, omits consent, or cannot preserve the current
buffer. Those failures can look like broken navigation or missing source.

**How to apply:** Use real navigation guards and source-selection helpers.
Model acceptance or rejection explicitly. Keep display-only mocks separate
from ownership and source-authority decisions; never fix these tests with an
unconditional successful ownership check.

Saved-revision handoff tests should preserve the real callback, review receipts,
Namespace CAS, private admission and execution controls even when Save dialog
field-entry coverage is kept separate.

**Why:** Mocking Namespace writes or preparation can establish orchestration
order without proving that published bytes can actually become an executable
image. A passing UI refresh alone is insufficient.

**How to apply:** Use private storage and the explicitly supported profile.
Assert the refreshed History revision before execution can change the detail
selection; then compare the complete localized artifact and execute through
the normal boot-aware controls. Label in-memory restart simulation separately
from a full server-process restart.

Post-compile diagnostics must map the final artifact layout, including generated
dispatch entries and shared alias bodies, back to the original editor source.
Unknown or mismatched generated words must remain unlocated, never receive a
guessed source line.

**Why:** A branch audit used an obsolete displacement decoder while its location
mapping omitted the dispatch prefix, presenting a binary error against header
comments instead of the authored instruction.

**How to apply:** Test both backward-branch decoding and actual gutter/overlay
placement using the compiled layout. Distinguish stale test fixtures from
regressions by checking their failures against the unchanged baseline.

Repository loading and detail-navigation ownership must be independent.

**Why:** Cancelling an in-flight list response when the user opens a detail
leaves the list's loading placeholder stranded. Conversely, completing that
response must not overwrite the newer detail or History tab.

**How to apply:** Exercise explicit detail navigation during a delayed catalog
response: the list must finish, while the selected artifact and tab stay intact.
Newer list requests still supersede older list successes and failures.