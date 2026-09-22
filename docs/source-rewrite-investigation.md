# Source rewrite investigation

## Scope and evidentiary limit

This was a read-only source audit. No saved LUMP, Namespace state, boot image,
browser storage, or other live artifact was changed, and the suspected event
was not reproduced against live data. Historical statements below cite the
immutable pre-containment base commit
`7322afd962e7ef9870d358d2da22bc86b20c17da`.

The original incident **cannot be proved from repository evidence alone**. Proof
requires the incident's exact text/bytes before and after, owner identity before
and after (type and key), and writer/ordering evidence tying that transition to
one code path. The immutable baseline proves that the transitions below were
possible; it does not prove which one occurred. Timestamps, a current buffer,
an abstraction name, or a “latest” manifest row are not
substitutes for exact before/after and owner evidence.

## Evidence status

- **Pre-containment evidence** is a writer present in base commit
  `7322afd962e7ef9870d358d2da22bc86b20c17da`.
- **Final state** describes the completed containment.
- **Remaining/out of scope** is kept separate from the original editor
  incident and its completed containment.

## Pre-containment source evidence and completed fixes

| Baseline writer | Code-supported transformation and owner key | Final state |
|---|---|---|
| CR-context draft switching | Editor input was stored as `cm_asm_src_<nsIdx>`. A CR/Namespace switch could replace the global editor from that key or `_stickyPatches[nsIdx].src`; clearing a patch could replace it with `""` (`7322afd962e7ef9870d358d2da22bc86b20c17da:simulator/app-cr-detail.js:200-252,274-280`). The only owner key was Namespace slot. | **Fixed.** CR detail tracks an inspected slot without transferring source ownership, no longer autosaves generic editor input under the slot, and no longer installs or clears editor source as a patch side effect. |
| Personal-tab startup migration | Startup looped over `church_user_tabs`, transformed each `tab.code` with `_migrateBfextBfinsSyntax`, and persisted the collection (`7322afd962e7ef9870d358d2da22bc86b20c17da:simulator/app-shell.js:478-505`). Records had `tab.id`, but no expected source hash. | **Fixed.** Shell startup preserves user-owned tab source; syntax correction is no longer an automatic persisted rewrite. |
| Asynchronous source-file open | A resolved `fetch('/' + path)` replaced the then-current editor and only afterward assigned path ownership (`7322afd962e7ef9870d358d2da22bc86b20c17da:simulator/app-shell.js:1002-1043`). | **Fixed.** Shell uses a compare-and-swap editor write guard based on request generation, captured text, editor identity, and typed owner. |
| Asynchronous library import | A resolved request replaced the editor with `data.source` and persisted it; request `path` was not checked against the current editor owner (`7322afd962e7ef9870d358d2da22bc86b20c17da:simulator/app-misc.js:418-443`). | **Fixed.** Library import verifies that the intended editor owner and text remain current before applying the result. |
| Asynchronous generated method | A resolved generation request replaced the editor with `data.source`; `{absIdx, methodName}` ownership was assigned only after replacement (`7322afd962e7ef9870d358d2da22bc86b20c17da:simulator/app-absdetail.js:1403-1437`). | **Fixed.** Generated source is accepted only while the initiating editor owner/text remain current, followed by an explicit owner transition. |
| Run startup restore/reconciliation | Startup could persistently rewrite a generic saved buffer, reopen a LUMP asynchronously, invoke an example loader while discovering authority, and automatically replace a divergent local draft with “authoritative” source (`7322afd962e7ef9870d358d2da22bc86b20c17da:simulator/app-run.js`, `loadEditorState` and `_reconcileAuthoritativeEditor`). | **Fixed.** Startup restores persisted source exactly; authoritative divergence is previewed and requires explicit acceptance rather than replacing the draft. |
| LUMP draft/save/open completion | LUMP helpers could apply syntax migration to stored drafts and complete delayed save/open work after editor ownership changed (`7322afd962e7ef9870d358d2da22bc86b20c17da:simulator/app-lumps.js`, `_migrateBfextBfinsSyntax`, `_saveLumpText`, `_commitSavedLumpClientState`, and `openLumpInEditor`). | **Fixed.** Syntax repair is preview-only, persisted user-owned bytes are preserved, and delayed completion cannot overwrite a changed owner or draft. |

Simple find/replace also literally changes source
(`simulator/app-editor-find.js:162-189`), but it is programmer-initiated and
dispatches an `input` event; it is not an automatic selection writer.

## Exact baseline source transformations

### BFEXT/BFINS persisted-source migration

The original helper in
`7322afd962e7ef9870d358d2da22bc86b20c17da:simulator/app-lumps.js` matched:

```text
(\bBF(?:EXT|INS)\b[^\n]*?)\bpos\s*=\s*(\d+)\s*,\s*w\s*=\s*(\d+)
```

and returned the unchanged instruction prefix followed by `#<pos>, #<w>`.
An exact illustrative transformation is:

