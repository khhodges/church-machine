# Minimal Amoeba startup prototype

Status: executable CLOOMC experiment, not an installed initialization service.
Storage allocation, checkpointing and rollback are outside this prototype.

## Proposed minimal contract

1. Mint allocates a fresh zeroed Thread and primes its protected continuation
   to Amoeba's compiled `Start` body, retaining a poison root.
2. CR1 carries the application E-GT. It identifies the application, not Amoeba.
3. Amoeba initializes DR1 startup status and CALLs the application's first
   public method (`#0` in CLOOMC source). The application uses ordinary RETURN.
4. Amoeba reloads its declared permissionless `Boot.Thread` capability and
   CHANGEs back to the supervisor. The application's DR1 result remains in
   the suspended worker. Resuming a completed startup reaches HALT rather than
   running the application twice.

The supervisor binding is deliberately limited to this prototype. It is not
a general scheduler or a decision about production completion policy.
CALL/RETURN clears scratch capabilities; the supervisor capability therefore
comes from Amoeba's explicit c-list, not an assumed preserved CR2.

## Executable evidence

Source: `simulator/cloomc/amoeba_startup.cloomc`.
Run: `node simulator/test_amoeba_startup.js`.

The test compiles CLOOMC and preserves its method table and instruction words.
It executes supervisor CHANGE → Amoeba → application CALL/RETURN → supervisor
CHANGE. The test application returns 731; the supervisor resumes and writes
303. An unrelated Thread remains unchanged. Empty Thread and absent application
cases fault without entering application code.

## Important boundary

The disposable harness uses privileged host writes to supply Mint's proposed
fresh priming frame and application capability. Those writes are explicitly
test setup, not CLOOMC, not a working Mint Thread CREATE implementation, and not
proof that software can write protected context.

Amoeba cannot initialize a completely empty Thread by running inside it:
CHANGE needs an entry frame first. Mint's legal protected priming path is the
remaining prerequisite. This prototype demonstrates the code that runs after
that prerequisite, not its implementation.

The prototype test itself modifies no saved Namespace or hardware.

## Explicit IDE startup assignments

The IDE now supports an explicit saved startup NIA alongside a Thread's
entry and application bindings. A fresh simulation generates the protected
starting frame from these assignments. Reboot reconstructs the same pristine
frame, not a prior execution snapshot. Unmarked non-boot Threads remain empty.
The starting NIA must be within the selected resident entry LUMP's code.

This is private-image preparation, not operational Mint Thread CREATE.
The programmer must explicitly bind the selected Namespace's capability
references; choosing an entry/NIA does not implicitly grant or repair them.
The boot target is independent of these per-Thread startup assignments.
