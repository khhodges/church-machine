# Save LUMP → executed private image

Run `npm run test:save-realignment` (requires Python/pytest, Node/Playwright and
system Chromium). The launcher creates disposable storage **before importing
the server** and removes it on exit. Do not point the test at an existing server.

The fixture follows `test_portable_simulation_handoff.py`, with freshly compiled,
approved canonical artifacts and a complete minimal supported saved-Namespace
profile. It uses no live catalog selections. A loopback HTTP server binds a
random port; isolated mode disables external startup services, and the browser
and server reject hardware requests. Live LUMP hashes and the private shared
boot-image sentinel are checked even on browser failure.

The browser loads the actual IDE. It compiles and approves through real HTTP
endpoints, then invokes `_lumpSaveRequest` with the **verbatim post-save callback
extracted from app-run.js** and frozen lexical inputs. This deliberately tests
the callback/backend handoff rather than Save dialog field entry. Extraction
fails loudly if its boundaries change. Protected-change review uses the real
confirmation button and receipt. Namespace writes, preparation, approval,
activation, History rendering and simulator Step are not stubbed.

Coverage:

- Legacy `CapabilityTest` Namespace label → `ide.CapabilityTest`, exact artifact
  identity and full body comparison (only destination-local SELF differs).
- Same token/new revision refreshes an already loaded History panel.
- Repeated unchanged-source saves keep the same canonical filename/token/hash
  while advancing History, Namespace and the whole private machine. Shared
  hash approvals cannot relabel archived catalog rows as the current revision.
- An unsaved Namespace draft blocks alignment but not artifact publication.
- A competing real HTTP CAS wins between read and write; stale rows are rejected.
- Expiring a preparation immediately before activation leaves old memory intact
  and Step/Run/Walk blocked.
- Browser reload plus a fresh in-memory preparation store retains the barrier;
  explicit retry rebuilds from the exact committed artifact. This models lost
  process-local preparation state, not a full OS-process restart.
- Preserved unrelated rows, immutable artifacts, unrelated History, and retained
  approved configurations.

The concurrency test delays one real Namespace GET response while a second
client commits; it does not fabricate Namespace writes. The only backend failure
injection clears ephemeral preparation tickets before real activation validation.
Execution follows the generated boot via Step and stops once the source's return
value is computed, before a top-level RETURN. No PC, capability or data register
is patched to obtain that result.
