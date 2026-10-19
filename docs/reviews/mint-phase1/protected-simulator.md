# Protected Mint: isolated executable implementation

**Superseded operational status — 2026-10-19:** The programmer clarified that
LAMBDA RETURN preserves every CR; only CALL packets apply security cleanup.
The protected adapter previously erased CR10 immediately before returning.
That shortcut has been removed. A valid protected Lambda return now faults
`MINT_CLEANUP_UNBOUND` and quarantines the instance, before the first
publication or returned result. No legal early-erasure mechanism is yet bound.
The successful service runs and positive acceptance tests described below are
historical evidence, not current acceptance. Do not bypass the gate to restore
them. Current fail-closed coverage is
`node tests/mint_phase1/protected_lambda_cleanup.test.js`, also included in
`mint-authority-removal-tests`. Fault scrubbing is containment after execution
has stopped, not a successful RETURN cleanup operation.

**Scope: isolated simulator implementation, not full-profile acceptance, live
installation, production credential custody, RTL or hardware evidence.**

**Complete-set follow-through (2026-10-18):** the standalone evidence below
remains independently scoped. [Qualified protected Namespace acceptance](qualified-protected-namespace.md)
now connects it to the existing qualified linker with all 17 approved entries
and 10 private descriptors, complete API/source measurements and repeated
full-set scenarios. That report explicitly distinguishes normal operation,
Mallory's expected rejection, fresh startup variants and the source-bearing
form's capacity failure.

**Approved LS reconciliation:** the user explicitly chose one GT with combined
L+S in this isolated profile, rather than separate CR1/CR2 results. Thread-LS
and LS results therefore retain the single-CR1 ABI and `RETURN #2`. Only the
isolated subclass admits the exact Inform L+S combination; E combinations,
mixed domains and other GT types retain their original gates. Encoding and B
semantics are unchanged. The unrestricted legacy simulator still rejects
combined L+S. The four-type result check now passes.

The approved M1/G4/M2/M3 path is implemented in `simulator/mint/`. Run:

```sh
bash scripts/run-all-tests.sh protected-mint-path-tests
# Alternatively, discover it through pytest:
python3 -m pytest tests/mint_phase1/test_protected_runtime.py -q
```

This is not another synthetic context probe. The positive fixture starts a
properly provisioned Thread through the existing entry activation machinery,
executes assembled caller instructions, CALLs Mint, CALLs PkVerify, enters and
returns from two linked Lambdas, loads CR1 through ordinary L-only LOAD, returns
through the real protected CALL frame, then DWRITEs and DREADs through CR1.
It repeats allocation and actual use. No host assignment supplies CR1, no
host service returns verification success, and no synthetic service CALL frame
stands in for executing CALL. Initial boot frames are trusted provisioning,
including a retained poison root and a separate startup resume frame.

## Trust and admission boundary

`provision(plan)` is an **authorized initializer**, not a public client API.
It admits independently selected registry state, exact complete role bytes and
Namespace descriptors, canonical compiled service code, exact C-list rows,
checked Lambda links, disjoint physical ranges and explicit free-slot history.
It clones every input. The synthetic credential is reproducible test data, not
a production secret or a demonstration of G5/G6 persistent custody.

The only first credential is `0x06000000`: Owner 0, recipient `ide.Mint`, B=0,
Create types 1–4 in the explicitly bound Namespace, permanently empty
Replace/Destroy target sets. All five entry selectors establish admission;
selectors 2/3 then fault for absent target grants and 4/5 fault for absent
Genesis administration authorization. These negative paths are executed by
compiled callers, not tested by setting a host success/result flag.
The reusable credential is not confused with single-invocation verification
or publication permission.

An ordinary caller cannot call the provisioner from Church code. The public
runtime is a frozen facade with `step`, `status` and `control`. It exports no
core object, RAM, register arrays, events, callbacks, image serialization,
loader, Namespace editor or asynchronous activation hook. Node process/global
compromise remains compromise of the trusted host; this is not a sandbox
against an all-powerful Node operator.

### M1 and PkVerify

