---
title: "Containment as Architecture"
subtitle: "Capability-Mediated LUMPs and a Bounded FPGA Loading Experiment"
author: "Kenneth Hamer-Hodges · SIPantic"
date: "10 November 2026 · Revised manuscript for author review"
lang: en-GB
---

**Review status.** This is a separate editorial revision of the supplied draft, not a publication, release approval, or new experimental report. Authorship is retained from the original; the revised wording awaits the author's approval. Historical result records are cited as records, not represented as independently repeated experiments. No hardware operation was performed for this revision.

## Abstract

The Church Machine explores an execution architecture in which capability-bearing objects describe code, execution state and application Namespaces through a common LUMP model. Its architectural thesis is that explicit authority should govern application access and remain explicit across loading and execution-state transitions. The declared direct capability environment is enumerable, but effective authority also depends on callable services, returned grants and delegation. We therefore state containment conditionally: unauthorized accesses must not commit under a specified grant configuration, trusted computing base and complete mediation model. A retained Artix-7 diagnostic record reports a request for a fixed absent five-word body, external delivery, SYSTEM publication and resumption of the original CALL. A challenge-correlated observation reports unchanged accepted and installed words after repeated and altered input. These observations support a bounded loading path, not a general authenticated LUMP loader, independent attestation of the installed bitstream, or arbitrary-adversary containment. Separate local cooperative-scheduling tests and prepared application images are distinguished from that physical result. We compare the proposal with CHERI, CHERIoT, seL4, W7 and historical capability architectures, and identify the remaining obligations for continuation consumption, revocation, publication, application replacement and revision adoption.

**Keywords:** capability architecture; object capabilities; FPGA; loading; continuations; experimental evidence.

## 1. Introduction

Containment is a question about which effects a computation can cause, not simply which instructions it can execute. A system may enforce its permission checks correctly yet fail its intended policy because an application was granted an overly powerful service. Conversely, writable memory and computational universality do not imply that every computation can access every resource. The claim that all software containment must fail because conventional machines use mutable state is not supported by the evidence considered here. Configuration-dependent machine-checked security results for seL4 provide an important counterpoint [3].

The Church Machine's research proposition is narrower: integrate capability-mediated execution, explicitly described object environments, suspended computation and object loading using one object model, the LUMP. Capability-Limited Object-Oriented Machine Code (CLOOMC) is the project's execution vocabulary. The intended benefit is a consistent account of authority across changes in code residency and execution context, rather than reliance on conventions that disappear below a language runtime.

The paper contributes (i) a scoped account of that architectural proposal and its security obligations; (ii) an analysis of retained evidence for a fixed-body FPGA request/delivery/retry experiment; and (iii) a falsifiable evaluation agenda for complete-LUMP loading, application-image replacement and side-by-side revision adoption. It does not claim the first capability computer, a proof of the implementation, or a demonstrated solution to AI alignment.

The source audit [P1] distinguishes architectural proposals, identifiable implementations, local tests, physical observations, checked formal proofs and release qualification. We retain those distinctions throughout. A successful test is not called a proof. The historical diagnostic, current source tree, saved review designs and future starter are different experimental subjects.

## 2. Threat model and security claim

### 2.1 Protected resources and adversary

The architectural target is an untrusted application that attempts to read or modify objects outside its grants, obtain greater authority, misuse a callable service, replay retained execution state, or induce acceptance of an unauthorized body. For a future general loader, the input adversary may supply altered, stale, oversized, incomplete or repeated responses. These are intended threat-model cases, not a statement that the physical experiment exercised all of them.

The assets are object contents, capability-bearing state, Namespace identity and generation metadata, retained Thread state, and the integrity of executable publication. Availability additionally depends on scheduling, memory allocation and I/O progress. A single completed CALL cannot establish starvation freedom or resistance to resource exhaustion.

### 2.2 Assumptions and trusted components

The conditional claim is:

> For the named machine configuration and grant policy, an access lacking the required authority must not commit an architectural effect.

An unauthorized instruction can be encoded and attempted; the machine may reject it with a fault. “Must not commit” is therefore more accurate than “cannot be represented.” This claim requires correct permission, type, identity, generation and bounds checks wherever applicable, and a complete account of paths capable of affecting protected state.

