# Abstraction → CLOOMC → editable LUMP

## Working agreement

Perform these four steps separately. Present the evidence and stop for the
programmer's review after each step; do not combine them into an unreviewed
implementation. Apply the process to Mint first, then reuse it for other
Abstractions.

GTs are runtime structures. The programmer designs their use and protection.
Do not introduce advance GT-meaning checks, inferred protection policy or
future-use rejection in the compiler, loader or setup process.

JavaScript implementing a specified CPU instruction is normal simulator work.
JavaScript implementing an Abstraction's allocation, authorization or business
logic in place of its compiled program is not a CLOOMC implementation.

## 1. Define the Lambda Calculus Abstraction, then its implementation boundary

**The top-level Abstraction definition comes first.** Do not start by
translating host helpers, listing opcodes or assigning registers.

First deliver:

- The Abstraction as a lambda expression, its formal parameters and body
  meaning; distinguish a top-level specification from a fully expanded term.
- The captured environment, explicit arguments and every remaining free name.
  State which dependencies close the Abstraction; no implicit host services.
- Application/reduction examples that identify the expected observable result.
- For a stateful Abstraction, an explicit account of state and effects, such
  as state-passing semantics. This notation grants no access to raw machine
  state and does not impose an implementation ABI.
- Successful and fault outcomes for each operation. Do not imply rollback
  without defining and implementing it.

Then deliver:

- Named methods, inputs, outputs, state and dependencies.
- Inventory of host/service helpers, with each responsibility assigned to
  source code, an existing instruction, test setup, or an exact unresolved
  interface.
- Current compiler evidence; distinguish ordinary compilation from a private
  lowering path.
- Precise interface questions without inventing ISA behavior or capability
  grants. Existing service-specific restrictions are not automatically retained.

**Review, in order:** Is this the intended Lambda Calculus Abstraction?
Are its environment, application semantics and effects correct? Does the
proposed implementation boundary preserve that definition, with
programmer-owned runtime policy and no hidden service implementation?

The mathematical lambda binder is not the machine `LAMBDA` instruction.
Source syntax, CALL/RETURN conventions, optional machine LAMBDA use, register
assignments and LUMP geometry are refinements—not the top-level definition.

Mint's first application: [Step 1 audit](mint-phase1/cloomc-step-1.md).

## 2. Implement one complete real path

For Mint, start with Create and the actual PkVerify dependency. For another
Abstraction, choose its first useful end-to-end method.

Deliver:

- Canonical, editable CLOOMC source with explicit method and capability ABI.
- A mapping from the reviewed lambda bodies, captured bindings and applications
  to that source; any semantic departure returns to Step 1 for review.
- Compilation through the ordinary supported compiler, without private
  post-assembly word replacement.
- Real dependency implementations or a clearly stated blocker.
- Execution of the emitted instructions from entry through returned result
  and its use by a real caller.
- A positive case, relevant boundary/failure cases, and evidence tying the
  executed bytes to the compiled source.

Tests may provision documented initial objects and inputs, drive instructions
and inspect outcomes. They may not implement the method, approve its request,
allocate its object, construct its returned GT, or repair registers/PC mid-run.
Test observation alone must not become a runtime authority source.

**Review:** Does the method actually run from these compiled bytes, with
software state stored and updated by the program? List unfinished methods
explicitly; rejection-only stubs do not count as implementations.

## 3. Deliver through the existing IDE

Deliver:

- A saved source-bearing LUMP and compiled dependencies.
- Explicit assignment to the intended Namespace slot, preserving unrelated
  entries and historical artifacts.
- Selection from the existing Namespace into the existing code editor.
- A verified round trip: open → edit → compile → save → reopen → run.
- A small meaningful source edit whose changed behavior is observed from the
  newly saved binary; restore the intended final source through the ordinary
  save path, not by rewriting historical evidence.

Keep source/editing form, execution form and destination binding distinct.
Do not transfer a hash or attestation from one form to changed bytes.
Do not clear an owned editor draft or overwrite unrelated saved work.

**Review:** Can the programmer edit and recompile the Abstraction without a
private script, hidden helper or substitute debugger?

## 4. Complete the methods and integrated set

Deliver:

- The remaining declared methods, each with explicit implementation status.
- Positive behavior using legitimately provisioned test inputs, plus runtime
  failure behavior. A credential that denies a method does not prove that
  method works for an authorized caller.
- Dependency and cross-Abstraction execution from saved compiled LUMPs.
- For Phase 1: the complete approved Namespace, including Alice and Mallory,
  preserving slots and labels. Distinguish intended runtime faults from
  unexpected failures.
- Per-Abstraction source, saved revision, executed-artifact identity and
  reproduction instructions.

**Review:** Does the complete set work, and can this process be repeated for
the next Abstraction? Record lessons as changes to this process, not exceptions
that hide host implementations.

## Checkpoint handoff format

Use this short record at the end of every step:

1. **Delivered:** exact source/artifacts/documents.
2. **Verified:** checks actually run and their results.
3. **Not established:** unfinished methods, untested paths and exact blockers.
4. **Changes made:** saved data, Namespace, runtime and hardware effects.
5. **Next review:** the specific decision or evidence to inspect before
   proceeding.

Never describe a compiler pass as runtime success, a helper-backed test as
compiled software, or an isolated scenario as full integrated acceptance.
