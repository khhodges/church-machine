# Church Machine: containment audit and release/publication plan

**Review date:** 10 November 2026  
**Input:** *Containment as Architecture*, supplied November 2026 draft  
**Status:** recommendation for review; not release approval, formal verification, or permission to operate hardware.

## 1. Executive recommendation

**Publish a precise architectural thesis with bounded evidence first; release one reusable experimental starter after three independently evidenced demonstrations.**

The strongest contribution is not “all conventional containment must fail.” It is the proposed integration of capability-mediated execution, explicitly described object environments, suspended computation, loading and application replacement through a common LUMP model.

Use this public engineering proposition:

> One FPGA configuration; explicit capability authority; separately identifiable application images and object revisions.

Demonstrate, on the same new test configuration:

1. A missing LUMP is delivered and the original CALL completes while unrelated work progresses.
2. A second Namespace application replaces the first memory image without generating or programming another bitstream.
3. A new LUMP revision is staged alongside the old one, potentially with a different size, and adopted without corrupting existing users of the old revision.

Keep the working system and historical evidence untouched. Develop and qualify the new starter separately. “One bitstream” applies across the new demonstrations; it does not mean the old working FPGA must be interrupted.

**Current disposition**

- Suitable for focused research discussion after claim corrections.
- Existing bounded physical request/receive/retry result is valuable and publishable with its exact limitations.
- New three-demonstration starter is not yet qualified.
- Not ready for claims of general AI containment, comprehensive hardware unforgeability, production hot upgrade, or complete mediation.

## 2. Audit method and evidence limits

This is a claim/evidence and release-design audit. It compares the submitted text with retained project result records, selected implementation paths and primary external literature. It is not a full RTL audit, penetration test, fresh board measurement, independent reproduction of historical captures, or exhaustive literature review.

Evidence classes must stay separate:

- **Architectural proposal:** intended behavior and invariants.
- **Implemented:** identifiable source exists.
- **Locally tested:** bounded RTL/software test evidence.
- **Physically observed:** recorded behavior of an identified experiment, with provenance limitations.
- **Formally proved:** a theorem, model, assumptions and checked proof artifact.
- **Release-qualified:** exact candidate passed its declared acceptance matrix.

Do not use “proven” as a synonym for “a test passed.” Current source, a historical BIT, a saved review design, and the new isolated candidate are different subjects.

### Evidence baseline

| Subject | Supported by reviewed evidence | Not established |
|---|---|---|
| Historical request-and-load diagnostic | Physical capture record reports one request/response, five installed words, original retry result, and challenge-correlated unchanged post-claim state | Arbitrary LUMP loading, general on-device content hashing, sender authentication, enabled execution watchdog |
| Cooperative USER B / All Waiting diagnostic | Retained local full-top tests report progress/self-CHANGE, delivery and watchdog observations | A new physical three-demo starter result |
| Saved review Namespaces | Both produce structurally accepted 64 KiB preparation outputs | Those compiled application images execute correctly on the old baseline or the new candidate |
| Split Prepare / Load UI | Preparation-first behavior and selection isolation were checked; upload still requires confirmation | Physical transfer or correct runtime behavior |
| Side-by-side starter source copy | Isolated starting point and inherited-source checks | General loader, image replacement and concurrent revision adoption implemented together |

The most relevant physical result is `request-retry/physical-result.md`, not the earlier synthetic resume-only result. That record explicitly lacks programming-success output/readback establishing the installed silicon identity independently; the capture is consistent with the named diagnostic.

## 3. Publication-blocking claim corrections

### A. Universal failure of software containment — remove

**Draft:** software containment inevitably fails because of the von Neumann foundation.

**Finding:** the inference is unsupported. Mutability and computational universality do not imply universal access. Conventional architectures can enforce isolation; seL4 supplies configuration-dependent machine-checked security results under explicit assumptions [X2]. Lambda-calculus ancestry does not itself prove an implementation secure.

**Replacement:** “We investigate making capability mediation an architectural invariant, reducing reliance on higher-layer conventions. Security still depends on implementation correctness, grants and the trusted computing base.”

Retain the thesis that hardware enforcement matters; do not present it as a proof that all other approaches are impossible.