The trusted computing base includes FPGA configuration, boot and provisioning, capability construction and admission, relevant compiler/loader components, privileged initialization, and control over debug and device access. Trust in local application grants does not eliminate these lower-level dependencies. The audit identifies an M-elevated initialization path in `hardware/mload.py`; it must be included in a mediation argument, not treated as absent or, without further evidence, as an exploitable defect [P1].

Coverage must include instruction fetch, data access, capability loads and stores, CALL/RETURN, CHANGE/SWITCH, boot, loading, debug, MMIO and external bus masters. No complete coverage proof is supplied here. Physical fault injection, timing and other covert channels, malicious provisioning, and compromise of trusted components remain outside the demonstrated result. They require explicit models before broader claims are justified.

### 2.3 Limits of the AI-safety interpretation

Protecting particular goal bytes against writes does not establish semantic goal stability. Withdrawing access does not establish behavioral corrigibility or undo effects already produced. Permitted output channels can be misused without violating access control. An internal single-use continuation cannot alone provide exactly-once financial, network or physical effects: those require an end-to-end crash/retry and acknowledgement protocol.

Capability enforcement can contribute to a containment design. It is not evidence that a sufficiently capable adversary is harmless within all permitted interactions.

## 3. LUMPs, identity and effective authority

### 3.1 Common representation, not universal immutability

The LUMP model associates an object representation with explicit capability bindings. Abstractions, Threads and Namespaces have different roles within this common model. An abstraction provides callable behavior; a Thread holds execution state; a Namespace describes an application object environment. These roles do not imply identical layouts or lifecycle rules.

A Golden Token (GT) is a defined 32-bit capability word. Its interpretation is tied to object identity and the applicable Namespace metadata rather than to raw application addresses alone. This manuscript does not change that representation. Immutable token bits must be distinguished from mutable referents and descriptors. The system has writable memory, Thread state, Namespace metadata and ordinary DWRITE operations. Its intended rule is bounded, authorized mutation, not the absence of mutation [P1].

Landin's closure representation associates an expression with its environment [4]. The useful analogy is that a LUMP makes an authority-bearing environment explicit at an architectural boundary. It is not that closures inherently lack finite representations, identities or auditable environments. Nor does adopting lambda-calculus terminology prove that the resulting hardware implements a secure calculus.

### 3.2 Direct authority is not total reach

A declared C-list enumerates direct capability bindings. It does not enumerate every effect obtainable through them. For example, an enter capability to a logging service can authorize an append without giving the caller direct access to the service's storage. A service may also return a capability, or data may contain further capability references. Later delegation changes the graph again.

Accordingly, an authority audit must consider at least the directly held capabilities, the contracts and implementation of reachable services, capability-bearing data, and subsequent grants. Absence from one C-list is not sufficient evidence that an effect is unreachable. A confused deputy remains a policy risk if a service exercises its own authority on an inadequately authorized request.

Attenuation is an intended restriction on derivation, not a guarantee that all delegation is non-transitive. Any stronger statement must identify the transfer rules and contexts it covers. “Genesis” is, at most, a description of locally rooted authority: minting must remain confined to owned or explicitly delegated resources, not arbitrary creation of access.

### 3.3 Entry and private state

The desired encapsulation boundary is that entry into a service does not automatically disclose its private capabilities to the caller. The original statement “enter or read inside, never both” is too broad. The audited CALL path preserves E-token identity while CR6.M permits bounded C-list access in the callee's execution context [P1]. Caller rights, callee-context access and privileged initialization must be analyzed separately.

That implementation observation is not a claim about every installed FPGA image. A full non-disclosure argument would additionally cover return values, saved frames and capability transfers.

### 3.4 Revocation, reuse and retirement

Generation comparison can reject stale references if each relevant use checks the authoritative generation. It does not alone establish immediate revocation of cached authority, in-flight operations, aliases or retained return state. A lifecycle specification must identify the invalidation linearization point, Namespace identity, finite-generation wrap policy, outstanding-reference treatment and conditions for safe reclamation.

Retirement of an allocation and adoption of another revision are separate actions. Existing references do not acquire new authority merely because a selection changes. Hardware must not manufacture a new generation to repair a fault. General revocation and reclamation are assurance obligations in this paper, not results established by the loading experiment.

## 4. Threads and retained continuations

A Thread is a long-lived execution object that may be scheduled repeatedly while its saved state advances. A particular retained continuation instance is a different subject. The proposed single-use discipline applies to restoration of that instance: its consumption and restoration would need to commit atomically, such that a second restore cannot replay the same future.

