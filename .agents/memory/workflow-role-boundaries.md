---
name: Workflow role boundaries
description: Programmer, builder, and system engineer have distinct goals and approval boundaries.
---
The programmer's goal is LUMP creation. The builder's goal is configuration,
test, and approval. The system engineer's goal is a successful FPGA flash.
Do not combine these into one implicit Save/Prepare/Run/Flash workflow.

Agent authority is read-only review, diagnosis, and recommendations unless the
user explicitly changes this restriction. Do not edit code, LUMPs, or Namespace
data, or set up/run the user's LUMP tests, builds, or flashes.

**Why:** After the review, the user explicitly reserved setup/testing and all code,
LUMP, and Namespace changes to themselves, correcting an offer to fix IDE code.

**How to apply:** Report findings and proposed corrections without implementing
them. This restriction applies to delegated agents and commands with side effects
as well as direct edits. The role boundaries below describe the product workflow,
not permission for the agent to perform those roles.

Only the Builder defines Namespace slots. Programmer LUMP creation/save must
not assign, reassign, or redefine slots; the system engineer flashes the
Builder-approved configuration without independently redefining them.

**Why:** The user explicitly corrected the review plan after programmer actions
triggered configuration-generation and approval steps belonging to other roles,
and clarified that Namespace slot definition belongs exclusively to the Builder.

**How to apply:** Classify each action by its goal and handoff. Creating or saving
a LUMP must not implicitly approve a system configuration or initiate flashing.
Configuration approval binds exact artifacts; flashing consumes an approved
configuration and reports verified hardware outcome. Automatic security checks
remain active at each boundary without becoming repetitive user prompts.

Security must operate end to end invisibly during successful normal workflows,
with explanations and audit evidence available when questioned.

**Why:** The user explicitly requires automatic enforcement rather than exposing
internal security checks as repeated approvals to any of the three roles.

**How to apply:** Preserve authorization, identity, integrity, and validation
checks across all handoffs. Success is silent; a blocked action receives a clear,
actionable explanation. Builder configuration approval is a deliberate domain
decision, not permission to bypass security. Do not hide failures or claim this
behavior is implemented before verifying the complete flows.

Programmer release-to-build handoff applies to one exact saved LUMP revision
and binary identity; it is separate from Builder configuration approval.

**Why:** The user requested a dated/versioned identity-panel checkbox to mark
their handoff, not to allocate slots, change immutable LUMPs, or start builds.

**How to apply:** Keep handoff decisions separate from immutable artifact content.
Do not inherit release status across new revisions or treat it as permission to
configure or flash. A specific UI implementation request permits that narrow
code change, not unrelated changes to programmer artifacts.

Design Thread/capability workflows collaboratively from the existing Namespace,
not a substitute test harness. Use the walkthrough to identify unnecessary
steps and unclear feedback; propose improvements separately from implementing them.

**Why:** The user explicitly redirected the Alice/Mallory work toward joint
design using the existing Namespace and asked that workflow improvements be
considered as the steps are established.

**How to apply:** Track the walkthrough in the conversation, preserve durable
design decisions here rather than an activity log, and get agreement before
changing artifacts or implementing suggested workflow improvements.

Namespace design must allow selecting a saved library abstraction even when it
has validation errors, malformed bytes, or no saved implementation at all;
selection must not be equated with certification.

**Why:** During the joint Namespace walkthrough the user explicitly rejected
blocking slot creation merely because a library abstraction is “bad,” and
explicitly included nonexistent abstractions.

**How to apply:** Keep findings visible without silently repairing the selected
artifact. Retain design-time name/slot choices and visible diagnostics separately
from executable authority. A placement is not evidence that bytes exist or have
passed validation; missing implementations must not prevent Namespace design.

Namespace design-save checks must be tested through the real review and commit
path, not only through placement helpers.

**Why:** A locally visible added row previously reached executable boot-image
approval during Save, blocking the intended design-only workflow. Local
placement success did not prove persistence.

**How to apply:** Keep non-executable placement as the default design action.
Converting a pending executable selection to design-only state requires an
explicit action and must retain the chosen slot and artifact identity.

Cryptographic certification belongs at bitstream definition, not ordinary
Namespace editing or saving. Namespace contents may be largely missing,
malformed, or inconsistent during design.

**Why:** The user explicitly clarified that “99% of a namespace can be rubbish”
and that defining a bitstream is the time to check cryptography. A special
design-only fallback does not satisfy that ordinary workflow.

**How to apply:** Do not gate ordinary Namespace persistence on artifact
cryptographic approval or boot-image generation. Show diagnostics without
discarding design choices. Enforce required cryptographic/build checks when
defining the bitstream; preserve runtime capability enforcement separately.
This supersedes treating design placement as an exceptional recovery action.

Hosting and sidecar-policy checks are not sources of truth for LUMP contents
or Namespace correctness.

**Why:** The user explicitly rejected presenting those policy checks as
authoritative blockers while discussing editor and compiler fixes.

**How to apply:** Separate configured completion gates from evidence about
artifact correctness. Do not change user artifacts to satisfy unrelated policy
tests or describe those failures as proof that the artifact is wrong.

Opening a selected saved LUMP for editing must not require installation or
executable approval.

**Why:** The user was blocked from editing Alice by a non-executable placement
dialog, despite that placement identifying an existing saved artifact.

**How to apply:** Route to the exact selected artifact's source using normal
draft-preserving editor navigation. Keep inspection/edit permission separate
from permission to execute or include bytes in a certified bitstream.