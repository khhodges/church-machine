---
name: GT permission enforcement boundary
description: Records that authored-permission policy belongs to runtime M-bit enforcement, not compilation.
---

Permission changes involving an existing Golden Token are a runtime M-bit concern. The compiler, capability materializer, and server save admission must not reject a program merely because declared permissions differ from known authored permissions. Permissionless Thread GTs remain valid for SWITCH/CHANGE. A source-level M-bit annotation on `SWITCH` is not a pet name and must not require name resolution when explicit CR source and row operands already determine the encoding.

**Why:** Compile-time rejection applies runtime authority policy at the wrong boundary and prevents valid programs from compiling or being saved. Registry grants can still describe type envelopes and support diagnostics, but they are not a compile-time equality rule.

**How to apply:** Keep syntax, permission-domain, target, and token-shape validation at compile/save time. Defer authority enforcement to the runtime M-bit mechanism. Pickers may show sensible existing defaults without making them a compiler prohibition. For annotation-only syntax, validate the annotation's lexical shape but do not couple compilation to a local registry or capabilities-block lookup.