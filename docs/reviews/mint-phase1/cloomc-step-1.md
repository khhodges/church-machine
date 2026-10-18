# Mint to real CLOOMC — Step 1 review

Status: revised Step 1 definition and source audit; awaiting programmer review.
This is not a compiled Mint, a Namespace installation, or runtime acceptance.

## 1. Mint as a Lambda Calculus Abstraction — definition first

**Proposed top-level definition for review.** This precedes registers, opcodes,
helper translation and LUMP layout. It states what Mint means; it does not
claim that the function bodies below have already been implemented.

Mint is an Abstraction whose application selects an operation in its captured
environment and evaluates that operation on the supplied arguments. Its
observable result is a returned value and the resulting state, or a hard fault.
It creates and manages objects and issues/revokes credentials according to
its programmer-defined runtime policy. It is not a host allocator or an
instruction that performs those services on behalf of software.

### Lambda expression and application

Use the following top-level lambda specification:

```text
Mint ≜ λγ. λm.
    m (λa. λs. CreateBody        γ a s)
      (λa. λs. ReplaceBody       γ a s)
      (λa. λs. DestroyBody       γ a s)
      (λa. λs. ForgePassKeyBody  γ a s)
      (λa. λs. RevokePassKeyBody γ a s)

ide.Mint ≜ Mint ΓMint

selectCreate ≜ λc. λr. λd. λf. λv. c

(((ide.Mint selectCreate) a) s)
    →β* CreateBody ΓMint a s
```

The other four selectors choose the corresponding bound function. These are
mathematical selectors, not assigned machine selector numbers or instructions.
`CreateBody` and the other body names are specification abbreviations with the
contracts below. This is a top-level specification, **not a fully expanded
closed lambda term**: completing those bodies and accounting for their free
names is an explicit implementation obligation, not permission to call a host
oracle.

| Symbol | Meaning |
|---|---|
| `γ`, instantiated as `ΓMint` | Mint's captured environment: bindings to its dependencies and accessible storage, supplied by the programmer's configuration—not arbitrary caller replacements. |
| `m` | The operation being applied. |
| `a` | That operation's explicit arguments, including supplied capabilities and data. Different operations need different argument records. |
| `s` | Explicit semantic state used to describe effects across applications. It is not a proposed register, raw-memory argument or authority to access the whole machine. |
| `s′` | State after evaluation; mutations must be performed by the resulting program through its actual available authority. |

State-passing makes this a functional specification of a stateful service.
It does not claim the machine copies its Namespace on each application or
returns private storage to its caller.

### Captured environment, bound arguments and free names

The environment must account for the bindings the body uses:

- **PkVerify:** a callable Abstraction for credential/proof verification;
  Mint must apply its real implementation, not receive host-generated success.
- **Namespace table (`nstab`):** the configured table view, not another
  callable service or a second Namespace.
- **Allocation and object storage:** the actual metadata and backing storage
  used by Mint's software allocator.
- **Credential state and issuance inputs:** registry/revocation state and,
  for credential creation, the specified source of proof material and
  authorized administrative input.
- **Working and result storage:** the explicitly supplied storage used to
  retain invocation data and construct/deliver results.

These are semantic dependency roles, not newly granted GTs, fixed register
assignments or permission policies. Their concrete bindings must be made
explicit in the CLOOMC source/configuration. This list does not presume that
every binding already exists.

The operation and its request values are bound by application; dependencies
are bound by the closure. A body may use values passed explicitly by its
caller; it does not acquire the caller's entire environment implicitly.
Any further free name must become an explicit parameter, captured dependency
or a defined source term. JavaScript globals, fixture arrays and host runtime
objects cannot silently close the Abstraction.

### Meaning of each application

The operation family follows the existing [service contract](service-contract.md).
The mathematical presentation here is proposed for review; it does not silently
replace that contract or approve a new ABI.

| Body | Explicit argument roles | Successful observable effect/result |
|---|---|---|
| Create | Credential, proof, object request and initialization payload | Select and initialize a new allocation, publish its Namespace entry, return the resulting object capability and updated state. |
| Replace | Credential, proof, target, replacement request and payload | Replace the authorized target according to the defined generation/lifecycle rules; return the resulting object capability and updated state. |
| Destroy | Credential, proof, target and destruction request | Invalidate/release the target according to its lifecycle rules; return completion and updated state, not a new object capability. |
| ForgePassKey | Authorized administrative request and issuance inputs | Create the credential/proof pair and its recorded issuance state; deliver it through the defined recipient path. Exact delivery ABI remains to be established. |
| RevokePassKey | Authorized administrative request identifying the credential | Record and enforce revocation of that credential; return completion and updated state. |

At specification level, each body has an outcome of the form
`Success(value, s′)` or `HardFault(s_fault)`. These names describe outcomes,
not new machine instructions or normal error-return values. Hard fault stops
the invocation; the definition does **not** assume rollback or unchanged state
after a partially executed operation. Each body must specify the actual
failure effects when it is refined.