Capture and transfer of control should also be specified separately, with explicit authority for each. The proposed benefit is that retaining future execution state need not itself transfer control, and resuming a different Thread need not confer the previous Thread's authority.

These are proposed semantics and proof obligations, not a claim that all Thread restores currently have verified consume-and-restore atomicity. Tests would need to interrupt every relevant transition, including reset/fault boundaries, and establish what state survives. Local watchdog tests around CHANGE do not automatically prove atomic consumption of retained continuation instances.

Rees explicitly describes a mutually untrusting callee invoking a caller's continuation twice and thereby repeating a side effect [5, §4.3.2]. That attribution is retained. It motivates a precise replay boundary; it does not establish that all continuations are inherently unsafe or that W7 proved such a hardware discipline impossible. The intended Church Machine contribution is integration with an explicit machine authority model, not invention of the replay problem.

## 5. Loading and publication boundaries

### 5.1 The measured fixture

In the historical request-and-load diagnostic, the unavailable-CALL fixture transfers work to SYSTEM. SYSTEM's authorized status read triggers a request for one known absent five-word body. The request includes a SHA-256 content label and length. Hardware compares the response with a fixed expected frame and buffers actual received bytes; it is not a general SHA-256 implementation or arbitrary-object lookup [P2, P3].

SYSTEM has R-only receiver access and W-only destination access. Its ordinary DREAD/DWRITE sequence installs the five words and publishes availability last. CHANGE resumes USER; the original CALL retries, and the callee RETURN reaches the terminal observation state. No execution watchdog, receiver rearm, automatic retry or recovery is supplied by this historical diagnostic [P3].

The change is object residency, not “promotion” of token bits. The recorded terminal GT is reported below; this paper does not infer general token-preservation properties across all loaders or lifecycle transitions from that single value.

### 5.2 General loader obligations

A complete-LUMP loader would need to bind received bytes to an authorized expected identity, verify format, size, bounds and generation, restrict the destination, and expose executable availability only after validation and installation complete. A digest establishes equality to an expected value, not who may choose that value. Sender authentication, authorized content identity and transport error detection are distinct.

CRC, parity and ECC address specified corruption patterns; none substitutes for adversarial provenance checks. A cryptographic seal additionally depends on protected keys and a correct verification path. Three separate questions remain: can software insert unauthorized capabilities, can unauthorized executable bytes be admitted, and which accidental or adversarial faults are detected?

The five-word fixture is not canonical LUMP admission. The proposed full-loader tests include wrong identity, altered bytes, incorrect length/bounds, stale generation, truncation, repeated delivery, unauthorized destination and exhaustion. Rejection must not publish partially valid executable state or widen grants.

## 6. Experimental method and retained results

### 6.1 Method and provenance

This manuscript synthesizes the 10 November 2026 result record [P2] and its diagnostic description [P3]. It does not report a new board run. The recorded method replays a 302,212-byte physical RX capture through the retained Session parser, using the event log's actual receive chunk boundaries. It compares verification events and generated transmissions with the log and reconciles receive/transmit totals. Reconstructed baseline, post-claim report and terminal snapshot match the retained result JSON.

The record identifies an uploaded Artix-7 diagnostic BIT and a matching prepared manifest. Receipt hashes cover the uploaded BIT, timing, precise-slack, DRC and route-status files. Synthesis and routed checkpoints were not supplied. Crucially, programming-success output and FPGA readback were also not supplied: the uploaded BIT hash is not independent proof of installed silicon identity. The physical capture is consistent with the named diagnostic, with this provenance limitation.

### 6.2 Physical observations

Table 1 reports values from [P2], not fresh measurements.

| Observation | Recorded value | Interpretation |
|---|---|---|
| Payload | Five 32-bit words, 20 bytes | One fixed body, not arbitrary LUMPs |
| Destination writes / publication | 5 / 1 | Bounded installation and availability update |
| Handoff / successful retry | 1 / 1 | Original CALL resumed in this fixture |
| Terminal state | NIA `0x400C`; CR12 `0x02070004`; DR12 `13` | Recorded expected diagnostic outcome |
| Host transmissions | 60-byte response, then 128-byte challenge | Two attempts and completions; 188 bytes total |
| Post-claim observation | Sequence 1 → 2; matching nonce and rolling CRC | Positive receipt evidence, not inference from silence |
| State after challenge | Five buffer words and five installed words unchanged | Bounded post-claim stability |
| UART errors / post-stop activity | 0 / 0 | No such event reported in this observation |

