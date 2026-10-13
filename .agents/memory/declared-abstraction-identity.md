---
name: Declared abstraction identity
description: Programmer declarations, never generated fallback names, must establish an abstraction identity.
---
Do not manufacture an abstraction name from a method, expression, or display label. Missing declarations require a clear compile error and programmer correction; an explicitly declared name remains valid even if it resembles an old default.

For the ascending Namespace migration, the user explicitly confirmed local ownership and approved only these Thread aliases: `Thread.2` → `kjhh1.Thread2`, `Thread.3` → `kjhh1.Thread3`, and `Boot.Thread` → `kjhh1.BootThread`. These are compiler permission aliases, not authority to select or install migration artifacts.

**Why:** The user repeatedly rejected retaining automatic `RunAbstraction` naming or merely warning that it was inferred. They want the fallback removed, not presented more clearly. The explicit Thread aliases preserve the separately approved local names without inventing identities.

**How to apply:** Apply this rule when changing frontend identity handling. Do not auto-edit stored source or saved historical artifacts to satisfy the declaration requirement. For these three Thread names, use only the exact approved aliases; do not infer aliases for other names or treat them as migration approval.