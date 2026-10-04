---
name: GT permission enforcement boundary
description: IDE-instance leaf ownership controls authored definitions; runtime M-bit operations are separate.
---

Each IDE instance owns its leaves in the global dot.name hierarchy and may establish or change their permissions. Human users need not be identified. This supersedes the earlier human-ownership and universally frozen-owner-permissions assumptions.

**Why:** The user explicitly confirmed IDE-instance ownership, including allowing the owning IDE's UART_TX RW declaration despite the historical W default. SELF remains compiler-owned E.

**How to apply:** Resolve ownership from the canonical global dot.name and trusted IDE hierarchy configuration, never short names, broad textual prefixes, human accounts, device defaults, mutable live grants, or client ownership claims. Foreign references preserve their definitions. Missing hierarchy configuration requires an actionable configuration error, not inferred ownership. Changes create ordinary new saved revisions; never rewrite history or implicitly install or change Namespace state.

Keep provisioning simple: a server-managed IDE node assignment, not human sign-in or a new global registration service. An independent IDE needs a new assignment; tabs and restarts remain the same IDE.

Formatter setup validation is independent of individual leaf decisions: even a SELF-only candidate must report an unavailable or malformed hierarchy lookup before opening review. Preserve the compiler-owned SELF exemption in the leaf policy itself.

**Why:** A transport/setup failure must not disappear simply because no candidate row happens to need a local or foreign ownership decision. This does not authorize inventing a node or changing SELF ownership.

**Why:** The user approved explicit IDE-node setup and asked to keep it simple. A locally chosen string is not proof of global hierarchy ownership; assignment remains the operator's responsibility.

Hierarchy setup validation must not make empty, SELF-only, or NULL-only programs depend on an IDE node assignment.

**Why:** These declarations make no IDE-owned leaf claim. Requiring configuration before checking for ordinary leaves breaks standalone compiler attestation and bootstrap artifact publication.

**How to apply:** Validate the entire configuration, including unused foreign definitions, whenever authoring checks an ordinary leaf. Keep compiler-owned SELF and NULL exceptions configuration-independent; Settings still reports the configuration's actual status.

Permission changes to a register-held Golden Token are a runtime M-bit concern, distinct from changing a leaf definition on its owning IDE. Permissionless Thread GTs remain valid for SWITCH/CHANGE. In `SWITCH CR12, Thread.1 ; CR6, #0`, the semicolon makes the remainder a comment: `Thread.1` is a pet name and must resolve through the active C-list to its current CR6 row.

Alias-key syntax and canonical hierarchy syntax are different contracts. Legacy Thread PetNames, including numeric and hash-separated instances, need exact configured aliases rather than fabricated canonical identities.

**Why:** Applying canonical-path grammar to alias keys blocked legitimate permissionless Thread declarations and made their intended configuration workaround invalidate unrelated authoring.

**How to apply:** Accept supported PetNames as alias keys while retaining strict canonical targets and exact-parent ownership. Test permissionless Thread references through actual compilation and saved-artifact publication, not just the policy helper.

**Why:** Definition ownership and runtime authority are different boundaries. A register operation cannot authorize rewriting a foreign IDE's definition, and a definition check must not ban legitimate runtime M-bit operations.

Pet-name resolution tests must establish the target's actual C-list binding from the saved artifact, not inject an assumed row. A configured Thread display name alone does not establish a C-list row. Do not infer that `Thread.1` universally means row 45.

**Why:** A synthetic row-45 fixture passed while the real saved CapabilityTest contained only eight entries and no Thread target; cache and compiler-path fixes alone could not resolve that missing binding.

**How to apply:** Keep syntax, permission-domain, target, and token-shape validation at compile/save time. Defer authority enforcement to the runtime M-bit mechanism. Pickers may show sensible existing defaults without making them a compiler prohibition. Feed names from live Inform GT rows, including Thread instance names, into the assembler's C-list pet-name map before compiling bare named `SWITCH` operands. Compilation can happen before Run or from a restored browser draft; in those states, recover the owning saved LUMP and resolve against its immutable C-list rather than requiring live CR6. Because assembly is synchronous, cache the exact immutable words while the saved LUMP is opened asynchronously; normalize the server's wrapped `{words: [...]}` response instead of assuming a bare array or waiting for a post-boot preload.