There are three distinct things here:

1. **Abstraction definition:** what each application means.
2. **Mint's programmer-authored runtime policy:** what this program checks
   while evaluating that application.
3. **Machine instruction semantics:** what the CPU does when an instruction
   executes.

Neither the lambda definition nor a GT's presence authorizes compiler/loader
prediction of its meaning. No advance GT-policy gates follow from this model.

### Refinement into CLOOMC and a LUMP

The required order is:

```text
Lambda Abstraction and application semantics
    → explicit environment, arguments, state and body definitions
    → CLOOMC source and dependency interfaces
    → ordinary compiler output
    → source-bearing LUMP and Namespace binding
    → execution / editor round-trip evidence
```

The lexical `λ` in this definition is not the Church Machine `LAMBDA`
instruction. A callable Abstraction is not necessarily implemented by one
`LAMBDA` instruction. Its lowering to CALL/RETURN, any same-scope Lambda use,
register ABI and layout is a later engineering step that must preserve this
definition.

The existing [Lambda Calculus reference architecture](../../lambda-calculus-architecture.md)
provides conceptual background. Its historical instruction examples and
permission claims are not adopted here as new normative ISA decisions.

**First review question:** Is this the intended Mint Abstraction—its operation
family, captured environment, arguments, state effects and returned values?
Only after that is agreed should the implementation audit below guide its
translation. Helper behavior cannot define Mint by accident.

## Required outcome

Mint's service logic must execute from a source-bearing LUMP produced by the
ordinary CLOOMC compilation path. The existing editor must be able to reopen,
edit, recompile and save it. A JavaScript service implementation invoked by a
special instruction does not meet this requirement.

The programmer owns GT design and protection policy. Do not infer GT meaning
or reject programs in advance because of predicted GT use. Machine instruction
checks apply when instructions execute. Any software authorization checks in
Mint must be explicit programmer-visible CLOOMC, not hidden host policy.

## Evidence inspected

- `simulator/mint/protected-programs.js`: constructs source and lowers `MINT`
  operations into private opcode-11 words outside the ordinary compiler.
- `simulator/mint/protected-runtime.js`: `protectedOperation` performs the
  service work; the subclass also changes Lambda/RETURN and memory access.
- `simulator/mint/protected-policy.js`: request processing, host registry
  checks, payload inspection and protected-frame traversal.
- `simulator/simulator.js`: ordinary instruction implementation, including
  `_execLambda`, `_readProtectedCallFrame` and `_integrity32`.
- `tests/mint_phase1/qualified_fixture.js`: creates the initial objects,
  source/API derivatives, bindings and scenario state outside the IDE.

### Reproduced compiler boundary

Running the default `programs()` sources through the ordinary `Assembler`:

| Source | Private compiler words | Ordinary assembler result |
|---|---:|---|
| Mint | 85 | 10 unrecognized `MINT` instruction errors |
| Verifier | 1170 | 3 unrecognized `MINT` errors and 1 branch-range error |

The verifier's additional branch diagnostic occurs in this failed assembly;
it is not independent proof that the successfully lowered private version has
an invalid branch. This is an assembler-boundary probe, not the full IDE
compile/save/reopen acceptance test.

Reproduce from the repository root:

```sh
node - <<'JS'
const Assembler = require('./simulator/assembler');
const {programs} = require('./simulator/mint/protected-programs');
for (const name of ['mint', 'verifier']) {
  const program = programs()[name];
  const assembler = new Assembler();
  assembler.assemble(program.source);
  console.log(name, program.words.length, assembler.errors);
}
JS
```

## Complete special-operation disposition

This table assigns work, not new instruction encodings or capability grants.

| Existing helper | What currently happens | CLOOMC / machine boundary |
|---|---|---|
| BEGIN | Reads protected caller frame; checks host registry/request; copies inputs; creates host context; clears result | Request parsing, copying and software invocation state belong in CLOOMC. Authenticated caller evidence and any required exclusion need an explicit usable interface, not a host frame read disguised as software. |
| VERIFY_CONTEXT | Reads host grant/context and protected caller frame; compares exact host-selected views | Registry/grant comparison belongs in verifier source against real provisioned storage. Establish how caller evidence reaches that source. Do not substitute the host's immediate caller or a caller-supplied identity. |
| VERIFIED | Checks host stage/read counters and DR7; changes host state; clears registers; writes success | Proof comparison and result/cleanup belong in source. Read counters are test observations, not authority. A host boolean must not decide verifier success. |
| READ | Picks a slot from host `freeSlots`/`usedSlots`; reads four Namespace words | Slot selection, allocator state and table reads belong in source, using the programmer-provided table view. Do not turn test fixture lists into a production allocator. |
| CHECK_LIVE_USE | Traverses live and saved Thread contexts through host memory | Determine the explicit required runtime policy and lawful access path. No raw host-frame traversal in CLOOMC's place. No generic pre-execution scan of all held GTs. |
| PREPARE | Aligns allocation, chooses rights, constructs GT/descriptor, copies/zeros payload and writes SELF | All service work belongs in CLOOMC arithmetic, bit operations and memory instructions. Allocation and output rights remain visible programmer policy. Use the specified GT/descriptor format, not a guessed encoding. |
| COMMIT | Rechecks old words, writes four NS words, checks readback, updates host allocator, arms a host result permit and writes DR2 | Table write/readback, bookkeeping and result-word construction belong in source. Required exclusion and any distinct machine interface must be reconciled separately; do not preserve an invented per-value write permit by default. |
| CLEAN | Tests host delivery state, zeros the result cell and clears registers | Source cleanup using the established register ABI and ordinary memory/capability operations. Do not clear the returned CR1 or required caller state. |
| FINISH | Zeros scratch, destroys host context, sets success | Source cleanup and return. Ending any approved machine-owned exclusion is a separate explicit interface, not general Mint work performed by the CPU. |
| FAIL | Throws a host error | Use the specified architectural hard-fault path. Do not substitute HALT, a success return, or a newly invented instruction. |

