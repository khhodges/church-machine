---
name: Thread object runtime authority
description: Defines the single-source-of-truth rule for suspended Thread execution state.
---

The Thread object is the runtime context object and the only authority for one Thread's suspended execution state. Executable context lives in the canonical two-word CHURCH frame on its private stack, independently of mutable CR0; +18 is Heap. Do not add host-side maps, UI history, or cloned identity records that duplicate NIA or executable context. Hardware CALL, RETURN, suspension, and resumption address stack state through the resolved active Thread-body base.

**Why:** Parallel context stores can drift from the Thread object and make switching display or restore a state that CHANGE did not actually save. Deriving CR14 from CR0 similarly resumes the wrong code after a program uses CR0 normally.

**How to apply:** Preserve the existing DR0–DR15 and CR0–CR11 homes. Suspend by pushing the normalized current Enter GT plus packed NIA/FLAGS/SZ/STO; resume with RETURN-equivalent validation and CR6/CR14 reconstruction. Invalid or absent frames fault before handoff mutation.