# Native queue prerequisites: M conformance evidence

This is bounded simulator evidence, not a completed allocator, a new ISA
decision, or FPGA qualification. The authority is the master ISA's
[A.1–A.2](01-isa/instruction-set.md#a1-common-contract-and-notation).

## LOAD correction

The existing native LOAD implementation used source M to waive L but left
ordinary source M reusable. It now latches the authorization and consumes
ordinary source M before validation, including failure. Predication skips
execution before this point. Direct NULL discard uses no source M.
Boot and the persistent CR6 execution-context exception remain distinct.

An authorized M-assisted read of stored NULL clears the destination rather than
starting implicit resolution. Inform results retain generation/integrity
validation; M does not authorize a stale result. Source token permissions are
not rewritten and the result receives no transferred M.

`node simulator/test_load_m_consumption.js` executes assembled instructions
through `ChurchSimulator.step`, with offline disposable provisioning only.
It covers success, stored NULL, NULL source, row bounds, stale Inform result,
second use without reauthorization, ordinary L, direct NULL discard, CR6 and
condition-skipped execution. No host allocator or service callback executes
these operations. Fault instrumentation observes state at fault entry before
calling the real handler; it does not suppress faults.

The existing CR6 LOAD suite and native queue-component checks pass.
`tests/mint_phase1/result_containment_probe.js` has the same seven failing
cases on the unchanged baseline and this patch (17 pass, 7 fail). Its older
fault-name/bounds/alias assumptions are not a passing acceptance gate here.

## SAVE correction

Native SAVE now applies A.3: destination M waives only S, is consumed on
success or failure, and does not rewrite destination authority. Source GT
bits are stored values rather than admission credentials. The stored copy
has B cleared while the source keeps its exact GT and ordinary source M.
Ordinary S-authorized SAVE remains available without M, including B=0 input.
CR6's automatically established M does not grant S. Existing isolated-source
register restrictions remain separate from source-token contents.

`node tests/simulator/sim_save_s_only.js` covers S/LS round trips, source B=0/1,
source values versus destination validation, NULL, destination-M consumption
and rejection, SELF immutability, index/header bounds and skipped SAVE.
The historical FreeHandler execution expectations now reflect stored B clearing
and destination authorization; its source, bindings and inventory are unchanged.
The legacy direct `mSave` helper is retained as historical implementation;
the native SAVE path no longer uses its superseded source-admission policy.

## Still required

- SWITCH and the other regulator operations need their own conformance
  evidence; a passing LOAD test is not their proof.
- Integrate the clarified SecurityMonitor construction mechanism below into the
  private native service graph. No further M-rule or separate-device decision
  is required to implement it.
- The complete FIFO/TRANSFER lifecycle, independent Cleaner, custody/surrender
  proof and exact compiled service graph remain incomplete.

No saved artifact, Namespace binding, production inventory, RTL, bitstream or
physical hardware is changed by this correction.

## SecurityMonitor.Create(GTvars): resolved mechanism

The user clarified that SecurityMonitor packs a data word and reads it back
as a GT under its M ownership. This resolves the earlier construction-path
question. It does not authorize public minting, host callbacks or a permanent L
alias. No separate GTMint device was added.

`simulator/cloomc/security_monitor_create_data.cloomc` is an isolated native
DATA specialization, with executable register aliases:

| Role | ABI and authority |
|---|---|
| Slot / Version | DR2 / DR3, trusted Mint-supplied GTvars; checked for encoded range |
| Constructed type | Inform, DATA domain, RW, B=0; not a general Ctype implementation |
| ConstructionWord | CR7, private one-word W capability, **no L** |
| MControl | CR8, privately provisioned W authority to the existing M-control word |
| PackedWord / Work | DR4 / DR6, clobbered numeric data, not capabilities; DR5 preserved |
| Result / Status | CR1 / DR1; exact GT and success=1 only after cleanup |

Entry to this bounded component uses the current simulator CALL microcode's
CR6.M and CR14.M, with no other active M grants. The full-word
M-control write preserves both and sets CR7.M; LOAD consumes CR7.M and returns
CR1 with M clear. It does not claim that writing this mask preserves arbitrary
unrelated M grants. Success clears the construction word and private working
CRs before the authored RETURN. This cleanup is **not** a queue surrender proof.
Generation is supplied explicitly by trusted Mint, never advanced by hardware.

Run `node simulator/test_security_monitor_create_data.js`. The exact compiled
body packs and writes the word, writes the architectural M-control device and
LOADs the capability. The fixture forbids host construction of the result
after provisioning, compares native alias/raw instruction words, tests generations 0, 7 and 511,
and rejects absent M, absent W, stale generation and overflowing inputs.
The direct-entry checks stop at RETURN. A second native caller executes the
actual CALL, monitor body, RETURN and caller HALT; it verifies returned DATA
authority, cleared private working CRs, restored caller identity and a consumed
CALL frame. Only the faithful machine's existing code-view reconstruction for
those two executable identities is allowed through the host construction guard;
it cannot manufacture the target DATA capability.
Caller authentication, fault cleanup and concurrent invocations are **not**
proved by this component. Its single private word requires invocation
serialization before use by multiple callers.
The compiler's `passkey required` declaration is not proof of runtime
authentication in a direct-entry fixture.
