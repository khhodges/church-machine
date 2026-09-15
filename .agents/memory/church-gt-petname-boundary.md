---
name: Church GT petname boundary
description: Defines the first-stage symbolic naming boundary between Church capability registers and Turing data registers.
---

Use petnames for every GT currently held in a Church capability register. Keep Turing data registers numeric and do not assign source-variable names to them yet.

**Why:** This Phase 1 architecture was explicitly approved on 2026-09-15. It preserves the Church/Turing split and gives capability-bearing state meaningful identity without requiring CLOOMC++ dataflow metadata for ordinary values.

**How to apply:** IDE register displays, traces, and disassembly should resolve CR-held GTs to petnames when identity is known. Use `Self` for the currently executing abstraction and forms such as `Self.c-list` or `Self.code` when the role needs clarification. Display DRs by register number and value only.