BEGIN validates the exact role and outer protected E companion, establishes
exclusion, then coherently captures credential, proof, request and payload.
Proof, the 40-word frozen request, the 12-word requester context and payload
snapshot occupy private RAM. Temporary proof/payload arrays are cleared after
capture; the payload installer reads the protected RAM snapshot.

The wrapper passes typed CR2/3/4/7 evidence to PkVerify. VERIFY_CONTEXT requires
the current invocation and real Mint CALL continuation, not the shape of an
ordinary R buffer. Registry issuance, revocation, recipient, Owner, method,
types, Namespace and revision are independently checked. PkVerify gets its
expected proof from its separately provisioned registry R view and executes
all four actual/expected word reads and all 128 comparison bits.

The existing ISA has no XOR/OR mnemonic. The compiled fixed-work lowering uses
`(a-b)&1` for one-bit XOR and `(a+b+1)>>1` for one-bit OR, accumulating the exact
32-bit `diff |= actual[i] ^ expected[i]` expression with BFEXT/BFINS and integer
instructions. Only after all four words does it decide equality. Mismatch
position does not alter instruction count. This is **fixed-work equality**,
not whole-verifier constant time.

Verification success is tied to its validated protected return to Mint. A
supplied DR1=1, previous success, old revision or replayed operation cannot
advance the invocation. Private scratch is cleared before ordinary RETURN.

### Encoding reconciliation

| Existing fact | Explicit choice |
|---|---|
| Opcode 10 is IDX1, despite older “10–15 reserved” comments | This opt-in profile uses **opcode 11**, condition AL (14), zero operand/reserved bits except the low operation selector. No change to the global decoder or assembler. |
| WORD is tagged inline data, not raw 32-bit emission | The profile compiler replaces only its own WORD placeholders after normal assembly. User-authored raw WORD is not accepted by this compiler. |
| Numeric CALL source selectors are zero-based | Source `CALL CR0, #0` emits selector **1**, as required for Create/Verify. Other methods emit 2–5. |
| Compact LOAD indices have their own encoding | Post-LOAD checks use the existing compact-index resolver, not raw immediate bits. |
| Existing one-word Lambda frame has SZ=0 | Preserve its packing and protected STO geometry; flush the accepted frame to Thread RAM immediately, discard the cache, and validate RAM on RETURN. |
| Ordinary CALL frames have protected Enter companion + frame | Preserve that ABI and RETURN masks. `callStack` is cleared on every retirement and before RETURN; it is never authority. |

Opcode-11 selectors are BEGIN=1, VERIFY_CONTEXT=2, VERIFIED=3, READ=4,
PREPARE=5, COMMIT=6, CLEAN=7, FINISH=8, FAIL=9, CHECK_LIVE_USE=10.
These are implementation-profile encodings, **not published ISA assignments**.
Legacy/IDX1 images do not acquire their meaning. The admission API requires
`mint-protected-sim-v1`.

### M2: actual entry, frozen slot and continuation

LAMBDA requires the exact provisioned Mint X GT and checked same-artifact link.
The linked address is logical code PC: physical fetch is the actual descriptor
base + header word + PC, never a relocated descriptor or fabricated callable
nstab object. CR6 scope is preserved. The existing protected SZ=0 frame contains
NIA/flags/prior STO; a private machine record additionally binds the original
code/bounds, scope, Thread and accepted frame bytes. RETURN revalidates both,
then stops at the unresolved cleanup gate described above.
No new Thread frame packing is introduced.

READ and COMMIT are separate leaf invocations; PkVerify runs between them under
the same exclusion. READ captures all four actual old words at the selected
proven-unused slot. COMMIT checks all four, the original root/request/revision,
current live-use evidence and nstab's normal R/W bounds. Four synchronous RAM
writes are followed by four actual RAM reads. A dropped write is not success.
No unaccepted remainder executes after an injected write-boundary fault.

CHECK_LIVE_USE traverses bounded protected chains of every configured Thread,
including suspended contexts, to the retained poison root. It validates frame
geometry, companion E authority and continuation bounds. Missing/corrupt
chains fault rather than mean “unused.” Newly created Threads enter this
inventory. With the first credential no positive Replace/Destroy grant exists;
none is fabricated to demonstrate a destructive operation.

