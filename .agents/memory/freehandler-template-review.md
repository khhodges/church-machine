---
name: FreeHandler template extension scope
description: Review C-list and Thread allocation built on the prepared data inventory; Namespace stays an IDE function.
---

Keep Namespace creation and configuration an IDE function for this extension.
Review new C-lists and Threads built on the prepared data-object allocation example;
the user proposes templates for Threads, typically larger objects.

**Why:** The user explicitly paused implementation to review this next step and
said to “assume Namespace is always an IDE function.”

**How to apply:** Present template and allocation contracts for review before
implementation. Do not treat this discussion as approval of a particular size,
GT encoding, runtime minting interface, initialization-owner change, or activation.

The user narrowed Phase 1 FreeHandler inventory to eight objects total: six
working data objects, one C-list with 64 slots, and one 512-word Thread.
Namespace remains an IDE function.

**Why:** The user wants the first example to cover all three object classes
without adding many large objects or a broader allocator.

**How to apply:** Supersede the earlier eight-data-object inventory for the
design review. The distribution of the six data objects, C-list physical
allocation, template bindings and method ABI still need to be settled; do not
silently preserve the old 1024-word pool geometry or implement during the pause.

Use fixed initialization rather than configurable templates in this version:
the 64-slot C-list starts entirely NULL, and the 512-word Thread is Amoeba-primed
with CR1 holding the application-service capability (the user corrected the
earlier CR0 proposal).

**Why:** The user corrected the expanded template proposal: “KISS is the rule
assume the clist is always empty (filled with NULL gts) and the thread is Amoeba
primed with CR0 application service.”

**How to apply:** Do not add prepopulated C-list grants, template selectors or
alternative Thread startup modes. Preserve normal Thread initialization rules;
this clarification is not authorization to activate a Thread or resume implementation.

The new-Thread API supplies the application-service GT for the new Thread's CR1;
it is not a fixed application binding selected during offline inventory preparation.

**Why:** After initially specifying CR0, the user corrected it: “My mistake CR1 is good.”

**How to apply:** Describe FreeThread as accepting that capability and returning
the prepared Thread GT. Keep the new Thread's saved CR1 distinct from the
caller's input register. CR0 remains the offline-primed Amoeba identity.

Prepare the Amoeba-primed Thread context offline in the template. Allocation
supplies the API's application GT to the new Thread's CR1; it does not need a
runtime Amoeba priming call.

**Why:** The user clarified that “The Thread template can include Amoeba primed
offline,” correcting the proposed per-allocation priming call.

**How to apply:** Separate fixed offline context initialization from the
per-allocation CR1 binding. Review the authorized context-write mechanism before
implementing it, without expanding the design into a runtime template engine.

FreeHandler's C-list grant and FreeCList result must be LS, never S-only.
The separate private Thread initialization grant remains S.

**Why:** The user explicitly corrected the S-only implementation: “The C-List
permissions must be LS not just S!”

**How to apply:** Preserve LS in source, API and prepared bindings. Treat a
runtime rejection of LS as a compatibility issue, not permission to narrow the
user's contract or bypass machine checks. S-only test results do not qualify LS.

Use descriptive grant names: FreeData0 through FreeData5, FreeClist,
FreeThread and ThreadSetup. ThreadSetup denotes private S authority to the
same Thread as FreeThread, never a separate object allocation.

**Why:** The user proposed these names to clarify why eight inventory objects
need nine object-grant entries.

**How to apply:** Keep the shared Thread destination explicit in any binding
or alias representation. A naming change must not allocate another Thread.

Inventory names need a block-specific dot-name component so a second block
does not collide with the first; the user proposed ide.B1.FreeData.

**Why:** The user explicitly raised naming for allocating a second block.

**How to apply:** Keep block identity separate from per-object numbering and
the established #issue suffix. B1/B2 is the proposed block component, not a
Namespace slot, physical address or GT version.
