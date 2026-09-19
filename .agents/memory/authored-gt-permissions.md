---
name: GT permission enforcement boundary
description: Records that authored-permission policy belongs to runtime M-bit enforcement, not compilation.
---

Permission changes involving an existing Golden Token are a runtime M-bit concern. The compiler, capability materializer, and server save admission must not reject a program merely because declared permissions differ from known authored permissions. Permissionless Thread GTs remain valid for SWITCH/CHANGE. In `SWITCH CR12, Thread.1 ; CR6, #0`, the semicolon makes the remainder a comment: `Thread.1` is a pet name and must resolve through the active C-list to its current CR6 row.

**Why:** Compile-time rejection applies runtime authority policy at the wrong boundary and prevents valid programs from compiling or being saved. Registry grants can still describe type envelopes and support diagnostics, but they are not a compile-time equality rule.

Pet-name resolution tests must establish the target's actual C-list binding from the saved artifact, not inject an assumed row. A configured Thread display name alone does not establish a C-list row. Do not infer that `Thread.1` universally means row 45.

**Why:** A synthetic row-45 fixture passed while the real saved CapabilityTest contained only eight entries and no Thread target; cache and compiler-path fixes alone could not resolve that missing binding.

**How to apply:** Keep syntax, permission-domain, target, and token-shape validation at compile/save time. Defer authority enforcement to the runtime M-bit mechanism. Pickers may show sensible existing defaults without making them a compiler prohibition. Feed names from live Inform GT rows, including Thread instance names, into the assembler's C-list pet-name map before compiling bare named `SWITCH` operands. Compilation can happen before Run or from a restored browser draft; in those states, recover the owning saved LUMP and resolve against its immutable C-list rather than requiring live CR6. Because assembly is synchronous, cache the exact immutable words while the saved LUMP is opened asynchronously; normalize the server's wrapped `{words: [...]}` response instead of assuming a bare array or waiting for a post-boot preload.