### M3: exact publication, ordinary LOAD

The one-result C-list L view and one-word RW alias are separate normal GTs.
Only confirmed publication arms a permit bound to the invocation, exact
four-word descriptor, physical result address and exact result GT/B ceiling.
The **physical memory write gate**, not a source-slot check, consumes it.
Early, repeated, wrong-word, wrong-value, NULL and alias writes fail.
Only protected initialization/cleanup may zero the result without that permit.

The Lambda's actual DWRITE stores the permitted word. Mint reloads the private
L view and ordinary LOAD places it in CR1, with normal source/type/permission/
bounds checks and an additional current result-identity check. CLEAN zeros
the cell and temporary authority; FINISH destroys admission and snapshots;
ordinary `RETURN #2` preserves only the intended CR1 result. No DR-to-CR
conversion or general B-bit exception exists.

Create validates the frozen payload shape/size/hash and type-specific framing.
For application and LS objects the sole unresolved SELF row must be NULL;
installation binds it to that allocation's exact GT. Other non-NULL capability
rows require actual held authority and cannot include private service views.
Thread payloads require checked geometry and a validated CHURCH frame chain
ending at a real poison root. A supplied continuation above that root is
retained, not constructed by Mint; every Enter GT must already be held by the
requester and pass ordinary E validation. Frame size, STO, executable bounds,
root position and capability homes are checked before publication.
The four-type test checks actual ordinary LOAD/RETURN of the declared E, LS,
LS and RW rights into CR1. A separate isolation regression checks that legacy
instances still reject combined LS and the profile still rejects E-containing
combinations and mixed domains. Complete actual-use scenarios cover RW,
ordinary LS objects and a returned Thread with a valid supplied continuation.

### Returned-object use evidence and standalone Thread activation

**Initialization ownership:** Amobea is intended to initialize all Threads;
that abstraction is not implemented yet. The disposable test fixture supplies
an already-initialized, compiled-program context solely as a prerequisite for
testing the returned capability. It is not an Amobea implementation or evidence
of the complete Thread-creation lifecycle. Mint validates and copies the
supplied bytes; it does not take over Thread initialization.

The optional `consumer: true` initializer selects a fixed canonical Mint driver
that CALLs an ordinary consumer only after Create has returned and admission
has ended. Before requesting Create, it LOADs the consumer E into CR11 as
authority for a supplied Thread continuation. Only that driver and its
additional public E link differ; the service,
verifier, credential recipient, type grants and B=0 ceiling are unchanged.
The consumer is independently compiled and has no Mint credential or private
views. Its instructions check that CR1 is the sole general-register result.
Execution remains through the frozen facade, with no post-admission host writes
to CRs, RAM or PCs.

The LS consumer LOADs SELF and a distinct canary, SAVEs an independently
provisioned B=1 capability to a non-SELF row, and LOADs/compares the changed row.
This distinguishes destination S authority from source B transfer authority;
it does not make Mint's returned B=0 capability transferable. Separate cases
reject copying that result or its loaded SELF, reject copying after B
attenuation, protect row zero at compilation, and check c-list bounds.

The isolated compiler accepts `TPERM CRd, CRs, #32767` for the simulator's
already implemented Mode-2 attenuation encoding. It does not change legacy
assembler syntax, instruction behavior or GT encoding. Compiled consumers
demonstrate LS→L and LS→S, retained permitted use, denial of the removed
operation, and rejection of an E expansion without changing the source.
The facade's `useConfirmed` remains RW-specific; LS success is the consumer's
checked instruction path reaching HALT without a fault, not that telemetry bit.

