# Compact LUMP API adoption — revised incremental plan

Scope: the agreed single, minimal, bindable JSON contract. This is incremental
work alongside the original Namespace handoff assignment, not a claim that the
Namespace/FPGA deliverable or any live-format cutover is complete.

Compatibility requirement: preserve exact original source recovery only.
Legacy LUMP display, API interpretation, linking and execution are not required
after the explicitly approved cutover. Historical bytes remain immutable.

Recompilation scope: only the three code LUMPs selected for the target build.
Do not migrate or recompile the whole library. Determine exact source revisions
from the approved target selections, not latest catalog entries. Existing
destination dependencies still require validation, not automatic recompilation.

1. **Contract and validation — implemented, no cutover.**
   Define the single JSON contract and standalone strict validator, including
   the 130-byte WCH fixture, geometry, permissions, target identity locks,
   duplicate rejection and deterministic serialization. Document unsupported
   special bindings as explicit rejections, not silent loss of evidence.
   See `docs/compact-lump-api-contract.md`.
2. **Recover the three target sources — verified for the discussed revisions.**
   SelfTest v99 and WukongCallHome v19 were recovered from their hash-verified
   exact Full companions; CapabilityTest v42 has its source embedded. All three
   unchanged sources were successfully compiled without publishing any revision.
   First use and verify the existing Open Original Source path for those three
   selected revisions; fix only missing source-recovery support that blocks them.
   Load the selected revision's Full master.
   Compact/API copies follow only their exact master link. Preserve comments
   and whitespace and fail explicitly when the master/source is unavailable.
   Do not substitute the latest revision or rewrite historical bytes.
3. **Compiler, three-form saving and attestation — implemented for the target path.**
   Server compilation emits canonical JSON; save-plan compares the exact fresh
   compiler contract. Isolated tests exercise actual approval/save and all three
   retained forms, exact Full source recovery, and rejection of altered selectors.
   Canonical artifact preparation leaves C-list words unresolved; executable
   localization is not compiler publication.
   Complete representations for any additional supported binding categories
   before enabling them. Emit the new canonical JSON, preserve it unchanged in
   every derived form, and validate it identically at real save-plan and save
   endpoints. Keep the Full master and its exact linked Compact/API copies.
   Coordinate writer and validator changes before switching either live.
4. **One API presentation — implemented.**
   Display the embedded canonical definition directly. Remove the separate
   projected Public API. Keep accurate stored-byte accounting and source access.
5. **Linking, test and bitstream cutover — pending.**
   New-format readers mechanically decode the canonical definition, but this is
   NOT completion of destination linking. The current saved Namespace calls its
   objects LED_DEV, UART_DEV, Thread.2, Thread.3 and Boot.Thread; compiled APIs use
   owned names such as kjhh1.LED0, kjhh1.UART_TX, kjhh1.Thread2, kjhh1.Thread3 and
   kjhh1.BootThread. Destination-owned identity declarations are needed; neither
   suffix guessing nor IDE-only alias tables may supply missing binding authority.
   Do not describe the new forms as ready for a hardware build until this gap is
   resolved and the destination-only linking path is tested.
   Use only the exact approved new-format API/Build & Test code LUMP. Bind
   declared references using destination Namespace authority, never private
   compiler metadata or source. Validate actual destinations and reject missing
   or incorrect identity, rights or generation; no recovery substitutions.
   Preserve Namespace/Thread structural state and all approval/residency rules.

After these steps, the programmer recompiles the three target code LUMPs,
approves their new revisions, and verifies their methods, exact JSON, linked
execution and actual allocation. WCH must expose Run in its canonical API.
The 128-word estimate is not an assertion that a new artifact is installed.
