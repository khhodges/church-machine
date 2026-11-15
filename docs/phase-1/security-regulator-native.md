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

### Conversion feasibility finding (unchanged ISA/RTL)

**The full approved conversion pair cannot be implemented with the currently
exposed native mechanisms.** This is an architectural conflict report, not a
completed conversion implementation. No conversion methods were exported, no
live bindings were changed, and no ISA/RTL change is proposed here.

The decisive counterexample is a valid Inform in an allowed caller register.
MakeOutformM must produce an Outform while leaving its object, binding and other
holders intact. Native arithmetic can construct the desired *data word*, but
there is no exposed raw DATA-to-CR installation operation that accepts that
Outform:

| Candidate path | Why it does not satisfy the contract |
|---|---|
| SAVE / DREAD / BFINS / DWRITE / M-authorized LOAD | SAVE exposes token bits in scratch; arithmetic changes DATA only. `ChurchMLoad.FETCH_GT` rejects type 2 with `OUTFORM_UNAUTH`, even with M, before consulting the target Namespace. |
| Internal `sub_direct_gt` | A hardware subroutine input, not a programmer instruction. `hardware/load.py` exposes direct loading only for NULL and drives the direct GT to zero. CALL/RETURN use internal direct loading for their own protected execution state, not arbitrary selected caller CRs. |
| TPERM | Changes/checks permissions, not representation type; cannot create the missing Outform. |
| RETURN keep mask | Can retain an already-held selected GT, not construct a new representation. |
| Writing Thread homes followed by CHANGE/SWITCH | Changes execution context and invokes restore machinery; not a raw write of the current selected CR. This is not authority to forge protected frames or to change an object's binding. |
| Simulator Outform LOAD | `_execLoadAccepted` takes the resolver path or the legacy loader/promotion path, even when the legacy manifest says the object is already loaded. It does not install the requested Outform unchanged. |

This rejects the general pair; it does **not** prove that every individual
MakeInformM case is impossible. An already-held Outform can be left untouched,
and an independently validated local Inform can in principle be materialized.
However, changing type bits or treating the Outform slot as an Inform slot is
not proof of the same object's local binding. The current candidate has no
native, authenticated identity-to-local-binding conversion protocol. Neither
the simulator's host identity registry nor its resolver is an acceptable
substitute. Missing binding must remain a normal nonzero return with the exact
Outform retained, never an attempted LOAD of that Outform and ensuing HardFault.

#### Contract disposition

These are required acceptance cases, **not passing conversion tests**:

| Input / condition | Required result | Evidence / remaining gap |
|---|---|---|
| NULL | Same NULL, nonzero DR1 | Existing selector can detect NULL without loading it; conversion entry points are absent. |
| Valid Outform to MakeOutformM | Exact unchanged Outform, DR1=0 | Keep-mask retention is available; native validity protocol still needs definition/implementation. |
| Valid Inform to MakeInformM | Exact unchanged Inform, DR1=0 | Existing descriptor/version validation offers a building block, not an implemented conversion. |
| Inform to MakeOutformM | Outform, identical non-representation attributes | Blocked at raw Outform installation. |
| Outform with valid local binding to MakeInformM | Inform of that exact object, identical attributes | Requires proven native identity/binding lookup; no implicit fetch or version refresh. |
| Missing / unfinished binding | Exact same Outform, nonzero DR1 | Must retain the original CR rather than re-materialize it; not implemented. |
| Permissions, type, B, F and other attributes | Preserve SR-entry attributes except representation fields | SAVE clears B in the stored copy; entry B is normally zero after CALL. F is shared Namespace authority, not a token bit. A conversion must not mutate it or the binding. |
| Selectors 0–4, 7–10 | Operate only on the chosen caller CR | Existing native selector tests cover these helper paths, not conversion acceptance. |
| Selectors 5, 6, 11–15 or out of range | Nonzero DR1, all candidate inputs retained | Existing helper rejection tests apply; conversions remain unexported. |
| Returned failure | Exact selected GT retained | Must avoid selected-CR writes before success; architectural HardFault has no rollback promise. |

`hardware/test_sr_conversion_boundary.py` exercises the actual mLoad FSM for
every allowed destination, multiple permission encodings, nonzero and maximum
versions, and B-clear/B-set raw inputs. It asserts `OUTFORM_UNAUTH`, no CR,
Thread-home, memory or version writes, no download start, and no success pulse.
Only the scratch address is read: presence, absence and F of a target binding
cannot affect this earlier gate. This proves containment of the attempted
materialization, **not** software-status rejection or exact-attribute conversion.
The test deliberately does not bypass ingress with a debug-port Outform result.

Next decision: reconcile the approved conversion contract with the absence of
an exposed Outform installation mechanism and specify native local-binding
evidence. Any architecture proposal needs separate review; this report neither
authorizes changes nor weakens the existing Outform authentication gate.

SWITCHM's public indexed input compiles and its input/fault boundaries are
tested. The corrected exact candidate completes the two-Namespace round trip
diagnostic is not used as evidence for this candidate.
in the maintained RTL model, as detailed below. The earlier fixed-binding
Physical hardware parity, safe production provisioning, non-Inform MintM and
the two conversions are not claimed complete.

