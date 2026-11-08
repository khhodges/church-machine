# Simulator Hard Fault continuation

The clarified continuation rule supersedes the fresh-handler entry described
in the historical Boot fault-entry contract for simulator execution.

The saved `faultHandlerSlot` field previously selected an executable and caused
the simulator to overwrite Boot.Thread's homes and format a new poison-root
frame at NIA zero. It was runtime authority, not merely descriptive metadata.
It is now retained only for saved-document compatibility. No saved document,
LUMP, prepared image, or artifact identity is rewritten by this change.

Private design preparation binds the admitted Namespace root and its slot-2
Boot.Thread automatically, whether or not the old field exists. Explicit
boot/reset still uses the existing Namespace/LightningBolt startup path.
There is no separate fault-handler selection.

Hard Fault writes the original Thread/Namespace references and fault facts to
Boot's CR1/CR2 and DR1–DR5 homes, saves the outgoing Thread once, then uses
checked Thread activation without saving again. Other homes, the stack and
retained CHURCH frame are not reconstructed. Execution identity, NIA, flags
and STO come from that frame, not CR0 or a configured handler. The frame is
popped as an ordinary suspended continuation.

Invalid/missing continuations (including a fresh poison root), overlapping
source/Boot storage, failed stash, and failed activation remain catastrophic
stops with LED-loop status. No fallback executable or instruction retry is
introduced. Foreign fault references retain their original Namespace authority.

Checks: `node simulator/test_boot_fault_entry.js` and
`node simulator/test_design_simulation.js`; both are included in
`design-simulation-tests`. Historical exact-image replay outputs are not new
continuation evidence; re-running them may expose assumptions about fresh
handler startup. This work makes no physical FPGA acceptance claim.
