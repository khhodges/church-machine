# Task 3446 — hardware-only action and transport audit matrix

**Scope:** The browser-to-hardware authority boundary and every browser action
that can precede it: Build, Save, Run, inspection/patch, and the Wukong
transport. The legacy `/ctmm/` editor and separately launched `ide/` service
are traced read-only so that their behavior is not mistaken for the main IDE.

**Disposition:** The supported physical path is Wukong bridge/server Runtime
Upload. A successful Build is only a candidate; a successful Save is an
approved immutable artifact; Run explicitly installs a candidate before
execution; inspection is observational unless a separately gated patch is
requested. No bridge, UID/session, artifact, approval, or inspection-binding
gate was removed.

## Requested restriction ledger

| Action | Required restriction | Evidence and disposition |
|---|---|---|
| **Build / Compile** | Require compile permission. Produce one immutable candidate from one source snapshot. Do not save, request save approval, install into simulator RAM, stop an installed program, or run implicitly. A failed build must leave the last valid candidate/installed image intact. | `app-compile.js:smartCompile`, `compileAndBuild`, and `app-run.js:assembleAndLoad` (`app-compile.js:692-774`, `:1466-1499`) use candidate-only mode by default. Capability materialization and errors return before candidate publication. **Retain.** |
| **Build / Compile** | Run structural LUMP audit before any download or repository save; audit errors block the artifact. Capability rows must resolve to valid GT bytes, with only the documented compiler-owned SELF marker allowed before destination allocation. | `app-compile.js:1744-1787`, `app-compile.js:2030-2073`, and `loadCLOOMCIntoSim` validation (`:2345-2377`). **Retain as integrity gates.** |
| **Save / Export** | Never turn a compatibility Save click into a hidden compile. The shared Save action may offer an explicit, confirmed “Build and Save/Export” operation; the compatibility `editorSaveLump` and Format entry points fail with an actionable current-candidate prerequisite. | `app-actions.js:131-164`, `:180-199`; `app-lumps.js:6985-7001`, `:7261-7304`; `app-run.js:showSaveToNamespace` (`:12531-12547`). **Retain.** |
| **Save / Export** | Consume the exact current candidate and source/words pairing. If the editor, active registry token, or registry generation changed between Format and confirmation, block rather than saving stale bytes; preserve diagnostics without committing them. | `app-actions.js:136-164`; `app-lumps.js:7296-7304`; `app-run.js:confirmSaveToNamespace` (`:15662-15731`). **Retain.** |
| **Save / Export** | Validate the exact final binary and c-list before durable state changes; bind approval to the server’s canonical final bytes, authoritative Namespace slot, and sequence. Do not client-side “first free” scan or reuse a browser provisional binary. | `app-run.js:15939-16075` and `_validateFinalLumpSaveBinary`; `app-lumps.js:7213-7237`. **Retain.** |
| **Run** | Never compile implicitly. Run requires a current candidate or a previously installed program. A stale candidate may leave an already-installed program running, but it may not silently install stale editor text. | `app-actions.js:64-71`, `:201-230`; `app-run.js:onRunBtnClick` (`:1534-1545`). **Retain.** |
| **Run** | Install only through the explicit Run/Load boundary, then validate capabilities and establish execution identity. The candidate remains out of RAM until `_applyPendingSimLoad`; boot/reset must not auto-install editor source. | `app-actions.js:201-220`; `app-run.js:1786-1955`, `:2445-2492`. **Retain.** |
| **Inspection** | Opening a Thread, CR, or Namespace view is observational. It must not invoke `CHANGE`, switch the live Thread, or silently mutate machine context. The UI must label live context versus saved snapshot. | `app-cr-display.js:158-270`, `:316-375`; `app-run.js` Thread modal helpers; `test_thread_inspection_patch_binding.js:114-121`. **Retain.** |
| **Inspection / simulator patch** | A patch must be paused and bound to the displayed CR, live Thread slot, Namespace slot, and Namespace generation. A running/Walking/booting simulator, changed Thread ownership, changed CR target, or stale generation blocks it. Refresh is explicit and never performs `CHANGE`. | `app-cr-display.js:216-259`; `app-cr-detail.js:998-1028`; `test_thread_inspection_patch_binding.js:66-112`. **Retain.** |
| **Inspection / hardware patch** | Materialize a byte copy only after the simulator patch passes; authorize the runtime destination and route the exact bytes through the same Wukong loader. Direct UART patch is not an alternate authority. | `app-cr-detail.js:1238-1267`; `webserial.js:77-87`, `:472-479`. **Retain.** |
| **Hardware upload** | Require deploy permission, Wukong board selection, Runtime target mode, a live matching UID/session, hardware-specific generation, queue acceptance, exact digest/size/identity, correlated ACK, and step-first startup. | `app-run.js:uploadToTang` (`:16536-16580`) and `_wukongLoadToHardware` (`:20528-20687`). **Retain.** |

