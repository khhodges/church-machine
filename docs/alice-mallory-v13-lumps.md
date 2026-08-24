# Alice and Mallory v1.3 LUMPs

Alice and Mallory are a runnable capability-containment example. They were
reissued from the supplied `ide.Alice` and `ide.Mallory` records because those
records explicitly marked their tokens and machine words as placeholders and
used a pre-v1.3 freespace layout.

Both releases are ordinary dynamic Namespace LUMPs. They are not boot-resident
and do not reserve fixed Namespace slots.

## Alice

Alice exposes two E-only methods:

| Selector | Method | Input | Result |
| --- | --- | --- | --- |
| 1 | `Stash` | `DR1 = value` | `DR1 = value` |
| 2 | `Reveal` | none | `DR1 = stored value` |

Alice's c-list contains a compiler-owned SELF E-GT and one private RW GT. At
allocation time both are minted for Alice's live Namespace slot and sequence.
The RW GT is never returned or delegated. `Stash` writes code word 9 through
that GT; `Reveal` reads the same word. DR1 survives RETURN because DR1–DR3 are
the caller-saved argument and return registers.

Annotated canonical source:
[`simulator/examples/alice.cloomc`](../simulator/examples/alice.cloomc).

## Mallory

Mallory exposes selector 1, `Steal`. His c-list contains only SELF and private
scratch capabilities. It deliberately contains no capability for Alice or
Alice's secret.

`Steal` requests c-list row 2. Because Mallory declares only rows 0 and 1, the
LOAD fails with `NO_CAPABILITY` before DREAD can execute. The failure depends
only on Mallory's own sealed c-list; it does not depend on a fixed Namespace
slot, timing, or Alice's current stored value.

Annotated canonical source:
[`simulator/examples/mallory.cloomc`](../simulator/examples/mallory.cloomc).

## v1.3 self-definition

Each binary contains:

1. a valid executable LUMP header and method table;
2. executable ISA words assembled from the canonical source;
3. a `0xAB` Tier-2 frame containing the API JSON and exact source text;
4. zero-filled unused freespace;
5. a tail-packed c-list;
6. a canonical Number computed from `SHA-256(dot-name || complete binary)`.

The release sidecars record full binary and issued-identity hashes. The
repository manifest publishes Alice and Mallory together; neither record is
copied from the unrelated supplied `TwoEnemies` bundle manifest.