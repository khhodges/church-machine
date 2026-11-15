# Native SecurityRegulator candidate

This is an **offline implementation candidate**, not a complete SR release,
live Namespace installation, or hardware qualification.

Source: `simulator/cloomc/security_regulator.cloomc`.
Tests: `node simulator/test_security_regulator.js`.
Build: `node scripts/build-security-regulator.js`.

## Implemented surface

Public method indices are candidate-local, in this order:

| Index | Method | Input | Result |
|---|---|---|---|
| 0 | LOADM | CR1 source, DR1 home | Exact loaded GT in CR1, including NULL; status DR1 |
| 1 | SAVEM | CR1 destination, CR2 value, DR1 home | Stored copy has B clear; status DR1 |
| 2 | SWITCHM | CR1 explicit-L source, DR1 row | Status after another SWITCH restores the matching SYSTEM context |
| 3 | MintM | DR1 Ctype, DR2 permissions, DR3 slot | Inform GT in CR1, with current live version |
| 4 | SetB | DR1 selected CR | B=1 in selected CR |
| 5 | IncrementVersion | DR1 selected CR | Namespace version and integrity updated; selected CR=NULL |
| 6 | SetNear | DR1 selected CR | Authoritative F=0, refreshed selected descriptor |
| 7 | SetFar | DR1 selected CR | Authoritative F=1, refreshed selected descriptor |

Allowed selected registers are CR0–CR4 and CR7–CR10. Numeric selectors outside
that set return an error without selecting or clearing any register.
IncrementVersion clears a validly selected register on success and returned
failure, including exhaustion. Architectural HardFault does not promise cleanup.
ResetB is intentionally absent.

MintM currently accepts only Ctype=1 (Inform). Permissions use the native
four-bit encoding `(perm3 << 1) | domain`: domain 0 selects R/W/X, domain 1
selects L/S/E. E cannot be combined with L or S. B is initially zero.
Outform/Abstract creation is explicitly rejected, not silently approximated.
The indexed setters and version operation currently accept Inform targets.

F is **Namespace Word 1 bit 31**, not an independent bit in each 32-bit GT.
SetNear/SetFar therefore update the shared authority for the selected object,
without rewriting other GT words or their cached descriptors. The selected
descriptor is refreshed by native LOAD; version, permissions and integrity
remain unchanged. This follows the current representation, not a new GT format.

## Calling and private bindings

The first three methods clobber DR6/CR11; LOADM keeps CR1 on RETURN and SAVEM
keeps CR1/CR2. SWITCHM returns with the default keep mask after restoration.
The other implemented methods use DR1–DR15 as work registers, clear CR11,
and retain CR0–CR4/CR7–CR10 except for the specified selected/result register.
CR5 and protected CALL/RETURN state follow the architecture.

Helpers are **private intra-LUMP branches**, not CALLs. Their dispatch words
are zero. There is no helper CALL that would clear a newly set B.

The private C-list requires:

| Row | Binding | Required layout |
|---|---|---|
| 0 | SELF E | Candidate's own executable |
| 1 | MControl W | Existing one-word M-bit device |
| 2 | SRWork S | Private 64-word LUMP with three capability homes |
| 3 | SRWork RW | Same object; no ordinary L alias |
| 4 | Namespace RW | Actual active Namespace's tail-descending table, lowest address first |
| 5 | SRConfig R | Word 0: Namespace-table extent in words, a positive multiple of four |

SRWork home 0 (word 61) is SELF, home 1 (word 62) is temporary token data,
home 2 (word 63) preserves CR10 while materializing a result. Both temporary
words are cleared on normal completion. M-authorized LOAD is the only path
that turns constructed DATA into a GT. No host callback constructs results.
Full M-device writes preserve CALL-established CR6/CR14 M and enable only
the required extra bit; native instructions consume the extra grant.

Bindings must be private to the execution context. **Do not share this scratch
between concurrently executing Threads.** This candidate does not establish
production binding/provisioning or scheduler-safe sharing. It must not be
installed with a generic, shared public scratch object.

The Namespace extent is checked for alignment and slot bounds; ordinary R/W
capability bounds still apply. IncrementVersion validates the current version
and integrity before writing the new Word 1 and Word 2. Its native integrity
calculation uses the same encoding as existing Mint. A HardFault between the
two writes is not represented as an atomic rollback or returned failure.

## Returned status codes

| DR1 | Meaning |
|---|---|
| 0 | Success |
| 1 | Version already 511; no wrap or descriptor mutation |
| 2 | Invalid register selector or unencodable home/row index |
| 3 | NULL identifying GT |
| 4 | Unsupported GT type for this candidate operation |
| 5 | Invalid permission encoding |
| 6 | Invalid/unoccupied slot |
| 7 | Stale identifying GT version |

Architectural permission, integrity and bounds faults remain HardFaults.
No reporting acknowledgment is required.

## Evidence and remaining limits

The native tests cover LOADM/SAVEM through real CALL/RETURN, NULL load,
stored-copy B behavior, private M denial, every allowed SetB target, rejected
selectors, Inform permission encodings, nonzero versions, version exhaustion,
old-GT invalidation, integrity recomputation, and F updates with selected
descriptor refresh. Tests build disposable memory fixtures; they never import
the live server or modify saved Namespace/LUMP state.

The indexed tests supply B=0 at entry, matching the approved CALL/RTL contract.
The current JS CALL path does not itself reproduce all RTL B clearing; these
tests are not evidence that this separate simulator discrepancy is fixed.

**MakeOutformM and MakeInformM are not exported as success-returning stubs.**
The current M-authorized LOAD path is not a raw token installation primitive:
`hardware/mload.py` rejects a fetched Outform with `OUTFORM_UNAUTH` before
materialization, and the simulator's LOAD Outform branch invokes resolution
or promotion. Thus manufacturing an Outform word and LOADing it does not
implement “return the same Outform without loading.” No bypass, host
manufacture, lazy fetch, or ISA/RTL alteration has been introduced.
These conversions still require a compatible native mechanism.

SWITCHM's public indexed input compiles and its input/fault boundaries are
tested. Its complete two-Namespace round trip still needs exact-candidate
qualification; the earlier fixed-binding diagnostic is not that evidence.
Physical hardware parity, safe production provisioning, non-Inform MintM and
the two conversions are not claimed complete.

## Verification run

- `node simulator/test_security_regulator.js`: passed, including rejection of
  public CALLs to private helpers and denial of host GT construction except
  architectural CALL/RETURN code views.
- `node scripts/build-security-regulator.js`: produced a 512-word / 2,048-byte
  offline candidate and build/API metadata under the ignored
  `generated-artifacts/security-regulator/` directory.
- `git diff --check`: passed.
- The broader `node simulator/assembler_test.js` run did not pass: several
  fixtures lack mandatory canonical names, and it terminates in the Lambda
  emitter with `CALL requires a nonzero dispatch-table selector`. This is not
  a clean whole-project regression result; those paths were not changed here.
- `python -m pytest hardware/test_outform_mode2.py -q`: three tests passed;
  the core-integration case failed because it observed fault 11 rather than
  expected fault 26. It did observe no network activity or Inform promotion.
  This is not proof of the candidate's full hardware behavior. The explicit
  Outform rejection in `hardware/mload.py` remains the materialization limit.