## Matrix by control property

| Class | Finding and evidence | Disposition |
|---|---|---|
| **Essential security** | Compile permission is checked before either raw assembly or high-level compilation (`app-compile.js:725-729`). Hardware deploy permission is checked before view changes or target inspection (`app-run.js:16536-16541`). | **Retain.** A shortcut or compatibility caller cannot make an unpermitted build/deploy appear successful. |
| **Essential security** | Simulator Run uses `TargetState.authorize('simulator', …)` (`app-run.js:1957-1980`); hardware upload and FPGA patch use `authorizeDestination('runtime')` (`app-run.js:20521-20526`; `app-cr-detail.js:1238-1245`). | **Retain.** Simulator and physical destinations are distinct authority domains. |
| **Essential security** | Direct WebSerial patch/readback/run operations fail closed at the transport boundary because legacy UART framing cannot prove exact device UID/session (`webserial.js:77-87`, `:472-479`, `:610-614`, `:688-691`). | **Retain.** WebSerial is diagnostic-only, not a deployment or patch authority. |
| **Essential security** | Failed capability validation reports the error and does not load code (`app-run.js:234-250`; `app-compile.js:1710-1735`, `:2359-2377`). | **Retain.** Invalid or unresolved capability names cannot reach simulator RAM, Namespace Save, or hardware preparation. |
| **Essential security** | Inspection-to-patch uses the displayed target, not the current global selection; Thread ownership, pause state, CR target, and Namespace generation are rechecked immediately before mutation (`app-cr-display.js:216-240`; `app-cr-detail.js:1001-1028`). | **Retain.** A stale inspection cannot be turned into a write by changing selection behind the modal. |
| **Essential integrity** | Candidate snapshots freeze source, words, capabilities, labels, method table, and optional binary (`app-actions.js:9-31`, `:232-240`). Build publication occurs only after compiler, capability, structural, and binary checks (`app-compile.js:1737-1787`, `:2030-2073`). | **Retain.** Build is an auditable handoff, not mutable editor state. |
| **Essential integrity** | Save keeps the source/compiled-words pair and detects editor, token, and `registeredAt` drift across the two-dialog flow (`app-run.js:15681-15731`). | **Retain.** The approval dialog cannot authorize a different source or registry entry. |
| **Essential integrity** | The final save plan supplies canonical bytes, slot, sequence, approval intent, and plan ID; the client sends those final bytes rather than its provisional binary (`app-run.js:16041-16075`). | **Retain.** Namespace allocation and replacement remain server-authoritative. |
| **Essential integrity** | Format profiles expose API/compact/full choices; API-only output is disabled when source retention is required and warns when reopening cannot restore editor text (`app-lumps.js:7141-7185`). | **Retain.** A source-less artifact is not represented as if it were source-restorable. |
| **Essential integrity** | Hardware generation is `forHardware:true`, refuses nonresident hardware code, and the queue response must contain positive size, artifact identity, and SHA-256 (`app-run.js:20553-20623`). ACK correlation checks command ID, target UID, live session, digest, size, and identity (`:20626-20654`). | **Retain.** The browser never substitutes locally exported or unverifiable hardware bytes. |
| **Essential integrity** | Newly uploaded hardware is halted and requires a fresh Step before Run unlocks (`app-run.js:20671-20680`). Installed simulator candidates establish an `ExecutionIdentity` only after validated load (`app-run.js:1930-1953`). | **Retain.** Upload or build completion is not falsely presented as execution. |
| **Concurrency safety** | Simulator execution has `_simRunActive` across asynchronous batch gaps, and Run refuses a second active loop (`app-run.js:1053-1058`, `:1957-1965`). Thread selection and patch are blocked while running or Walking (`app-run.js:1489-1501`; `app-cr-detail.js:1013-1026`). | **Retain.** Double-clicks and asynchronous repaint gaps cannot create concurrent execution or mutate context mid-run. |
| **Concurrency safety** | Hardware command delivery is serialized with `_wukongCmdBusy`; a second upload receives an in-flight response and joins the existing polling cycle (`app-run.js:20184-20252`, `:20607-20617`). | **Retain.** A replacement command cannot overwrite the delivery evidence for an earlier command. |
| **Concurrency safety** | Save operation IDs, pending snapshot identity, repository plan IDs, and reconciliation/diagnostic candidates cover cancellation, transport ambiguity, and post-commit UI failure (`app-run.js:15776-15803`, `:16096-16272`). | **Retain.** Recovery does not blindly duplicate or claim an unknown save outcome. |
| **Concurrency safety** | Inspection refresh updates only the captured Namespace generation and retains the original CR/Thread; it does not follow a changed `selectedCR` or issue `CHANGE` (`app-cr-display.js:243-259`). | **Retain.** Refresh is an explicit optimistic-concurrency rebind. |
| **Incidental UI policy** | `IDEActionState` owns action eligibility and updates disabled state, tooltip, title, and `aria-disabled` for Compile, Save, Export, and Run (`app-actions.js:55-106`). Keyboard Compile/Save/Run/Export shortcuts call the same actions (`:242-264`). | **Retain.** UI affordances describe the same restrictions as the command boundary. |
| **Incidental UI policy** | Candidate-only Compile reports “Candidate ready” and names Save/Export/Run as the next explicit actions (`app-compile.js:2075-2091`). The LUMP source preview/build uses the shared compile command and explicitly avoids RAM installation (`app-lumps.js:1873-1993`). | **Retain.** Preview and Compile cannot masquerade as Install or Run. |
| **Incidental UI policy** | CR patch bar displays Thread/CR/Namespace/generation identity and offers “Refresh target” only when stale (`app-cr-detail.js:921-997`). Thread cards label active code versus saved entry/snapshot (`app-run.js:1107-1130`). | **Retain.** The user can see what inspection would mutate before choosing Patch. |
| **Incidental UI policy** | Hardware UI states the only supported transport and missing prerequisites, and `simulator/index.html:1455-1457` already exposes only Wukong. The removed `uploadToTang()` tail no longer offers a dead Tang/WebSerial upload. | **Fixed.** No index change was required for board support. |
| **Legacy behavior** | Compatibility `loadCLOOMCIntoSim()` delegates to the shared install action (`app-compile.js:2342-2349`), while `showSaveToNamespace()` and `editorSaveLump()` reject missing candidates instead of recursively compiling (`app-run.js:12509-12525`; `app-lumps.js:6985-7001`). | **Retain as guarded compatibility.** Old output links remain callable without bypassing Build/Save/Run restrictions. |
| **Legacy behavior** | The source-file Save/Save As and personal-tab Save actions persist editor text or browser user-tab state (`app-shell.js:571-585`, `:1086-1123`); they are not immutable LUMP/Namespace Save and do not authorize hardware. | **Record boundary.** File persistence is deliberately separate from artifact approval and deployment. |
| **Legacy behavior** | The reachable `/ctmm/` Save button says it saves to the current Namespace object (`web/index.html:583`), but `web/app.js:4024-4067` only updates editor state and `localStorage`; it does not persist a Namespace object. Undo and Clear update different subsets of that browser state (`web/app.js:50-87`, `:4042-4061`). | **Record only.** Legacy `/ctmm/` is out of scope for the main-IDE hardware boundary. |
| **Legacy behavior** | `web/app.js:182-183` writes `location.hash`; the traced legacy navigation has no `hashchange` or `popstate` handler, so Back/Forward can leave view and hash inconsistent. | **Record only.** Navigation repair is a separate legacy task. |
| **Legacy behavior** | Standalone `ide/ui.html:307-309` assumes successful `fetch()`/JSON and its compile handler (`:458-480`) has no rejected-request catch. `ide/server.py:220-230` does return transport errors, but the UI does not reliably surface them. | **Record only.** The standalone service is not the main `/simulator/` hardware authority. |
| **Legacy behavior** | Standalone source mode is backend-dependent: `ide/server.py:210-218` forwards `source_mode` only when the compiler signature accepts it; `ide/compile_client.py:128-193` does not accept it, while `ide/node_compiler.py:131-181` does. | **Record only.** This is a standalone/backend distinction, not a main-IDE hardware bypass. |