```text
before: BFEXT DR1, DR0, pos=8, w=4
after:  BFEXT DR1, DR0, #8, #4
```

The helper was deterministic, but baseline callers in run startup, LUMP drafts,
and personal tabs could persist its result automatically. The final behavior
leaves persisted user source unchanged and limits correction to an explicit
preview/accept path. This confirms the mechanism and exact transformation; it
does **not** prove that it caused the original incident.

### Legacy Post-Flash SelfTest replacement

The immutable baseline
`7322afd962e7ef9870d358d2da22bc86b20c17da:simulator/app-run.js` used
`church_editor_legacy_selftest_tperm_backup_v1` and
`church_editor_legacy_selftest_tperm_migrated_v1`. It classified a saved buffer
as the retired built-in only when both of these patterns were present:

```text
; Church Machine Post-Flash Exhaustive Self-Test
...
TPERM CR0, X
```

If the one-time marker was absent, it backed up the entire saved source, called
`loadExample('post_flash_selftest')`, took the resulting `editor.value`, wrote
that full replacement to `church_editor_code`, and set the marker
(`7322afd962e7ef9870d358d2da22bc86b20c17da:simulator/app-run.js:12594-12660`).
The supported transformation was:

```text
before: exact saved legacy Post-Flash SelfTest containing TPERM CR0, X
after:  the full source supplied then by loadExample('post_flash_selftest')
```

This was a full source-selection/replacement mechanism, not a one-line `TPERM`
edit. Current run containment removes the silent persisted rewrite. Without
the incident's exact backup, resulting replacement, owner record, and ordering
evidence, this mechanism cannot establish what happened in the incident.

## Final executable-selection containment

Memory-idle executable reconciliation is disabled. `app-memory.js` treats
idle/catalog observation as diagnostic only and does
not replace Namespace-selected executable bytes. Run/lumps containment also
prevents background source reconciliation from silently changing the selected
editor document.

## Remaining automatic executable selection (separate from incident)

`POST /api/boot-image/generate` with `prepareRun: true` calls
`_prepare_run_candidates`, writes returned rows to `ns-state.json`, then writes
a newly generated boot image (`server/app.py:5215-5248`).

For each assigned executable row without an exact pin, it:

1. computes freshness and chooses the newest admissible artifact for the same
   abstraction (`server/app.py:6089-6117`);
2. replaces `filename`, `token`, revision/identity fields, and `binary_hash`,
   removing old runtime-test claims when bytes change (`:6127-6159`);
3. does this for all assigned executable rows; `artifactPins` are keyed by
   stringified Namespace slot (`:6170-6216`);
4. persists transformed rows before image generation (`:5236-5245`).

```text
before: NS[slot] -> {name, old filename, old token, old revision, old hash}
after:  NS[slot] -> {name, newest admissible filename/token/revision/hash}
```

The durable owner key is principally Namespace slot. Candidate discovery also
uses abstraction name and destination SELF compatibility; an exact pin carries
filename, token, and revision. Prepare/Run is explicit, but revision choice is
automatic when unpinned. It is a confirmed remaining executable-selection
writer, not evidence of the original incident.

`/api/boot-image/update-to-latest` is **not** active: it returns HTTP 410 before
its retained legacy implementation (`server/app.py:6219-6243`). Unreachable
code must not be cited as an incident cause.

## Out-of-scope admission and explicit selection behavior

Admission replaces the uploaded executable's first c-list/SELF word with an
E-GT minted from destination `slot` and incremented `sequence`, then hashes and
publishes the derivative (`server/lump_admission_service.py:461-492`). It
replaces the destination Namespace row with exact token, filename, and hash;
when `boot` is explicitly true it removes other boot markers (`:501-535`).

```text
before: portable bytes with original SELF word
after:  derivative bytes with SELF = EGT(sequence, destination_slot)
```

Its owner key is `(destination_slot, sequence)` embodied in the E-GT. Admission
requires explicit destination, replace, resident, and boot choices
(`:410-440`), so it is not an unprompted latest-selection mechanism and is
separate from the editor incident.

Exact boot-marker selection is also separate. The active endpoint requires
slot, revision, token, filename, and a Namespace fingerprint, rechecks the live
row, then moves the sole `boot: true` marker (`server/app.py:4496-4582`).
`server/namespace_plan.py:146-202` likewise uses exact
`{slot, seq, token, filename}` plus a state revision.

## Separate future hardening

1. Add compare-and-swap to `/api/source-file/save`; require expected prior
   hash/revision rather than truncating stale content.
2. Persist opt-in source/executable selection receipts containing action,
   owner-before, owner-after, exact content hashes, and request/Namespace
   revision. This is the evidence missing from the original incident.

Neither is evidence of the original incident. Explicit Prepare/Run remains
available with its displayed consequences; passive observation cannot invoke
it. Private regressions cover restored text, navigation/save races, CR
inspection, preview acceptance, and idle non-mutation.