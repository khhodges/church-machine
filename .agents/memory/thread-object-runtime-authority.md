---
name: Thread object runtime authority
description: Defines the single-source-of-truth rule for suspended Thread execution state.
---

The Thread object is the runtime context object and the only authority for one Thread's suspended execution state. Its executable GT lives at +18 independently of mutable CR0. Do not add host-side maps, UI history, or cloned context records that duplicate NIA or machine context. Hardware CALL and RETURN must both address stack state through the resolved active Thread-body base; never substitute the CR12 root capability's location during boot.

**Why:** Parallel context stores can drift from the Thread object and make switching display or restore a state that CHANGE did not actually save. Deriving CR14 from CR0 similarly resumes the wrong code after a program uses CR0 normally. On Wukong, mixing the CR12 root base with the relocated active body also sends stack frames to the wrong object.

**How to apply:** Canonical CHANGE must prevalidate every non-NULL CR home and the +18 executable GT before mutation; then save DR0–DR15, CR0–CR11, +18, and protected context into the outgoing Thread and restore only from the incoming Thread. Thread status reads the same object. Hardware persists NIA as a word offset and restores its byte address.