## Verification boundary

The focused regressions cover each requested restriction without starting a
browser or a hardware workflow:

- `simulator/test_build_action_state.js` checks immutable candidate state,
  stale-source Run rejection, explicit Build-and-Save messaging, failed-build
  preservation, and no duplicate compile/save-plan.
- `simulator/test_compile_save_roundtrip.js` checks candidate-only Compile,
  exact code/source pairing, no approval during Build, exact Save formatting,
  and a missing-candidate Save prerequisite.
- `simulator/test_thread_inspection_patch_binding.js` checks observational
  Thread/CR inspection, live-versus-snapshot labels, pause/Walk gates,
  Namespace-generation and Thread-ownership rejection, explicit refresh, and
  the inability to bypass the gate through the patch materializer.
- `simulator/test_hardware_upload_surface.js` checks that deploy has no
  direct `TangSerial`, Turing-gate, or `exportHardwareImage` implementation;
  routes live Wukong Runtime Upload; reports unresolved targets without a
  hardware request; and retains destination/artifact/ACK markers.
- `simulator/test_webserial_target_binding.js` covers fail-closed physical
  UART operations.

The audit deliberately does **not** classify source-file persistence,
`/ctmm/` navigation, standalone compiler transport, binary boot-entry
precedence, archived catalog filtering, or compiler `source_mode` support as
main-IDE hardware defects. Those are recorded above as separate legacy or
backend behavior with no authority to authorize physical deployment.

## Verification notes

Focused state, production assembly-result, compile/save roundtrip, frozen-save,
save reconciliation, Thread/patch binding, hardware-surface, and editor-menu
regressions passed. Final code review approved the state ownership and
authorization boundaries. Browser script cache keys are content-pinned,
including the new action module.

The browser pass confirmed successful candidate compilation, failed raw and
high-level builds retaining the previous candidate, language switching, and
explicit Build-and-Save reaching one format dialog followed by cancellation.
It exposed a stale-language identity issue and then a cached action-module
issue; a fresh-browser check after the fixes confirmed that the unchanged
candidate is Run-eligible. The app preview renders normally.

Coverage limits: no live save was committed, no board command was issued, and
the browser pass did not complete actual execution or other-Thread patch flows.
Those state transitions and rejection paths are covered by focused regressions,
not claimed as browser-tested. Existing boot fixture/catalog-authority failures
prevented the round-robin Thread suite from reaching its UI assertions; unrelated
historical full-suite failures are not represented as passing validation.