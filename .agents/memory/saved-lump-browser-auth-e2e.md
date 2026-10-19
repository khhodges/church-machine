---
name: Saved-LUMP browser authorization E2E
description: Browser authorization tests should use the real rendered Load into Sim control while isolating boot-image availability.
---

Saved-LUMP browser authorization coverage can use a canonical approved binary
fixture and stub only the catalog, detail, approval-intent, and deployment
responses. The page can provide a deterministic live-slot lookup without
requiring the separately generated boot-image endpoint to be fresh.

**Why:** The boot-image endpoint may return a stale-input response during local
E2E runs, which is unrelated to the authorization boundary and can prevent the
browser from reaching the test.

**How to apply:** Click the rendered detail-header Load into Sim control, assert
denials through the browser dialog, compare simulator state before and after,
and count the simulator load call for the accepted response.

Successful selected-design execution needs a real compiler-authenticated
fixture and real prepare/approve/activate responses, not the authorization
stubs above or whichever design happens to be selected in the workspace.

**Why:** A deliberately blocked saved design can prove rejection but cannot
establish successful Run, Walk, or Reset. Invented admission responses would
also miss integration failures between compilation and execution.

**How to apply:** Keep successful-execution evidence compiler-authenticated
and isolated from live selections; rejection-only or stubbed authorization
evidence cannot establish the successful-execution contract.