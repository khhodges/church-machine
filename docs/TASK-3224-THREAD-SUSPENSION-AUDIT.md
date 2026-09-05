# Task 3224 — Thread Suspension Architecture Audit

**v1.0 — 2026-08-28**  
**Scope:** documentation and durable-memory authority sweep

## Result

This task explicitly corrects the documented Thread ABI: it removes the
executable-identity word at `+18`, makes Heap begin at `+18`, and applies the
generic Church frame contract to Thread handoff. These are approved task-3224
corrections, **not** claims about the historical baseline.

The corrected layout retains protected context at `+17`, DR0–DR15 homes at
`+1…+16`, and twelve size-derived CR0–CR11 tail homes. Suspension now uses the
canonical two-word CHURCH frame on the Thread's private stack: a normalized
Enter GT for the current abstraction and the packed NIA/FLAGS/SZ/STO word.
Resume uses RETURN-equivalent GT validation and reconstructs CR6/CR14. No new
opcode, Thread field, scheduler-only restore semantic, CR0 alias, or parallel
identity cache is defined.

## Authority classification

| Behavior | Authority |
|---|---|
| Generic two-word Enter-GT plus packed-state frame | Pre-existing CALL/RETURN contract in `docs/call-stack.md` and ISA A.12 |
| RETURN GT revalidation and CR6/CR14 reconstruction | Pre-existing CALL/RETURN contract in `docs/call-stack.md` and `docs/architecture.md` |
| Heap at +18 and frame-based Thread suspension/resumption | Explicit approved correction in task 3224; the baseline current files instead documented +18/+19 and scheduler CHANGE behavior |
| DR0–DR15 and CR0–CR11 homes | Retained Thread context behavior documented in the baseline Thread layout; task 3224 expressly preserves it |
| Ordinary CHANGE instruction path for manual selection | Existing ISA instruction path; task 3224 expressly rejects a parallel UI/scheduler path |

## Removed stale claims

- `+18` as executable identity and Heap beginning at `+19`;
- CR0 as the resumed abstraction or CR14 source;
- resume at code word 1 without a canonical frame;
- handoff without a frame;
- durable-memory guidance requiring validation or persistence of a `+18` GT;
- architectural RETURN behavior that depended on simulator-only CR/DR
  snapshots outside the two-word frame;
- UI-specific memory notes that duplicated implementation behavior rather than
  recording a durable architectural decision.

This is a documentation and durable-memory audit result. Implementation and
generated-image conformance are verified by the focused simulator, RTL, and
boot-image work owned by the corresponding task steps.