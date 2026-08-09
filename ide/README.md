# CLOOMC IDE

A store-based IDE built on one idea: **a name is a binding, not a file.**

There is no patching here. A Lump cannot be edited — only superseded. Its
identity is the SHA-256 of its bytes, so compiling identical source twice
yields the same identity and there is nothing to version-number. Changing what
a name means mints a new Lump and appends a new binding; every past meaning
stays fetchable, which is what lets callers holding old Golden Tokens keep
running correctly until their `gt_seq` goes stale.

## The pipeline

```
source ──compile──▶ words ──hash──▶ identity
                             │
                             ├──seal──▶ provenance
                             │
                     bind ───┴──▶ name
```

**Identity** is the content hash. **Provenance** is an Ed25519 signature over
that hash — it does not confer identity, it attributes. Two IDEs compiling the
same source produce identical hashes and different seals, and both are correct.
**Binding** maps a dot-name to a hash, append-only. That log is the version
control.

## Two identities: individual and genotype

Every Lump carries **two** hashes, and the difference is the whole point.

**Content hash** — SHA-256 of the entire Lump, source and all. This is the
*individual*: this exact object, these exact bytes.

**Genotype hash** — SHA-256 of the header (size-normalized), the code, and the
c-list, with the embedded source *excluded*. This is the *species*: the
program and the authority it holds, independent of how much documentation it
carries or how large it grew to carry it.

Why two? Because a Lump roams. The same program may exist as a FULL individual
with all its comments (heavy, readable, kept at home) and as a NONE individual
with no source at all (light, opaque, running on silicon far away). They are
different individuals — different content hashes — but the **same genotype**,
because their code and their authority are byte-identical.

This is what answers the question *"a bare Lump's MTBF shifted on the board —
which documented Lump is it?"* The bare Lump carries its genotype hash. One
lookup returns every sibling sharing it, including the FULL one with the
readable source. Beyond doubt, because the genotype is derived from the actual
code and c-list bytes.

**The c-list is inside the genotype, never excluded.** The c-list is the
authority — the pet-names, the rights, the domain purity the organism holds.
Two Lumps with identical code but different c-lists are different organisms:
one may fire an LED and enter SelfTest, the other may hold entirely different
power. Excluding the c-list would let an over-privileged Lump masquerade as a
safe one under the same genotype. Only the source — documentation, which does
not change what the organism *is* or *can do* — is excluded.

## Source embedding and auto-resize

A Lump may carry the compressed source that produced it, in its freespace. A
Lump's size is a power of two words (64 to 32768). When the compressed source
does not fit the current freespace, the Lump **grows one power of two at a time
until it fits** — and the header, code, and c-list are carried across unchanged
(growing changes only how much freespace there is).

Growing changes the header, therefore the bytes, therefore the content hash — a
larger individual is a different individual — so resize runs before the seal,
never after. The genotype hash is unaffected: it excludes size.

If the source will not fit even the largest Lump (32768 words), embedding stops
honestly: the slot is marked `too-large`, the Lump is left valid, and the
message says so. That is the end of the road for a Lump this size — split the
abstraction, omit the source, or carry a compact DNA form instead.

## Authority view

The compiled c-list holds **null Golden Tokens** at compile time: slot
positions are assigned (LED0 → 0, SelfTest → 1, in declaration order) but
resolution to real GTs is deferred to load time. So the binary c-list alone
shows only nulls — useless as authority.

The real authority — each capability's pet-name and rights — lives in the
source's `capabilities { }` block. `lumpdump.py` reads that block back from the
embedded source and pairs it to the slots by declaration order, showing:

```
c-list authority  2 slot(s)
  [0]  LED0      R W   Turing   (unresolved · null GT)
  [1]  SelfTest  E     Church   (unresolved · null GT)
```

Rights determine domain structurally: R/W/X → Turing, L/S/E → Church. This is
the ultimate definition of authority, visible even while the GTs are null.

## Run it

The CLOOMC compiler is JavaScript. The IDE drives the real compiler through the
Node worker (`server/compile_worker.js`) in a church-machine checkout — no HTTP
endpoint, no network, the same compiler and lump-builder the browser uses.

```bash
python3 server.py --repo ~/church-machine     # real compiler via Node worker
python3 server.py --offline                    # built-in fake, no Node, no network
```

Then open `http://localhost:8420`. Node and a church-machine checkout are
required for `--repo`; `--offline` needs neither and produces structurally
valid (but null-code) Lumps for demonstration.

| Flag | Default | Purpose |
|------|---------|---------|
| `--port` | 8420 | listen port |
| `--store` | `~/.cloomc/store` | object store, binding log, genotype index |
| `--identity` | `~/.cloomc/identity.json` | Ed25519 signing key (mode 0600) |
| `--repo` | — | church-machine checkout; uses the real Node compiler |
| `--offline` | — | built-in fake compiler for demonstration |

## Source-carriage modes: FULL / DNA / NONE

Because a Lump roams, you choose how much of itself it carries. All three modes
produce the same genotype — identical code and authority — so any of them can
be traced home to the others.

**FULL** embeds the source verbatim, comments and all, growing the Lump as
needed. For development and for the documented original that stays home. A NEW
organism.

**DNA** embeds only the genotype-bearing lines — the `capabilities { }` block
and the instructions, with comments and blank lines stripped. Small enough to
usually fit the base size, still enough for the authority view and a readable
disassembly. For a MATURE organism that roams light.

**NONE** embeds nothing. Smallest and opaque, for proprietary code or when the
source lives elsewhere. Traced home by genotype.

The relationship is the point: a NONE Lump running on silicon, whose MTBF has
shifted, carries the genotype hash that leads back to its FULL sibling in the
store — the one with every comment intact. The organism travels light; its
documentation stays home.

```bash
python3 lumpdump.py <hash>          # shows identity, genotype, and any siblings
python3 lumpdump.py --name X        # 'siblings' lists other forms of one genotype
```

## Inspect a Lump

```bash
python3 lumpdump.py <hash-prefix>          # by content hash
python3 lumpdump.py --name cloomc.led.v1   # by bound dot-name
python3 lumpdump.py --file path/to.lump    # a raw file
python3 lumpdump.py                        # list everything in the store
```

Shows the header decode, the code, the **c-list authority** view, the embedded
source (decompressed), and the full hex.

## What's in the store

```
~/.cloomc/store/
  objects/
    <hash>.lump      the bytes
    <hash>.seal      Ed25519 provenance
    <hash>.geno      this individual's genotype hash
  bindings.log       append-only: dot-name → hash history (the version control)
  genotypes.log      append-only: genotype → individual (the provenance link)
```

## The consumer half already existed

`CM_LUMP_SPECIFICATION.md` specifies content-addressed fetch
(`{label}@sha256:{hash}`), verification before inflate, and Mint issuing an
E-GT only after validation. This is the producer half: compile, hash, seal,
bind, and carry both identities so an organism can roam and still be traced
home.