### B. “No mutable interior” — distinguish authority from state

The project has writable memory, Namespace metadata, Thread state and ordinary DWRITE operations. That does not invalidate capability security, but it contradicts an unqualified contrast between a mutable Turing substrate and an immutable Church substrate.

Specify which objects or identities are immutable, which state is mutable, and which capabilities authorize changes. An immutable token is not the same as an immutable referent or immutable Namespace descriptor.

**Replacement:** “Mutation is explicitly authorized and bounded; no application access is intended to acquire authority merely from a raw address.”

### C. CHERI comparison — rewrite, not soften cosmetically

CHERI's primary documentation describes fine-grained memory protection and scalable compartmentalization [X1]. CHERIoT explicitly has no MMU/MPU and uses CHERI as its only isolation mechanism; it also implements hardware-supported temporal-safety machinery [X3].

Calling the entire family a perimeter around an unchanged interior will undermine credibility with the intended audience.

Compare mechanisms instead: indirect object identity versus pointer-carried bounds, invalidation and reuse, permission derivation, loading, Thread ownership, trusted components, proof maturity and measured cost. State where Church Machine mechanisms are proposals rather than demonstrated advantages.

### D. “Read the list to know all reach” — restrict to direct authority

An explicit C-list enumerates directly declared capabilities. It does not automatically enumerate all effective authority obtainable through callable services, capability-bearing data, returned grants or later delegation. Calling a service can cause effects under that service's authority without exposing its internal capabilities.

**Replacement:** “The declared direct capability environment is enumerable; effective authority requires analysis of reachable services, delegation and the dynamic grant graph.”

Audit the actual non-delegation rules before saying grants are universally non-transitive. Neither closures nor capability systems categorically lack finite representations, identities, auditing or versioning.

### E. “Unauthorized actions are unrepresentable” — make it conditional

The hardware can receive an attempted operation and fault it. That differs from an instruction or state being syntactically unrepresentable.

Prefer: “Under the stated machine model and grant configuration, unauthorized accesses must not commit.”

This needs a mediation argument covering instruction fetch, data access, capability loads/stores, CALL/RETURN, CHANGE/SWITCH, boot, privileged initialization, loading, debug access, MMIO and external masters. Current `mload.py` contains an explicit M-elevated initialization path; it must be accounted for, not omitted. This observation is not by itself a demonstrated vulnerability.

### F. Revocation — separate an invalidation mechanism from a global guarantee

A version comparison can invalidate stale references when every use checks the authoritative generation. It does not by itself establish immediate revocation of cached authority, in-flight operations, retained return state, aliases, or external effects.

Specify the revocation linearization point, finite-generation wrap/reuse policy, outstanding-reference treatment, Namespace identity and reclamation conditions. Hardware must not silently manufacture a new generation to “repair” a fault.

The draft labels revocation modelled in section 6 but “as built” in section 7. Use one consistent status tied to evidence.

### G. Thread one-shot semantics — define the object being consumed

Threads can be scheduled repeatedly while advancing their saved state. A claim that every Thread is inherently a one-shot continuation risks implying otherwise.

Distinguish a particular retained continuation instance from the long-lived Thread object. Prove consume-and-restore atomicity for that instance before claiming replay is impossible. Keep this outside the first starter release's claimed results unless it is actually implemented and tested.

### H. Enter versus read authority — describe the exact boundary

“Enter or read inside, never both” needs an actor, object region and execution-context qualification. Current CALL preserves E-token identity while CR6.M supplies bounded C-list access inside the call context.

That does not automatically expose a callee's private authority to its caller, but it makes the paper's blanket wording too broad. State what the caller cannot obtain and test the privileged/callee paths separately.

### I. Lazy Load — preserve the real achievement, narrow its scope

The strongest reviewed physical diagnostic has a known five-word payload. Its request carries a SHA-256 label, but hardware compares against a fixed expected frame; it is not a general SHA-256 verifier or arbitrary-object loader.

Recommended description:

> “An Artix-7 diagnostic exercised request, external delivery, SYSTEM publication and resumption of the original CALL for a fixed absent-body fixture. This establishes a bounded loading path, not general authenticated LUMP delivery.”