### Work outside those operations

- **PkVerify:** the four-word bitwise proof comparison is already expressed
  in ordinary instructions and is a reuse candidate. Grant evaluation and
  context handling still depend on host helpers. Preserve the complete check,
  not just the arithmetic comparison.
- **Payload hashing:** `digest` uses Node SHA-256. If retained by the software
  contract, implement it as CLOOMC or call a real compiled dependency.
  A missing SHA mnemonic is not proof that software hashing is impossible.
- **Namespace integrity:** the core has an explicit integrity calculation.
  Match the current specified word packing, mask and arithmetic in source or
  use an existing specified instruction where applicable. Do not assume an
  integrity helper is unimplementable software.
- **Future-use prediction:** `validatePayload`/`validateToken` inspect embedded
  tokens, retained contexts, instructions and branch targets. Do not blindly
  translate this into compiler/loader admission gates. Any retained Mint
  runtime policy needs an explicit source-level purpose; GT meaning belongs
  to the programmer.
- **Private ranges, roles and result permits:** the subclass enforces
  service-specific host rules. Their existence is not evidence that the
  ordinary ISA supplies them, nor a reason to add inferred GT restrictions.
- **Fixtures:** initial objects and test inputs are legitimate setup. Host
  `usedSlots`, `nextBlock`, allocation lists and thread lists cannot remain
  the operational allocator or be updated by the test instead of Mint.
- **Other methods:** the private source routes non-Create methods to rejection.
  That proves neither Replace/Destroy nor ForgePassKey/RevokePassKey is
  implemented. Keep method completeness separate from credential denial.

## Exact interface questions to settle before relying on them

These are bounded implementation questions, not a claim that Mint is impossible
and not a request to reapprove the already authorized isolated work.

1. **Caller evidence:** the helper calls `_readProtectedCallFrame` directly.
   Identify the specified instruction-accessible evidence needed by the source
   ABI. Do not grant raw Thread access or replace it with `callStack`.
2. **Lambda entry/continuation:** the private subclass selects a checked
   dispatcher offset and maintains additional continuation state. Establish
   the ordinary source/link convention and verify actual instruction behavior.
   A private `pc = entry` is not evidence that normal LAMBDA reaches the label.
3. **Update exclusion:** the private runtime controls all mutation through a
   host context and memory proxy. Establish the actual execution/scheduling
   guarantee required by Mint. A software flag does not automatically stop
   another actor; nor does this observation justify inventing a new interlock.
4. **Result delivery and writable storage:** explicitly identify allocator,
   scratch, Namespace and result-cell capabilities and how they are initialized.
   Construct the GT word in source, write it through the authorized data view,
   then materialize it through ordinary LOAD. No host CR assignment.
5. **Combined LS:** this is currently an isolated-profile permission extension.
   Reconcile its existing approval with the intended ordinary simulator path;
   do not silently alter the legacy ISA or split the approved single result.
6. **Fault and preservation conventions:** verify a real source spelling and
   lowering for hard fault, caller register preservation and capability cleanup.
   Do not solve a syntax gap by inserting private raw opcodes.

## Step 1 conclusion / review checkpoint

The service algorithm has identifiable software work to translate. The
helper-backed runs are reference behavior only, not compiled Mint acceptance.
No helper is promoted to a normal ISA instruction by this audit.

Before Step 2, review the Lambda Calculus definition first, then the
software/machine division and interface questions above. Step 2 must refine
that definition, resolve the interfaces it actually uses and produce real
Create + verifier source and ordinary compiled execution evidence. Unresolved
items must be reported precisely, never filled with host-service shortcuts.

Steps 2–4 have not been performed. No source, compiler, saved LUMP, Namespace,
runtime implementation or hardware was changed for this audit.
