# Pass Bit discussion and caller identity

## Status

**Current Genesis scope decision:** Leave Passcodes unchecked for Phase 2,
as requested by the user. Defer the general Pass Bit and specialized-regulator
indirect-CALL authorization redesign; neither is a Phase 2 delivery gate.
This supersedes the earlier direction to work out that replacement now.

Unchecked Passcodes provide no Passcode authentication or verified-originator
guarantee. Ordinary capability, instruction, object and memory checks remain
required. This scope decision does not remove existing runtime checks or claim
that every historical executable already behaves this way.

The discussion below is retained for later review. The separately approved
dedicated GTMint GT.M mechanism is not the deferred general Pass Bit.

## Passcodes remain available to programs

The concern with the general Passcode design is proliferation of Namespace
slots and C-list entries, not an inherent inability to use passcodes correctly.
Programs may still use passcodes privately in exceptional circumstances where
they are appropriate. A simpler machine-level authorization mechanism must not
be interpreted as prohibiting that application-level choice.

## Namespace-qualified caller identity

The caller E-GT recorded for identity tracing when M is set **must include the
Namespace ID**. Conceptually, the recorded identity is:

```text
CallerIdentity = (Namespace ID, full caller E-GT)
```

A bare E-GT or local slot number is insufficient. This is a requirement on the
identity record, not a decision to enlarge or repack the 32-bit GT itself.
The Namespace ID representation and protected capture/storage mechanism remain
to be specified.

The Namespace-qualified identity requirement remains valid whenever caller
identity is recorded; an unchecked Passcode must not be represented as verified
identity. General Pass Bit scope, lifetime and consumption, originator propagation
and the associated authorization redesign are deferred, not current prerequisites.
No new Namespace slots or C-list entries are assigned by this note.