Do not claim cryptographic substitution resistance for arbitrary fetched bodies until the receiver's complete validation and trusted expected-identity path are established. A content hash establishes equality to an expected digest, not who is authorized to choose that digest. Sender authentication and content identity are separate questions.

“Promotes the token in place” conflicts with “the token is unchanged.” Say that object residency changes while token bits remain unchanged, where that exact property is evidenced.

### J. Integrity, forgery and physical faults — separate three obligations

CRC/parity/ECC detect or correct specified corruption patterns. They do not establish authorized provenance or adversarial unforgeability. A cryptographic seal also depends on protected keys and a correct checking path.

Document separately:

1. How software is prevented from constructing or inserting unauthorized capabilities.
2. How incoming executable bytes are authenticated or matched to an authorized identity.
3. Which random faults and adversarial fault-injection mechanisms are detected.

Preserve the defined 32-bit GT format; this audit is not a proposal to enlarge or redesign it.

### K. AI-safety mappings — present as limited mechanisms, not solved objectives

- Write protection can protect specified goal bytes; it does not prove semantic goal stability.
- Revocation can withdraw checked authority; it does not prove behavioral corrigibility or undo external effects.
- Non-replay of an internal continuation does not prove exactly-once network, financial or physical effects. External effects need an end-to-end protocol and crash/retry model.
- Bounded memory does not imply a measured mean time between failures. Report size and reliability separately.
- Local roots of application authority do not eliminate trust in FPGA configuration, boot, provisioning, compiler/loader components, debug control and device access.
- Genesis minting must be scoped to owned or explicitly delegated authority, not arbitrary creation of access.

Keep the social-trust interpretation as interpretation. Verify the precise Landin, Rees/W7, SPKI and PP250 historical attributions before publication; the superlative “first computer” is not established by this audit.

## 4. Reconcile the three demonstrations with containment

The demonstrations should show controlled changes of residency, application configuration and revision selection—not merely successful data movement.

### Demonstration 1: loading without widening authority

Use USER B as the new starter workload. Record the absent target and caller capability, request identity, delayed response, continued USER B progress, validation, publication and original CALL completion.

Required negative cases: wrong identity, altered bytes, incorrect size/bounds, stale generation, truncated and repeated delivery, unauthorized destination and exhaustion. Rejected delivery must not expose partially valid executable state or grant additional rights.

The first release may limit supported LUMP types and sizes explicitly. Do not claim every lifecycle operation or Namespace-type lazy loading.

### Demonstration 2: application replacement without hardware replacement

Run All Waiting on the same new starter configuration after replacing application memory. Record old/new image hashes and a single BIT/build identity, target identity, upload acknowledgement and runtime output. Where hardware readback is unavailable, say so and retain operator/transport evidence rather than inventing attestation.

Test wrong-target requests, stale prepared inputs and interrupted transfer. Define whether failure preserves the old application or leaves the test target safely stopped; do not promise rollback unless implemented.

**Important:** this is not zero-downtime Namespace replacement. The current installer requires STOP. “Never stop what works” is honored by preserving the existing working setup and using a separately authorized experimental target. If the user later requires zero downtime on one physical target during complete image replacement, that is a separate architectural requirement.

### Demonstration 3: different-size revisions side by side

Choose a new revision with a visibly different result and deliberately different allocation size. Give it a separate allocation and identity consistent with existing Namespace/version rules.

Show old callers or retained continuations still using the old revision, followed by explicitly authorized selection of the new revision for new work. A pointer change alone is not sufficient: old saved GTs do not magically become new authority.

Define the callable interface and state model first. Start with a stateless or explicitly initialized example; do not claim general live-state migration.

Test failed validation, insufficient memory, stale references and interruption around adoption. The old allocation and authority must remain valid as specified. Keep retirement/GC separate until no active or permitted references require the old revision.

Do not reject a candidate merely because its size differs. Account for peak memory: old plus new bodies, staging, Threads, Namespace table and validation buffers.

## 5. Release plan and evidence gates

Avoid calendar commitments before a general loader and safe adoption contract exist. Use exit criteria and freeze one candidate at a time.

