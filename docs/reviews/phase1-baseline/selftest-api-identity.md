# Phase 1 SelfTest API identity: selected-byte mismatch

Date: 17 October 2026. CTMM requirements: **RES-SelfTest**, **IDE-04**.
Authority: [approved target](approved-target-namespace.md).
Machine-readable evidence: [exact selection and byte fields](selftest-api-identity-evidence.json).

## Finding

The selected bytes genuinely declare **RunAbstraction**, not **SelfTest**.
The displayed warning is correct. It is not caused by catalog activity,
compact-API decoding, destination binding, or a UI identity lookup. No runtime
code change or binary rewrite is justified to suppress it.

This finding resolves the origin of the warning, **not** the selected artifact's
identity defect. The original selection and its warning remain intact pending a
separately authorized correction. No seal value is exposed as a user decision
or approval requirement.

## Selection provenance, not screenshot inference

Read-only inspection used `server/lumps/design-drafts/phase1.json`, the persisted
document used by `GET /api/namespace/design-v1?profile=phase1`. Its raw-file
SHA-256 at observation was
`33996122d1b63cc0617cfb4b5a2074c00f0cc223a9930fccf3d071713c12d858`.
It declares `phase1-nst-metadata-slot0-v1`, 256 slots, API-only output.
The exact slot-6 row is frozen in the evidence JSON:

- SelfTest, Resident, sequence 0, **not** the boot target.
- Filename `SelfTest.1.8b19abd7.lump`.
- Binary SHA-256
  `65f6e254b1f0a164f2d2163239f28e4521d792d8d96800b26cdbff607f77b5de`.
- Revision metadata 98, read from the saved row, **not inferred from the image**
  or a currently active catalog row. Filename and hash select the bytes;
  the revision number is not proof by itself.

The screenshot is corroborating visual evidence only. There is no captured
browser request proving which persisted/draft response was displayed at that
instant. The saved row reproduces its exact warning, but this report does not
claim the screenshot freezes every field of the saved file. In particular the
observed file spells slot 16 `ide.Alace`, whereas the approved target requires
`ide.Alice`. This unrelated discrepancy was not repaired or used to infer a
different SelfTest selection. The approved target remains authoritative.

The historical baseline's `ns-state.json` selection is not substituted for this
Phase 1 document. Nor is `phase1_seed()` taken as authority when a persisted
Phase 1 document exists. The seed happens to contain the same SelfTest pin.

## Direct byte evidence

All offsets below are zero-based. The file is **8192 bytes / 2048 big-endian
words**. The SHA-256 above matches the selected file in full.

| Evidence | Exact observation |
|---|---|
| Header word 0 | `0xfa87d001` |
| Header code extent / C-list count | cw = 500; cc = 1 |
| API frame | Word 501, byte 2004: `0xab0700be` |
| API JSON | Bytes 2008–2197 inclusive, 190 UTF-8 bytes |
| API name value | Bytes 2017–2030 inclusive: `RunAbstraction` |
| API JSON SHA-256 | `c88f932f4f4781e7cf2441d4e9b5fff2eef5cbb981d6d621e1896f95d8f23948` |
| C-list row zero | Word 2047: Inform E GT targeting slot 6, generation 0 |

Exact API text (not catalog or sidecar metadata):

```json
{"name":"RunAbstraction","language":"assembly","returnConvention":{"register":"DR0","description":"return value"},"methods":[],"capabilities":[{"name":"SELF","rights":["E"],"grants":["E"]}]}
```

The `SELF` capability label and slot-6 GT do **not** override the top-level API
name. They describe a capability row, not a declaration that the abstraction is
named SelfTest. This is an expanded legacy API (`methods` is an array), so no
compact-method expansion or name reconstruction is involved.

The projected 1024-word API-only allocation is a design estimate. It does not
change the original 2048-word file, install a reduced file, or prove either
footprint executable.

## Source-to-screen trace

1. `simulator/namespace-design-v1.js` selects the Phase 1 profile and fetches
   `/api/namespace/design-v1?profile=phase1`.
2. The route in `server/app.py` creates a `DesignStore` for
   `LUMPS_DIR/design-drafts/phase1.json` (the parent of `NS_STATE_PATH`).
3. `DesignStore.read_document()` reads the persisted document. `response()`
   calls `project()` on those exact rows, without reading a catalog.
4. For slot 6, `api_size()` reads only `selection.filename`, verifies the full
   selected `binaryHash`, unpacks big-endian words, and decodes the length-bounded
   JSON at `(cw + 2) * 4`. It directly compares `api["name"]` with `row["name"]`.
5. `project()` prefixes the diagnostic with `SelfTest:`; the browser displays
   `projection.warnings`. It does not replace the API name from a library lookup.
6. `binding_report()` is separate save/bind work. It is not called by this GET
   projection and cannot account for the name in this warning.

Result reproduced from the persisted design, read-only:

> SelfTest: Embedded API names RunAbstraction, not SelfTest; identity needs review

## Regression and limits

Run:

```sh
python3 -m pytest tests/server/test_phase1_selftest_api_identity.py -q
```

The regression checks the historical file's frozen full hash and exact API
bytes, then copies it into a temporary store for the production read/projection
path. Small independently packed control fixtures distinguish matching SelfTest
identity from RunAbstraction and another genuine mismatch. Absent, misleading
and malformed catalogs, opposite-identity unselected files and a misleading
sidecar do not affect the result. Missing or changed selected bytes stay
unresolved instead of falling back to a newer file. Every inspection checks
that the temporary tree and selected row are unchanged.

These are offline inspection tests, not execution tests. **RES-SelfTest and
IDE-04 remain Needs verification.** No instruction-body correctness, CALL entry,
binding authorization, simulator execution, RTL behavior or physical hardware
qualification is claimed. No catalog, selected/historical binary, Namespace
design, live image, installation or hardware state was changed.

### Observed verification result

The command combining `tests/server/test_phase1_selftest_api_identity.py` and
`tests/server/test_namespace_phase1_design.py` produced **17 passed, 8 failed**.
All **12** new identity cases passed. The eight failures are in existing Phase 1
HTTP save/reload tests: their shared `design_payload()` adds `ide.Proposed` with
`policy="Lazy"`, so the Phase 1 validator returns 409 before the expected review
response. No production code was changed here; these failures remain with the
separate approved-target save/reload work, not evidence of an identity failure.
The five other existing Phase 1 tests passed.

The IDE workflow was stopped. A read-only preview attempt returned connection
refused; no live UI acceptance is claimed and the server was not started.

Next: [separately staged correction proposal](selftest-api-correction-proposal.md).