The challenge contains a repeated response, a response with a changed payload byte, and a nonce-bearing observation request. The second report accounts for 128 additional bytes and the sent challenge's CRC. This is a useful negative observation after acceptance; it is not physical coverage of all malformed inputs before acceptance or of arbitrary-duration interference.

The result record gives request offset 297280, terminal snapshot offset 301628, baseline report offset 301920 and post-claim report offset 302066 in the capture. These locators support replay without interpreting simulated serial output as physical data.

### 6.3 Local evidence is a separate result

The request-and-load README records 35 distinct local cases: 12 full-top, eight receiver boundary, 14 host and one prior-profile regression [P3]. It preserves an initial early-input expectation failure and a targeted corrected rerun; it does not claim a single clean original run. Its earlier “physical acceptance unestablished” wording describes its preparation-time status; [P2] is the later bounded physical record, not evidence that all README exclusions have been removed.

The cooperative retry build record describes a different local suite: 21 passes in 157.87 seconds with three Amaranth monitor-domain deprecation warnings [P4]. All Waiting reports 12 pending-loop self-CHANGEs and renewal counts 15 → 17 across observation; USER B reports eight progress retirements and renewals 19 → 21. Both record one successful retry, five destination writes and an unchanged post-claim state. A slow-UART control expires the watchdog under backpressure. Mid-CHANGE tests report write suppression at expiry and for the next 100 cycles at three selected timer ages.

Those are bounded local RTL/software observations. They do not establish a physical cooperative scheduling or watchdog result, or an exhaustive transition proof. The historical physical diagnostic did not include that integrated watchdog.

Two saved review Namespaces independently produced structurally accepted 65,536-byte preparation outputs [P5]. Preparation is not execution. Their compiled layouts, entry/home state and transport bindings are not thereby reconciled with the old diagnostic. An image upload cannot introduce hardware transitions or timer logic absent from a bitstream.

### 6.4 Costs and unmeasured quantities

The historical vendor-report record gives setup slack +5.519 ns, hold slack +0.070 ns and pulse-width slack +7.000 ns, with zero failing endpoints. It records 43,954 fully routed routable nets, no routing errors and one RTSTAT-10 warning covering 55 nets without routable loads [P2]. These are build-report observations, not independent board measurements or an area comparison.

No end-to-end latency distribution, sustained throughput, LUT/FF/BRAM comparison, power measurement, multi-run failure rate or mean time between failures is established by the reviewed result records. Local test durations are not hardware performance measurements. The 20-byte fixture and 64 KiB prepared images describe different subjects and must not be combined into an apparent loader capacity result.

## 7. Related work and historical positioning

### 7.1 CHERI and CHERIoT

CHERI explicitly supplies fine-grained memory protection and scalable compartmentalization through architectural capabilities [1]. Calling it merely a perimeter around an unchanged interior mischaracterizes its stated mechanisms. CHERIoT is a particularly important comparison: its RTOS paper states that the platform has no MMU or MPU and uses CHERI as its isolation mechanism [2, §2.1]. It also describes hardware-supported temporal safety, allocator revocation bits and sweeping before reuse. Revocation costs and guarantees must be compared in those concrete terms.

| Dimension | Published comparison systems | Church Machine scope here |
|---|---|---|
| Access representation | CHERI/CHERIoT capability pointers carry bounds and permissions [1, 2] | 32-bit GTs interpreted with object/Namespace metadata |
| Compartment boundary | CHERI compartmentalization; CHERIoT protected compartments [1, 2] | LUMP/C-list and execution-context integration |
| Lifetime handling | CHERIoT revocation machinery and reuse protocol [2] | Generation checks plus unresolved global lifecycle obligations |
| Assurance | seL4 has configuration-dependent machine-checked results [3] | No comparable checked whole-machine proof supplied |
| Dynamic body delivery | Not evaluated by this paper for the comparison systems | One fixed-body request/delivery/retry observation |
| Comparative cost | Published evaluations use their own workloads [1, 2] | No controlled cross-system benchmark here |

