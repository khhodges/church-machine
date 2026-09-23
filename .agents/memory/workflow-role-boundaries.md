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