The [master CHANGE contract](../../phase-1/01-isa/instruction-set.md#change-one-gt-thread-activation)
is authoritative: its operand is a permission-free Thread GT, its destination
is fixed CR12, and it validates and resumes the supplied context in one
instruction. In the positive test, an explicit program TPERM attenuates the
returned CR1, then CHANGE alone activates the new Thread. The next instruction
on the outgoing path is a failure sentinel: a no-op or incomplete handoff
cannot pass. The new context executes its compiled entry, writes and reads its
own CR5 heap, LOADs through E-only CR6 using CR6.M, and executes self-CHANGE
with continuation after that instruction. No extra CALL, initialization
operation, frame repair or post-admission host mutation is used.

The isolated compiler emits the master fixed-destination CHANGE word
(`CHANGE CR12` = `0x27060000`); the protected adapter maps it to the existing
engine without changing legacy assembly or execution. It rejects CR13 and
reserved fields as INVALID_OP, permissions as THREAD_PERMISSIONS, and invalid
Thread context as THREAD_CONTEXT. Direct LS CHANGE remains denied; a root-only
Thread is still not a suspended continuation. Mint does not strip permissions
or add a continuation to make either case pass.

M authorizes L/S only for the register whose bit is set. It does not grant R/W,
export B, or bypass protected-range/write interlocks. A loaded E-GT does not
inherit CR6.M. Thread-LS raw LOAD/SAVE and DREAD/DWRITE remain denied, including
after attenuation; after activation, CR5 cannot address protected stack words.
The facade still exposes no raw homes, frames, registers or core.

SWITCH is not part of this same-Namespace Thread-use test. The master specifies
a standalone combined Namespace/slot-2 handoff, not an extra CR12 reload or a
required following CHANGE/CALL. These tests do not qualify the inherited
SWITCH implementation or claim full-profile instruction conformance.

## Shared producer/observer inventory disposition

This implements the **isolated-profile** side of the
[shared inventory](namespace-update.md#producerobserver-inventory), not a claim
that the unrestricted legacy simulator or hardware now has these guarantees.

| Actor | Enforced boundary in this profile |
|---|---|
| CPU DWRITE/SAVE and overlapping aliases | Normal capability gates plus a physical write interlock. Ordinary writes cannot touch table/private/input/code ranges during admission. Result-cell permit is address-based across aliases. |
| CPU LOAD/DREAD/fetch/CALL/RETURN | Physical private-range checks require exact role bytes/root, not numeric slot alone. Only public Mint E is distributable; PkVerify E remains Mint-only. Normal permission/type/bounds/generation checks remain. |
| Nested Mint, unrelated CALL, Lambda nesting | Hard fault before overlapping admission/activation. Only the expected verifier CALL is admitted; Lambda is a leaf. |
| CHANGE/SWITCH, including self-CHANGE | Instruction handlers reject during the entire interval, including the verifier gap. They remain architectural operations outside admission; this is not a permanent single-Thread latch. |
| Direct RAM indexing/set/fill, Namespace setters, allocator/GC helpers | Raw core and RAM never escape. The backing memory also guards indexed writes and bulk mutators. No GC/lazy helper is callable through the facade. |
| Deferred resolution, body load/eviction, dependency completion, image replacement | Not admitted interfaces. `control` rejects such requests and quarantines the instance, including Promise-scheduled requests between instructions. No competing old-core loader receives the private RAM. |
| IDE editing, resize, C-list edits, persistent-image snapshot | No raw memory/image serialization or editor adapter is exposed. The existing IDE is not silently connected to this runtime. |
| Pause, step and read-only status | Pause/status preserve admission. They return fixed public scalar evidence, never registers, private words, proof material or mutable references. Step uses a bounded 20,000-instruction watchdog. |
| Capture/restore, baseline restore, context retirement, external M6/IRQ activation | No external activation/capture API. Active interval instruction gates and the sealed facade prevent these producers acquiring the private core. Suspended configured Threads remain in live-use traversal. |
| Fault, reset, return-to-boot, reentry | Fault destroys context/permit and quarantines the whole instance. Reset cannot resume or certify partially written RAM. A new trusted instance is required; no raw old snapshot can be exported for replay. |
| Trace, fault diagnostics, emitted snapshots | Private tracing/event emission is suppressed at source. Faults use static codes and a concrete fresh-provisioning action; no CR/DR dump is emitted before or after cleanup. Previously returned status objects contain no private references. |
| Amobea operational capture/restore | Still absent in the underlying application. No claimed service coverage or new checkpoint authority. |
| UART, upload/init mux, FPGA M6, BRAM ports, physical reset/power loss | Not part of this Node-only profile. No hardware qualification or live control endpoint is invoked. |

Trusted initializer fault probes are explicitly negative: they corrupt real
frames/old words, drop a real backing-store write, attempt an interlocked
mutation or inject a fault at an accepted-write boundary. They do **not** supply
positive caller evidence or verification success. Positive tests use none.

## Capacity and exact evidence

The disposable fixture uses a 32,768-word Namespace (128 KiB), 256 table slots,
and a 16,384-word half-memory bound. Static/private placement ends at word
8192; allocations use words 8192–16383. Simulator locations here are the
existing core's **word indices**, not host byte pointers. Digest serialization
is explicitly big-endian.

| Extra private slot | Object/view | Physical words |
|---|---|---:|
| 18 | One-result C-list | 64 |
| 19 | Exact result-word RW alias | 0 additional backing words |
| 20 | Trusted expected-proof registry R view | 4 |
| 21 | Proof snapshot | 4 |
| 22 | Frozen request | 40 |
| 23 | Requester context | 12 |
| 24 | Mint's initial private proof | 4 |
| 25 | Mint's request buffer | 32 |
| 26 | Mint's initial RW payload | 4 |
| 27 | Bounded private payload snapshot | 4096 |

There are **10 extra private descriptors**, beyond the **17 reserved original
assignments**. The basic positive fixture actually installs only original
entries 1, 2, 9, 14 and 15, plus these 10 private entries. It does not pretend
the other 12 qualified candidates are installed or functional. Its metadata
member count reflects actual occupancy. Dynamic results use slots 28 and 29.
The Thread is 256 words, Mint 128 words (85 code words), PkVerify 2048 words
(1170 code words), and the table 1024 words. Private alias storage is not
double-counted; all descriptor storage is included in the existing table.

For the default fixture:

- complete input RAM SHA-256:
  `407208efea236a8abab5c2cd98e2441ce45722663c12a4302c3fd0c0cd7c30ff`
- complete linked Mint SHA-256:
  `dd5fa82ffe6a8f032690919719c7533132e5b1679e794fcb24f4f56c27cee2a7`
- complete linked PkVerify SHA-256:
  `ab636c4d878a250bc161aac48dff4fa2aeef4f03a118f960961c859abe3dc48a`

These hashes identify reproducible synthetic execution inputs; they are not
signatures or proof of qualified candidate linking. Source/API-bearing output
profiles must be measured separately when the selected real candidates are
linked. This fixture's smaller execution LUMPs do not qualify their footprint.

## Verification and remaining acceptance boundary

Validation: all **22 Node test groups** pass through
`python3 -m pytest tests/mint_phase1/test_protected_runtime.py -q`.
The workflow/aggregate registry sync check also passes. This is a CLI-only
change: the primary web workflow was not running, so preview capture was
unavailable; it was not started to avoid unrelated live-state initialization.

The suite checks real two-allocation execution, ordinary returned-GT use,
typed output rights, exact provisioning rejection, all-zero complete proof,
each proof word/end bit, independent/revoked registry state, Alice/Mallory
requester denial, frozen-input isolation, input framing/overflow, exhaustion,
all four old words, all four dropped writes, ABA, competing writes/activation,
suspended-context traversal, real Lambda-frame corruption, result permit
misuse, replay, write/fault/LOAD/clear cuts, reset quarantine, and observer/API
containment. The suite is registered as script-only in the aggregate runner.

Historical checks are not silently reclassified as new acceptance:
`simulator/test_namespace_runtime_core.js` currently fails at its initial
SWITCH with “lacks L permission,” and `tests/mint_phase1/context_probe.js`
currently fails at its first synthetic CALL. Neither those files nor their
shared legacy implementation were changed here. The ordinary RETURN/L-only
LOAD regressions and the historical 24-check result-containment probe pass;
the latter still describes the *unrestricted legacy* profile's gaps.

**This standalone fixture does not establish full-profile acceptance.**
Qualified linking and complete-set execution are now recorded separately in
[the combined acceptance report](qualified-protected-namespace.md), not inferred
from this smaller fixture. This implementation does not by itself
close hardware gates, provide durable Forge/Revoke custody, authorize new
recipients/targets, modify any saved LUMP/Namespace, or install/activate an
image in the IDE.
