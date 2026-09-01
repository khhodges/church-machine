---
name: Thread object runtime authority
description: Defines the single-source-of-truth rule for suspended Thread execution state.
---

The Thread object is the runtime context object and the only authority for one Thread's suspended execution state. Do not add host-side maps, UI history, or cloned context records that duplicate NIA or machine context. Hardware CALL and RETURN must both address stack state through the resolved active Thread-body base; never substitute the CR12 root capability's location during boot.

**Why:** Parallel context stores can drift from the Thread object and make switching display or restore a state that CHANGE did not actually save. On Wukong, CR12 can remain the system Thread root at location zero while CHANGE tracks a relocated active body separately; mixing those bases makes CALL write a valid frame into the wrong object and RETURN read unrelated memory.

**How to apply:** CHANGE must save all DR0–DR15 values and its protected context into the outgoing Thread, validate every non-NULL saved GT through mLoad before mutation, and restore only from the incoming Thread. Thread status UI reads dormant state from that same object. Any stack push/pop RTL test should use a nonzero relocated Thread base and assert the exact physical frame addresses.