The possible contribution is a particular integration of object identity, execution state and loading. No superiority in security, performance or revocation overhead follows without equivalent threat models and measurements.

### 7.2 seL4 and object-capability systems

seL4's proof documentation distinguishes functional correctness, binary correctness, security enforcement and initialization correctness, with architecture/configuration qualifications [3]. It demonstrates why a security statement must name its assumptions and configuration. Its existence also defeats the proposed inference from mutable hardware to inevitable failure of software-enforced isolation.

W7 constructs protection through environments and controlled references, and explicitly includes mutation and hardware access in its kernel model [5, §§1.1, 2]. Its relevance is not just historical: it exposes the difference between directly available references and services that act under their own privileges. W7's continuation discussion supplies a specific replay concern, not a claim that closures or continuations have a single universal defect.

SPKI binds authorization to keys or other objects and gives explicit delegation semantics [6, §§3.3, 4]. It is an Experimental RFC, not a universal proof of decentralized trust. Its propagation and reduction rules permit controlled delegation chains; they do not support a blanket “all grants are non-transitive” interpretation. A GT is not an SPKI certificate, and this manuscript claims conceptual relevance rather than protocol equivalence.

### 7.3 Historical lineage

Landin's 1964 paper explicitly calls the expression-plus-environment bundle a closure [4, “Mechanical evaluation,” p. 316]. Dennis and Van Horn's 1966 paper is a foundational published treatment of protection and sharing for multiprogrammed computations [7]. These are appropriate technical antecedents without requiring claims that later systems alone make their ideas auditable.

Levy's history describes the Plessey System 250 as the first operational capability hardware system and first commercially sold capability system, while distinguishing earlier capability architecture attempts [8, chs. 3–4]. We attribute that narrower historical characterization to Levy rather than asserting an independently established universal “first computer” priority. The System 250's indirect system capability table, protected procedures and handling of nonresident segments are particularly relevant precedents. The supplied draft's claim of direct Church Machine descent is treated as an author-provided lineage statement, not independently demonstrated by the historical source. No novelty priority is inferred from it.

Church's 1936 undecidability publication is documented in the Princeton archive [9]. This paper does not date the invention of lambda calculus solely to that publication or infer security from equivalence of computational formalisms. Princeton's historical account confirms that Turing wrote his 1938 doctoral dissertation under Church and reproduces Church's recollection of discussing it [10]. That biographical link is retained as history, not as evidence for the architecture's security. Claims that Turing computation requires ambient authority or that lambda calculus eliminates mutable machine state have been removed.

## 8. Limitations and evaluation agenda

The current strongest empirical statement is fixed-body loading and retry with a bounded post-claim observation. It does not establish general authenticated loading, all token types and permission combinations, complete mediation, consume/restore atomicity, comprehensive revocation, fault-injection resistance, or production upgrade safety.

Three separate demonstrations are proposed for a future isolated starter on one FPGA configuration [P1, P6]:

1. **Complete-LUMP loading without widening authority.** Delay delivery while another eligible USER progresses; record request identity, validation, publication and original CALL completion. Exercise the negative cases in §5.2.
2. **Application replacement without a new bitstream.** Replace the application memory image, retain old/new image hashes and one BIT identity, and record target identity, STOP/upload acknowledgements and runtime outcomes. The current installer requires STOP. This is not zero-downtime replacement; the existing working setup must remain preserved separately.
3. **Different-size revisions side by side.** Allocate distinct old/new revisions, preserve existing users of the old one, and explicitly authorize selection of the new revision for new work. Start with a stateless or explicitly initialized interface, not general live-state migration.

For the third demonstration, capacity includes both bodies, staging, Threads, Namespace metadata and validation buffers. A size difference is not itself a reason to reject a revision. Failure cases must cover validation, insufficient memory, stale references and interruption around adoption; retirement waits until active and permitted references no longer require the old allocation.

Each experiment needs its own acceptance matrix and a frozen source/image manifest. Tests should report latency and memory costs as well as correctness, identify what remains stopped after a failed transfer, and avoid promising rollback that is not implemented. None of these demonstrations is reported as completed here. A new physical operation, release or outreach requires separate authorization.

## 9. Conclusion

An explicit capability environment can make an architectural boundary easier to inspect, but it is not a complete inventory of effective authority. A common model for code, execution state and Namespaces provides a research direction for keeping authority explicit during loading and adoption. The retained Artix-7 experiment supplies a concrete, bounded result: a fixed absent body was requested, delivered, published and used by the resumed CALL, with challenge-correlated post-claim stability.

