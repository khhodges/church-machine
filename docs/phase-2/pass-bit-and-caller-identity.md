# Pass Bit discussion and caller identity

## Status

Genesis approved incorporating the simpler authorization direction and the
clarifications below into the [revised Mint abstraction](mint-abstraction.md).
Exact Pass Bit mechanics remain unspecified; this does not assign a bit,
provide a complete executable replacement or claim implementation.

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

Capturing caller identity alongside authorization is the direction being
discussed. Pass Bit scope, lifetime and consumption, immediate caller versus
originator propagation, and the relationship to existing audit requirements
remain separate decisions. No new Namespace slots or C-list entries are
assigned by this note.