### Exact SWITCHM qualification

Reproduce with:

```sh
python -m pytest docs/phase-2/cooperative-retry/test_security_regulator_switch_candidate.py -q
```

This is a **successful RTL-model round-trip test**, not physical acceptance. It uses
the isolated `candidate_mediated_fixture` memory/boot patterns and maintained
RTL core, with two disposable roots at byte addresses `0` and `0x10000`,
SYSTEM Thread slot 2 in each, separate callers, replicated exact SR bodies,
and explicit per-root M-control recipients. Both callers load an explicit-L
GT into CR1 and issue actual `CALL CR11, #2`. Separate runs select public
DR1 row **1** and **3**; only the selected row names the opposite Namespace,
with other rows NULL. This is not the earlier SR-private fixed-row-2 diagnostic.

The first exact-byte attempt rejected `0x2f788001` with `INVALID_OP`: the
old source supplied destination 15, while RTL requires target zero. The user
then approved correcting the candidate/compiler encoding and requalifying.
The source now says `SWITCH CR1, DR1`; the ordinary assembler emits target zero
for this indexed source/row form, preserving the legacy destination forms.
No experimental handoff compiler profile or instruction translation is used.
Only declared C-list binding words are localized. Unused private
bindings are NULL; SWITCHM needs only SELF and MControl. The binary is pinned:

| Evidence | Value |
|---|---|
| Source SHA-256 | `ac9f3c46bf80425cf0be25a00d7c303b45c24283b82b95b8fb8ba9312ba88196` |
| Unbound binary SHA-256, little endian | `f2d72bb5997c970c5d170103f82a21620e289839f920605eb76f9ee6437dffd1` |
| Size | 512 words / 2,048 bytes |
| SWITCHM dispatch word | word 3 = 43 (`0x2b`) |
| SWITCH word | word 51 = `0x2f008001` (LE bytes `01 80 00 2f`) |
| First-root physical SWITCH address | `0xa0cc` |

Complete SWITCHM instruction words, offsets 43–55 inclusive:

```text
97308156 b77b4000 b8800009 075b0010 af304301 c7330006
8f358000 07584000 2f008001 af084000 1f000000 af084002
1f000000
```

The full-core replay reaches that exact SWITCH after the actual CALL and
M-control DWRITE, with CR1=`0x1a00000b` (explicit L) and DR1=1 or 3. It observes
native writes into the first SYSTEM home (`0x1000`–`0x13ff`), the root
transition to `0x10000`, the second caller's actual CALL into its local SR,
and the second SWITCH's writes into its SYSTEM home (`0x11000`–`0x113ff`).
CR15 then returns to root zero. Execution resumes at `0xa0d0`, immediately
after the first SWITCH, inside the suspended SR call. Native RETURN runs,
and the first caller executes its post-CALL marker with DR1=0, CR12 still
SYSTEM slot 2, and the original caller's version, code location and extent.
No fault occurs. No callback supplies a successful return.

The restored SR code view is RX (`0x52000017`), whereas CALL initially
installs X (`0x42000017`); RETURN likewise reconstructs the caller RX view
rather than reset's X-only view. Tests compare the matching object identity,
location and extent with that explicit view change, not raw equality of
every transient descriptor. Context construction occurs only before execution;
runtime context saves and restores are entirely native.

Remaining implementation differences:

- Legacy destination-form SWITCH remains available for historical simulator
  sources; it is not an RTL Namespace handoff. This candidate uses the new
  public indexed source/row form and its required-zero target.
- `simulator/simulator.js` `_execSwitch` accepts isolated destination
  registers 12–15 and delegates to `_execLoad`; it does not perform the
  maintained RTL's outgoing Thread save, Namespace midpoint publication,
  and fixed-slot-2 incoming Thread restoration. A JS return after that reload
  would not establish the requested two-context round trip.
- The existing JS CALL B-clearing discrepancy noted above also remains.

Only the approved software candidate/assembler encoding boundary changed.
No ISA or RTL semantics, JS execution engine, live Namespace, saved image,
or physical operation changed. The success claim is specifically the
maintained RTL-model replay, not JS parity or production provisioning.

## Verification run

- Conversion-boundary investigation: `python3 -m pytest
  hardware/test_sr_conversion_boundary.py -q` passed all 45 cases;
  `node simulator/test_security_regulator.js` and `git diff --check` also passed.
  These are boundary/helper checks, not acceptance of unimplemented conversions.

SWITCHM qualification and candidate-build evidence:
- `python -m pytest docs/phase-2/cooperative-retry/test_security_regulator_switch_candidate.py docs/phase-2/cooperative-retry/test_candidate_switch_compile.py -q`:
  11 passed: both exact-candidate row selections and historical compiler-profile isolation.
- `node simulator/test_sr_switch_encoding.js`: passed, covering public indexed
  encoding, signed offsets, invalid source/index rejection and legacy-form isolation.
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
