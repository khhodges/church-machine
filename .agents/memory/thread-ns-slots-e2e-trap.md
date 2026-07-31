---
name: THREAD_NS_SLOTS in E2E test GTs
description: Synthetic GT word0 index must not land in THREAD_NS_SLOTS or updateCRDetail forces crDetailTab='lump', hiding the panels under test.
---

## Rule

When writing E2E tests that inject synthetic GT values into `sim.cr[N]`,
the index field (`word0 & 0xFFFF`) must NOT be 1 or 45.

```
THREAD_NS_SLOTS = new Set([1, 45]);   // app-memory.js
```

If the index maps to a thread slot, `updateCRDetail()` sets `showThread=true`
which immediately forces `crDetailTab = 'lump'` — overriding whatever tab the
test expects to see (code/register/clist).

**Why:** NS slot 1 = Boot.Thread, slot 45 = IRQ thread. These are thread
LUMPs, not code abstractions. The showThread override is correct for real
use; it only bites tests that accidentally pick those indices.

**How to apply:** Use index=0x20 (32) in synthetic test GTs:

```js
// Safe X-perm GT (index=32, not a thread slot)
const X_GT  = 0x42000020;   // was 0x42000001 (Boot.Thread → broken)
// Safe R-perm GT
const R_GT  = 0x12000020;   // was 0x12000001 (Boot.Thread → broken)
```

The failing symptom is: `#crdPanel-code` and `#crdPanel-register` are
present in the DOM but `display:none` because the "lump" tab is active
instead.