| Stage | Work and deliverable | Exit criterion | Permitted public claim |
|---|---|---|---|
| A — Evidence and manuscript correction | Claim ledger, threat model, corrected draft, preserved historical records | Every factual result names its subject, evidence and limit; no unsupported absolutes | Architectural proposal plus bounded physical loading result |
| B — Starter engineering | Complete-LUMP delivery, protected handoff, watchdog, image installer and side-by-side adoption in an isolated candidate | Exact compiled artifacts pass focused local positive/negative tests; no live system changed | Implemented and locally tested candidate |
| C — One experimental hardware release | One vendor build with reproducible source/image manifest and timing/DRC receipts | Approved build gates pass; candidate identity frozen; physical target and operation explicitly authorized | Experimental starter available for evaluation |
| D — Three hardware demonstrations | Three evidence bundles using that same BIT | All three positive proofs plus declared negative tests pass; replayable evidence and provenance retained | One-configuration loading, image replacement and side-by-side revision demonstration |
| E — External reproduction | Independent evaluator instructions, artifacts, known limits and issue tracking | Another evaluator reproduces declared results or discrepancies are resolved/documented | Reproduced experimental results, not universal containment |
| F — Broader assurance | Mediation coverage, lifecycle atomicity, revocation/reuse, fault model, grant analysis | Explicit proof/test obligations closed for a named configuration | Only the particular security properties actually established |

Do not wait for stage F to publish the bounded work. Do not use stages A–D to imply stage F is complete.

### Minimal release package

- One starter BIT and its SHA-256, source snapshot, tool versions, target hardware and timing/DRC results.
- USER B and All Waiting application images and exact compilation/input manifests.
- Old/new upgrade LUMPs with distinct identities, sizes, interfaces and expected results.
- Validation/adoption protocol, trusted-component inventory and permission map.
- Host tools, replay scripts, raw captures, expected output and negative-test matrix.
- Separate labels for local tests, physical observations and independent reproduction.
- Known limitations, recovery instructions that preserve the working setup, and no hidden automatic resend or reflash.
- License and redistribution inventory, reproducibility instructions and a publication-safe artifact index.

Credentials, private signing material, pairing grants and unrelated user data must never enter the package. Keep large binaries in artifact storage rather than ordinary Git history.

## 6. Publication strategy

### Audience and order

**First: capability, programming-language and systems researchers.** Circulate a corrected technical draft privately to a small set of relevant reviewers, especially people who can challenge authority reachability, continuation semantics and CHERI comparisons. No outreach is authorized by this plan.

**Second: an archival technical report/preprint.** Publish the bounded existing result with the corrected architecture and evidence-status table. If stage D is close, combine them into one stronger paper; otherwise avoid delaying the existing result solely to complete every lifecycle feature. Check the intended venue's current preprint and artifact policies before submission.

**Third: the experimental starter release and demonstration.** The headline should be “One FPGA configuration, three controlled application changes,” accompanied by a short walkthrough and full reproducibility package. Do not lead with “inescapable AI” or “production-ready.”

**Fourth: a systems/security or capability workshop submission.** Select a venue after the evidence package is stable; evaluate fit, review criteria and artifact support then. No specific deadline, acceptance probability or novelty priority is claimed here.

**Later: broader AI-safety interpretation.** Explain how architectural access control contributes to containment while explicitly excluding goal correctness, deceptive behavior, permitted-channel misuse and unspecified side channels.

### Why this is advantageous

- A concrete, reproducible experiment is easier to evaluate than a universal security argument.
- Keeping the architectural thesis separate from empirical acceptance permits early feedback without overstating readiness.
- One reusable bitstream demonstrates that the object/application model, not repeated hardware specialization, carries the variation.
- A different-size upgrade demonstrates the real benefit of side-by-side allocation and avoids an artificial same-size limitation.
- Fair comparison with CHERI and seL4 makes their communities potential technical collaborators rather than dismissing established results.

### Proposed title and abstract

**Title:** *Containment as Architecture: Capability-Mediated LUMPs and a Bounded FPGA Loading Experiment*

**Replacement abstract:**

