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