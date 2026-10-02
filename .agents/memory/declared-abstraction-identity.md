---
name: Declared abstraction identity
description: Programmer declarations, never generated fallback names, must establish an abstraction identity.
---
Do not manufacture an abstraction name from a method, expression, or display label. Missing declarations require a clear compile error and programmer correction; an explicitly declared name remains valid even if it resembles an old default.

**Why:** The user repeatedly rejected retaining automatic `RunAbstraction` naming or merely warning that it was inferred. They want the fallback removed, not presented more clearly.

**How to apply:** Apply this rule when changing frontend identity handling. Do not auto-edit stored source or saved historical artifacts to satisfy the declaration requirement.