> The Church Machine explores an execution architecture in which capability-bearing objects describe code, execution state and application Namespaces through a common LUMP model. We distinguish the enumerable direct capability environment from effective authority obtained through services and delegation, and state containment as a property requiring correct grants, complete mediation and a correct implementation. A recorded Artix-7 diagnostic exercised a request for a fixed absent body, external delivery, SYSTEM publication and continuation of the original CALL, including challenge-correlated post-claim observations. This is bounded experimental evidence, not qualification of a general authenticated loader or a proof of arbitrary-adversary containment. We describe a separate experimental release intended to demonstrate complete-LUMP loading, Namespace image replacement and side-by-side revision adoption on one FPGA configuration. Continuation consumption, lifecycle atomicity and broader mediation coverage remain explicit assurance obligations.

After stage D, replace the “intended to demonstrate” sentence with the exact measured result and link the three evidence bundles. Do not promote the abstract earlier.

### Manuscript structure

1. Threat model and precise architectural contribution.
2. LUMP identities, direct capabilities and effective authority.
3. Thread/continuation semantics with implemented-versus-proposed distinctions.
4. Loader and publication/adoption boundaries.
5. Experimental method, exact configuration and negative controls.
6. Results and costs: latency, throughput, memory, resource use and interruption behavior.
7. Related work with CHERI, CHERIoT, seL4, object-capability systems and historical machines.
8. Limitations, open proof obligations and reproducibility.

Keep a shorter vision essay as a separate companion, not as a substitute for the evidence paper. Check attribution, third-party licensing and any desired patent/disclosure strategy before public release; obtain appropriate professional advice where needed.

## 7. Priorities

**Next engineering priority:** specify and implement a complete-LUMP validation/publication contract and a safe side-by-side adoption boundary in the isolated starter. These determine whether the hardware can be built once.

**Next publication priority:** revise sections 1–4 and 7 for scope and consistency, and replace the broad “proven” list with the evidence table. Keep the historical loading result prominent.

**Do not add to this first release:** distributed consensus, universal AI-safety claims, general state migration, complete lifecycle GC, Namespace-type lazy loading, or an invented simulator-first acceptance requirement. Use local checks for development and physical evidence for the hardware claims.

## 8. Source register

Project paths are relative to the repository root. The audit preserves these records rather than editing their historical claims.

- **P1:** Supplied `attached_assets/CM-Containment-as-Architecture_1794335629573.docx`, sections 1–7 and lineage.
- **P2:** `docs/phase-2/request-retry/physical-result.md` — bounded physical request/load and post-claim capture result.
- **P3:** `docs/phase-2/request-retry/README.md` — fixed-frame comparison, no general hash verifier or sender authentication.
- **P4:** `docs/phase-2/cooperative-retry/build-result.md` — local cooperative/watchdog results and build-only limits.
- **P5:** `docs/phase-2/cooperative-retry/ide-review.md` — real compiled assignments and remaining transport/entry reconciliation.
- **P6:** `docs/phase-2/cooperative-retry/existing-bitstream-compatibility.md` — prepared images versus hardware compatibility.
- **P7:** `docs/phase-2/cooperative-retry/starter-direction.md` — side-by-side preservation and three demonstrations.
- **P8:** `hardware/call.py`, CR6 adjustment; `hardware/mload.py`, M-elevated initialization path; `hardware/ns_gate.py`, sequence validation. Selected current-source observations, not evidence of a particular installed BIT.
- **P9:** `server/uart_profile_install.py` and `artifacts/development-image/src/DevelopmentImage.tsx` — exact-image selection, confirmation and STOP/upload boundary.
- **X1:** Watson et al., *An Introduction to CHERI*, University of Cambridge, UCAM-CL-TR-941: https://www.cl.cam.ac.uk/techreports/UCAM-CL-TR-941.html
- **X2:** seL4, *Proofs*, including configuration and initialization qualifications: https://sel4.systems/Verification/proofs
- **X3:** Amar et al., *CHERIoT RTOS: An OS for Fine-Grained Memory-Safe Compartments on Low-Cost Embedded Devices*, SOSP 2025, especially §2.1: https://www.cl.cam.ac.uk/research/security/ctsrd/pdfs/202510-sosp-cheriot-rtos.pdf

External primary sources were consulted on 10 November 2026. Historical attribution and venue/deadline checks remain publication-editorial work, not verified findings in this audit.