The next scientific step is not a stronger universal claim. It is evidence for complete-LUMP admission, mediation coverage and safe state transitions on identified configurations, with the assumptions and failure cases made reproducible.

## References

External sources were consulted on 10 November 2026. Web versions can change; section locators identify the passages used. Primary publications are distinguished from institutional summaries and secondary histories.

1. R. N. M. Watson, S. W. Moore, P. Sewell and P. G. Neumann. *An Introduction to CHERI*. UCAM-CL-TR-941, University of Cambridge, 2019; revised 2020. Primary technical report. <https://www.cl.cam.ac.uk/techreports/UCAM-CL-TR-941.html>. DOI: 10.48456/tr-941.
2. S. Amar et al. *CHERIoT RTOS: An OS for Fine-Grained Memory-Safe Compartments on Low-Cost Embedded Devices*. SOSP, 2025. Primary research paper; especially §2.1 and temporal-memory-safety discussion. <https://www.cl.cam.ac.uk/research/security/ctsrd/pdfs/202510-sosp-cheriot-rtos.pdf>.
3. seL4 Project. *seL4 Proofs*. Maintainer summary of machine-checked results and configuration/initialization qualifications. <https://sel4.systems/Verification/proofs>.
4. P. J. Landin. “The mechanical evaluation of expressions.” *The Computer Journal* 6(4), 308–320, 1964. Primary paper; closure definition p. 316. DOI: 10.1093/comjnl/6.4.308. Readable copy: <https://jhc.sjtu.edu.cn/~yutingwang/files/fp/landin-1964.pdf>.
5. J. A. Rees. *A Security Kernel Based on the Lambda Calculus*. MIT AI Memo 1564, March 1996. Primary report; §§1.1, 2, 4.3.2 and 4.3.3. Author-hosted HTML: <http://mumble.net/~jar/pubs/secureos/secureos.html>.
6. C. Ellison, B. Frantz, B. Lampson, R. Rivest, B. Thomas and T. Ylonen. *SPKI Certificate Theory*. RFC 2693, Experimental, September 1999. Primary specification; §§3.3 and 4. <https://www.rfc-editor.org/rfc/rfc2693>.
7. J. B. Dennis and E. C. Van Horn. “Programming semantics for multiprogrammed computations.” *Communications of the ACM* 9(3), 143–155, March 1966. Primary publication; publisher metadata and abstract consulted. DOI: 10.1145/365230.365252. <https://cacm.acm.org/research/programming-semantics-for-multiprogrammed-computations-2/>.
8. H. M. Levy. *Capability-Based Computer Systems*. Digital Press, 1984. Secondary technical history, chapters 3–4. <https://homes.cs.washington.edu/~levy/capabook/Chapter3.pdf> and <https://homes.cs.washington.edu/~levy/capabook/Chapter4.pdf>.
9. Princeton University Library. Alonzo Church Papers, item “An Unsolvable Problem of Elementary Number Theory,” *American Journal of Mathematics* 58, 345–363, April 1936. Archival catalogue confirming publication metadata, not a newly checked proof. <https://findingaids.princeton.edu/catalog/C0948_c00018>.
10. *Princeton Alumni Weekly*. “An early history of computing at Princeton.” Institutional historical account, “Turing comes to Princeton,” including excerpts of the 17 May 1984 Church interview. Used only for the dissertation/adviser attribution, not its other historical superlatives. <https://paw.princeton.edu/article/early-history-computing-princeton>.

### Project evidence register

Paths are relative to the project repository. These are retained internal evidence records, not asserted to be publicly downloadable. A redistribution-safe package is still required before external reproduction.

- **[P1]** `docs/phase-2/cooperative-retry/release-publication-audit.md`, 10 November 2026. Claim corrections, selected source observations, evidence classes and release gates.
- **[P2]** `docs/phase-2/request-retry/physical-result.md`, 10 November 2026. Capture replay, vendor-report checks and physical provenance limitations.
- **[P3]** `docs/phase-2/request-retry/README.md`. Fixed-frame transport, authorized SYSTEM copy, local case reconciliation and preparation-time scope.
- **[P4]** `docs/phase-2/cooperative-retry/build-result.md`. Local cooperative/watchdog suite and build-only handoff, not physical qualification.
- **[P5]** `docs/phase-2/cooperative-retry/existing-bitstream-compatibility.md`. Two structurally accepted images, baseline incompatibility and STOP/upload boundary.
- **[P6]** `docs/phase-2/cooperative-retry/starter-direction.md`. Separate starter and three-demonstration goals; a plan, not results.

