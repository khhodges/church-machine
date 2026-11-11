# Amoeba: invalid API capabilities and post-fault policy

**Date:** 11 November 2026  
**Decision:** No ISA changes. Customized Amoeba checks are deferred software work,
not a prerequisite for the current release.

## Problem

A caller can supply a deliberately invalid Golden Token (GT) to a service API.
NULL, unsuitable permissions or a stale binding can cause a fault when the
service uses it. Non-NULL or token equality alone does not establish usability.
The machine must refuse unauthorized effects; hard fault remains the correct
backstop. Availability under repeated hostile requests is a separate concern.

## Alternatives considered and result

- **Instruction Guard (`.TRY`):** reject an individual operation before effects.
  Extending it across GT-consuming instructions adds ISA and result-semantics
  complexity.
- **API Fault Boundary (AFB):** divert eligible invocation faults to a protected
  service handler. This adds boundary-lifetime and execution-context questions.
- **Amoeba Fault Policy:** retain ordinary hard faults and apply customized
  software checks after containment.

**Chosen direction: keep the ISA, capability checks and hard-fault path
unchanged. Do not pursue `.TRY` or AFB ISA extensions.** Later Amoeba development
can express diagnostic policy as ordinary Church Machine/lambda-calculus
abstractions, with appropriate capabilities.

## Purpose of later Amoeba work

The goal is to **expose faults quickly in testing, fix their causes, and prevent
unauthorized access**—not hide faults or provide automatic recovery.

After the existing trusted fault handoff, an owner-selected, bounded diagnostic
routine could:

1. Preserve and interpret the original fault evidence.
2. Associate the event with a service/request where trusted evidence permits.
3. Check authorized service state for partial updates or broken invariants.
4. Report the findings and whether affected work must remain stopped.

An invalid GT does not by itself prove malicious intent. Unknown causes or
incomplete evidence must remain explicitly unknown.

## Non-negotiable boundaries

- No automatic retry, resumption, repair or rollback.
- Passing diagnostics is not authority to reactivate failed work.
- Earlier writes or external effects are not undone; service state is not
  automatically safe to reuse.
- Checks are selected by the owner, never by the offending caller, and run
  with limited authority and bounded execution.
- Do not blindly dereference suspect GTs during diagnosis.
- A checker failure must not erase the original fault or weaken containment.
- Retain existing watchdog and hard-fault rules.

## When development resumes

First verify what the existing Boot fault handoff actually exposes and what
inspection authority Amoeba has. Start with one service and one fixed checker,
not a general recovery framework. Test hostile arguments, a genuine service
bug, partial state changes and failure of the checker itself. Verify containment,
evidence retention and effects on unrelated work separately.

This note records the agreed direction, not an implemented feature, a new
checker ABI, or evidence that existing implementations have passed all tests.

## Addendum: safeguards for later implementation

These refinements do not change the decision or make deferred work a release
requirement. The existing approved fault contract remains authoritative.

1. **Inspect evidence, not suspect authority.** Examine only facts captured by
   the trusted handoff, including recorded token bits as inert data when
   available. Never use the suspect GT to authorize diagnostic access. Missing
   evidence remains unknown; do not reconstruct it by accessing the suspect target.
2. **Use separate diagnostic grants.** Inspect service state through the
   checker's own owner-granted, scoped, read-only authority where supported,
   never through authority inherited from the caller or failed execution.
3. **Broken invariants mean stay stopped.** A detected unsafe partial update or
   broken service invariant keeps affected work stopped pending correction;
   it does not trigger cleanup or repair. Judge intermediate states against the
   service's defined invariants rather than assuming every partial update is
   corruption. Passing a check still grants no reactivation authority.
4. **Test non-use of hostile GTs.** Verify that the checker never uses a suspect
   GT to authorize access, including a token whose use would cause a device
   side effect. Retain this negative test alongside checker-failure and
   evidence-preservation tests.

## References

- [Approved Boot fault-entry contract](boot-fault-rtl-contract.md)
- [Amoeba startup prototype and its limits](amoeba-startup-prototype.md)
- [Superseded `.TRY` proposal](../isa-try-proposal.md)