## Appendix A. Evidence-status ledger

| Claim | Evidence/status | Boundary |
|---|---|---|
| Common LUMP model | Architectural description [P1] | No formal equivalence to a secure calculus |
| Direct C-list enumeration | Architectural representation [P1] | Does not enumerate effective grant/service reach |
| CALL E identity / contextual CR6 access | Selected implementation observation [P1] | Not an exhaustive RTL audit or installed-image assertion |
| Fixed-body request/delivery/retry | Physical record [P2] | Five words; installed BIT independently unconfirmed |
| Post-claim stability | Physical record [P2] | One 128-byte challenge and observed state |
| Receiver/host negative cases | Retained local evidence [P3] | Not all physically exercised |
| Cooperative progress / watchdog | Retained local evidence [P4] | Not demonstrated on hardware by this record |
| Saved Namespace preparation | Structural output evidence [P5] | Not execution or transport compatibility |
| General authenticated LUMP loading | Proposed [P1] | Authorized identity and general validator remain required |
| Atomic retained-instance consumption | Proposed [P1] | No checked proof or physical demonstration supplied |
| Global revocation / safe reuse | Open assurance obligation [P1] | Caches, frames, in-flight effects and wrap require treatment |
| One-BIT three-demonstration starter | Planned [P6] | Not release-qualified |

## Appendix B. Physical-evidence identifiers

The following identifiers are transcribed from [P2] to disambiguate the historical experiment. They are not fresh attestation.

```text
Uploaded BIT SHA-256:
784ec30f312c8171da6f126e144c7535a2602c95ac22b995868a5da90df89aea
Uploaded manifest SHA-256:
8c7c889ce8e3694f488f34729019f5227fa2631d2c292a1cb3a7db60cd75d027
Uploaded capture SHA-256:
29042a6d710caff70688db0f6276a616937b4fc96d5b1503b8e18529776e8051
```

Retained inputs named by the record: `attached_assets/capture_1794317160962.bin`, `attached_assets/events_1794317160963.jsonl` and `attached_assets/result_1794317160963.json`. The historical replay used the same retained parser, not an independently authored checker; host TX logs are not logic-analyzer captures. The board's nonce-correlated report supplies the corresponding receive observation.

## Appendix C. Editorial change and attribution ledger

This ledger maps all publication-blocking corrections A–K in [P1] to the revision.

| Audit item | Revision |
|---|---|
| A: inevitable software failure | Removed; conditional access claim and seL4 counterpoint, §§1–2 |
| B: immutable substrate | Replaced by authorized mutation; token/referent distinction, §3.1 |
| C: CHERI perimeter characterization | Replaced by sourced comparison including CHERIoT, §7.1 |
| D: list equals all reach | Restricted to direct bindings; service/delegation graph, §3.2 |
| E: unrepresentable unauthorized actions | Replaced by must-not-commit property and mediation inventory, §2 |
| F: automatic global revocation | Defined as conditional invalidation with open lifecycle obligations, §3.4 |
| G: one-shot Thread | Separated reusable Thread from retained continuation instance, §4 |
| H: enter or read, never both | Qualified by caller, region and execution context, §3.3 |
| I: general Lazy Load | Replaced by fixed-frame five-word result and provenance limit, §§5–6 |
| J: integrity equals unforgeability | Separated capability provenance, executable identity and fault detection, §5.2 |
| K: solved safety/reliability/trust | Limited interpretation; no MTBF inference or arbitrary Genesis authority, §§2.3, 3.2, 6.4 |

Historical checks: Landin's closure definition and Rees's repeated-continuation example were verified in their texts. Dennis/Van Horn bibliographic metadata and abstract were checked at the publisher. SPKI delegation was checked against the RFC. Plessey priority is attributed narrowly to Levy's secondary history; direct Church Machine descent remains author-supplied. Church's 1936 publication metadata and Turing's doctoral relationship were checked using the named Princeton sources. No general historical priority or security conclusion is inferred from the Church–Turing connection.
