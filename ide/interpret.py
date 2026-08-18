"""
interpret.py — the Church Machine command interpreter, in the small.

Not a compiler. A live interpreter, the way PP250's command interpreter was
live: you speak a statement, the machine resolves the authority it names,
checks it, acts, and answers — and you write the next statement knowing what
the last one did. The human stays in the loop. Write is run.

This is the faithful *model* of a resident abstraction. It runs here in Python
over the store — the machine's own memory — so we can hold a real conversation
with the machine today. Its destination is to be reborn as a CLOOMC++
abstraction resident on the Church Machine, installed at cold boot, holding the
authorities it was granted, checked like any other. Everything here is shaped
so that rebirth is natural, not a rewrite:

  • It never reaches across a boundary. There is no deploy, no client, no
    handshake — inside the machine there is nothing to reach. It acts on the
    store the way a resident interpreter acts on the namespace it lives in.
  • Every statement is a capability-mediated act. Resolving a name, minting a
    Lump, binding a name — each is an authority exercised, not an ambient power
    taken. When this is reborn inside, those become real Golden Token checks;
    here they are modelled honestly against the store.
  • It never guesses. A statement it does not understand is answered plainly as
    a statement it does not understand — never coerced, never "did you mean",
    never run on a guess. This is the one law inherited from the machine and
    from every bad language's cautionary tale: the interpreter that says "I do
    not understand" is safer and kinder than the one that guesses and acts.

The vocabulary is deliberately small and grows one verb at a time. Forth and
PP250 both proved an interpreter can be tiny and complete, and that the power
is in letting the vocabulary grow. We start with the verbs needed to hold a
first conversation with the machine's memory, and no more.

Copyright (c) 2024-2026 Kenneth Hamer-Hodges. GPL-3.0.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from store import LumpStore, Identity, parse_header, genotype_hash, lump_bytes


# ── what an act answers with ─────────────────────────────────────────────────
# Every statement produces an Answer: what happened, in plain words, and
# whether it succeeded. The interpreter prints the plain words; the ok flag and
# any value are for a caller (a test, or a resident host) that wants them.

@dataclass
class Answer:
    ok: bool
    said: str                      # plain-language account of what happened
    value: object = None           # optional structured result

    def __str__(self) -> str:
        return self.said


def ok(said, value=None):     return Answer(True, said, value)
def no(said):                 return Answer(False, said)


# ── a parsed statement: verb · subject · qualifiers ──────────────────────────
# The grammar turns a line of text into an Utterance — the fields an act needs,
# gathered structurally rather than by regex groups. An Utterance knows which
# act to run and carries its data; calling it runs the act. This is what lets
# the same act be reached by many phrasings: the grammar maps phrasing → fields,
# the act reads fields, and the two are cleanly separated.

@dataclass
class Utterance:
    interp: object
    act: object                        # the bound method to run
    data: dict                         # parsed fields (name, cap, rights, …)
    fixed: dict                        # any fixed extras from the rule

    def __call__(self, _self_ignored=None):
        return self.act(self)

    def get(self, key, default=None):
        return self.data.get(key, self.fixed.get(key, default))

    def group(self, key):
        """Bridge to the acts, which were written to read regex groups. An
        Utterance answers group('name') from its parsed fields, so the acts did
        not need rewriting when recognition became a grammar."""
        return self.data.get(key, self.fixed.get(key))


# ── a living organism — an amoeba being raised ───────────────────────────────
# Not a draft. The current shape of a lineage, from which the next generation
# divides. Its `source` is the current generation's genotype expressed as text;
# each spoken statement extends it and seals a new whole gene. `last_hash` is
# the sealed identity of the most recent generation, the parent of the next.

@dataclass
class Organism:
    name: str                          # full dot-name
    caps: list                         # [(pet, [rights]), ...] — what it reaches
    body: list                         # instruction lines, in order
    last_hash: str | None = None       # last sealed generation, if any
    generation: int = 0

    def source(self) -> str:
        """The organism's current genotype as formal source: its capabilities
        block followed by its body. This is what gets sealed into the next
        gene. Generic at birth (no caps, no body) — the amoeba — and
        differentiated by what it has reached and been told to do."""
        lines = []
        if self.caps:
            lines.append("capabilities {")
            for pet, rights in self.caps:
                lines.append(f"    {pet} {''.join(rights)}")
            lines.append("}")
        lines.extend(self.body)
        return "\n".join(lines) + ("\n" if lines else "")


# ── the interpreter ──────────────────────────────────────────────────────────

class Interpreter:
    """Reads a statement, resolves what it names, checks, acts, answers.

    Holds a store (the machine's memory) and an identity (who is speaking —
    the authority under which acts are performed). In the resident rebirth,
    'identity' becomes the abstraction's own authority and every resolve/mint
    becomes a Golden Token check; here it is the signer of seals and the
    stand-in for held authority.
    """

    def __init__(self, store: LumpStore, identity: Identity, compiler=None):
        self.store = store
        self.identity = identity
        # The compiler that seals a generation. Optional: without it the
        # interpreter can read the machine's memory and shape living organisms,
        # but cannot seal them into new genes. With it (the real Node worker),
        # every statement can express a whole new sealed generation.
        self.compiler = compiler
        # Living organisms — amoebae currently being raised. Keyed by pet-name.
        # Each holds its current source (the generation's genotype as text) and
        # the hash of its last sealed generation, if any. This is NOT a mutable
        # draft that gets edited: every statement seals a new WHOLE generation
        # from the current source, and the source is simply the shape the next
        # division proceeds from. Nothing here is ever content-addressed until
        # it is sealed as a complete gene.
        self._living: dict[str, "Organism"] = {}
        self._focus: str | None = None      # the organism most recently spoken
                                            # of, so terse "reach for X" knows
                                            # who is meant
        self._vocab: list[tuple[re.Pattern, callable]] = []
        self._install_core_vocabulary()

    # -- the loop: read, resolve, check, act, answer -------------------------

    def say(self, statement: str) -> Answer:
        """Interpret one statement: read, resolve, check, act, answer.

        Recognition is a small grammar, not a list of patterns. A statement is
        a VERB applied to a SUBJECT, optionally QUALIFIED. The parser finds the
        verb first — by meaning, so 'help', 'help me', and 'please help' all
        reach the same verb — then reads the rest structurally. This is what
        keeps the language a structure a person can learn, rather than a
        thicket of phrasings that must each be enumerated. When the parser
        cannot find a verb it knows, it says so plainly and never guesses.
        """
        text = statement.strip()
        if not text or text.startswith(";") or text.startswith("#"):
            return ok("")
        u = self._parse(text)
        if u is None:
            return no(f"I do not understand: {text!r}. "
                      f"{self._known_verbs()} "
                      f"Say what can you do for the full list.")
        return u.act(u)

    def converse(self, lines: list[str]) -> list[Answer]:
        return [self.say(line) for line in lines]

    # -- the grammar: verb · subject · qualifiers ---------------------------
    #
    # The whole language is a handful of verbs. Each verb is recognised by its
    # meaning — a set of ways a person might name it — not by one fixed string,
    # so natural phrasing is accepted by understanding rather than enumeration.
    # A parsed statement is an Utterance carrying the fields an act needs; the
    # acts read those fields the way they used to read regex groups.

    def _parse(self, text: str):
        """Find the verb, then read the subject and qualifiers. Returns an
        Utterance, or None if no known verb is present."""
        low = text.lower().rstrip("?.! ").strip()

        # Each grammar rule: (recogniser, builder). Tried in order; first that
        # recognises wins — deterministic, no scoring. A recogniser returns the
        # match data (or None); the builder turns it into an Utterance bound to
        # an act. Order matters only where one form is a prefix of another, and
        # those are ordered most-specific-first.
        for recognise, build in self._grammar:
            data = recognise(low, text)
            if data is not None:
                return build(data)
        return None

    def _install_core_vocabulary(self):
        # The grammar, in order. Each entry pairs a recogniser with a builder.
        # Helpers below (_kw, _after, _subject_of) keep the recognisers small
        # and readable, so the whole language is legible on one screen.
        g = []

        def rule(recogniser, act, **fixed):
            g.append((recogniser,
                      lambda data, act=act, fixed=fixed:
                          Utterance(self, act, data, fixed)))

        # ── about me — asked many ways, all reaching one verb ───────────────
        rule(lambda lo, t: {} if self._kw(lo, [
                "what can you do", "what can i do", "what can i say",
                "help", "help me", "help please", "please help",
                "how do you work", "what do you do"]) else None,
             self._what_can_you_do)

        rule(lambda lo, t: {} if self._kw(lo, [
                "who are you", "what are you", "are you a lump",
                "are you an organism", "are you alive", "what kind of thing "
                "are you"]) else None,
             self._who_are_you)

        rule(lambda lo, t: {} if self._kw(lo, [
                "who am i", "what am i", "under whose authority"]) else None,
             self._who_am_i)

        # ── bring into being ────────────────────────────────────────────────
        # create <name> [like <parent> [and <parent>...]]
        rule(lambda lo, t: self._match_create(t), self._create)

        # ── shape: reach ────────────────────────────────────────────────────
        # <name> reaches/may reach <cap> [to/for <rights>]
        # reach [for] <cap> [to/for <rights>]           (the one in focus)
        rule(lambda lo, t: self._match_reach(t), self._reach)

        # ── seal ────────────────────────────────────────────────────────────
        rule(lambda lo, t: self._match_seal(t), self._seal)

        # ── ask about what I hold ───────────────────────────────────────────
        rule(lambda lo, t: {} if self._kw(lo, [
                "what do you know", "what do you hold", "list", "list names",
                "show me what you know", "what names do you know"]) else None,
             self._list_names)

        rule(lambda lo, t: self._match_about(
                lo, t, ["what is", "what's", "tell me about", "describe"]),
             self._what_is)

        rule(lambda lo, t: self._match_about(
                lo, t, ["what can", "what does"], suffix="reach"),
             self._authority)

        rule(lambda lo, t: self._match_about(
                lo, t, ["where did", "where does"], suffix="come from"),
             self._history)

        rule(lambda lo, t: self._match_about(
                lo, t, ["who else is", "what else is", "who shares"]),
             self._siblings)

        self._grammar = g

    # -- recognisers ---------------------------------------------------------

    @staticmethod
    def _kw(low: str, phrases) -> bool:
        """True if the statement is one of these phrasings (whole-line, so a
        keyword is a deliberate utterance, not an accidental substring)."""
        return low in phrases

    def _match_create(self, text):
        m = re.match(r"(?i)^\s*create\s*\(?\s*(?P<name>[\w.]+)\s*\)?"
                     r"(?:\s+like\s+(?P<parents>[\w. ]+?))?\s*$", text)
        return m.groupdict() if m else None

    def _match_reach(self, text):
        _R = (r"(?:read|write|run|execute|enter|save|load|reading|writing|"
              r"running|entering|saving|loading|reads|writes|and|,|\s)+")
        # named subject
        m = re.match(rf"(?i)^\s*(?P<name>[\w.]+)\s+(?:may reach|reaches|reach)"
                     rf"\s+(?:for\s+)?(?P<cap>[\w ]+?)"
                     rf"(?:\s+(?:to|for)\s+(?P<rights>{_R}))?\s*$", text)
        if m:
            d = m.groupdict(); d["focused"] = False; return d
        # focused (no subject) — the one being raised
        m = re.match(rf"(?i)^\s*reach\s+(?:for\s+)?(?P<cap>[\w ]+?)"
                     rf"(?:\s+(?:to|for)\s+(?P<rights>{_R}))?\s*$", text)
        if m:
            d = m.groupdict(); d["name"] = None; d["focused"] = True; return d
        return None

    def _match_seal(self, text):
        m = re.match(r"(?i)^\s*seal\s*\(?\s*(?P<name>[\w.]+)\s*\)?\s*$", text)
        return m.groupdict() if m else None

    def _match_about(self, low, text, openers, suffix=None):
        """Recognise 'what is X', 'what can X reach', etc. — an opener, a name,
        and an optional suffix — pulling the name out structurally."""
        cleaned = text.rstrip("?.! ").strip()
        low_clean = cleaned.lower()
        for opener in openers:
            if low_clean.startswith(opener + " "):
                rest = cleaned[len(opener):].strip()
                if suffix and rest.lower().endswith(suffix):
                    rest = rest[:-len(suffix)].strip()
                if rest:
                    return {"name": rest}
        return None
    # -- resolving a name: pet-name or full dot-name -------------------------

    def _find(self, spoken: str):
        """Resolve a spoken name to what the machine knows of it. Accepts a
        full dot-name or a pet-name. Looks among LIVING organisms (conceived,
        being raised, perhaps not yet sealed) as well as sealed genes in the
        store — because a conceived organism is real and answerable the moment
        she exists, not only once she is a gene.

        Returns (found, None) on a clean resolve, or (None, answer) when unknown
        or ambiguous. `found` is a Binding (sealed) or an Organism (living).
        Ambiguity is never guessed: it is asked.
        """
        full = self._as_dotname(spoken)

        # a living organism, if one is being raised under this name
        living = self._living.get(full)

        # exact sealed dot-name
        b = self.store.resolve(spoken) or self.store.resolve(full)
        if b is not None:
            return b, None
        if living is not None:
            return living, None

        # pet-name: the last segment of some known name, living or sealed
        pet = self._petname(spoken)
        sealed_matches = [n for n in self.store.names()
                          if self._petname(n) == pet]
        living_matches = [n for n in self._living
                          if self._petname(n) == pet]
        matches = list(dict.fromkeys(sealed_matches + living_matches))

        if len(matches) == 1:
            name = matches[0]
            return (self.store.resolve(name) or self._living.get(name)), None
        if len(matches) == 0:
            return None, no(f"I do not know {pet}. "
                            f"Say create {pet} to bring her into being.")
        return None, no(
            f"{pet} could mean {len(matches)} things: "
            + ", ".join(sorted(matches)) + ". Which do you mean?")

    def _petname(self, full: str) -> str:
        """The short name for display — the last segment of a dot-name."""
        return full.rsplit(".", 1)[-1]

    # -- the acts ------------------------------------------------------------
    # Each returns an Answer. Each is one capability-mediated act. None guesses.

    def _list_names(self, m) -> Answer:
        sealed = list(self.store.names())
        living = [n for n in self._living if n not in sealed]
        if not sealed and not living:
            return ok("I know nothing yet. Nothing has been named.")
        all_names = sealed + living
        pets = [self._petname(n) for n in all_names]
        shown = []
        for n in sorted(sealed):
            pet = self._petname(n)
            shown.append(pet if pets.count(pet) == 1 else f"{pet} ({n})")
        said = "I know: " + ", ".join(shown) + "." if shown else ""
        if living:
            raising = ", ".join(sorted(self._petname(n) for n in living))
            said = (said + " " if said else "") + \
                   f"I am also raising (not yet sealed): {raising}."
        return ok(said, value={"sealed": sorted(sealed),
                               "living": sorted(living)})

    def _what_is(self, m) -> Answer:
        found, err = self._find(m.group("name"))
        if err:
            return err
        if isinstance(found, Organism):
            reach = (", ".join(c[0] for c in found.caps)
                     if found.caps else "nothing yet")
            state = ("sealed once" if found.last_hash else "not yet sealed")
            return ok(f"{self._petname(found.name)} is a living organism, "
                      f"{state}. She may reach {reach}. She is being raised — "
                      f"tell her more, or seal her.")
        b = found
        pet = self._petname(b.name)
        try:
            header = parse_header(self._words(b.hash))
            geno = self.store.genotype_of(b.hash) or "—"
            pending = self.store.pending(b.hash)
        except Exception as e:
            return no(f"{pet} is named, but I cannot read it: {e}")
        auth = ("all its authority is connected"
                if not pending
                else f"{len(pending)} of its authorities are declared but not "
                     f"yet connected")
        return ok(
            f"{pet} is a {header['typ_name']} of {header['size_words']} words. "
            f"Its identity is {b.hash[:12]}…; its species is {geno[:12]}…; "
            f"{auth}.",
            value={"name": b.name, "hash": b.hash, "genotype": geno,
                   "header": header, "pending": pending})

    def _history(self, m) -> Answer:
        found, err = self._find(m.group("name"))
        if err:
            return err
        pet = self._petname(found.name)
        if isinstance(found, Organism) and not found.last_hash:
            return ok(f"{pet} has no history yet — she is alive and being "
                      f"raised, not yet sealed into a gene.")
        hist = self.store.history(found.name)
        if len(hist) == 1:
            h = hist[0]
            return ok(f"{pet} has meant one thing: {h.hash[:12]}…, "
                      f"named by {h.signer}"
                      + (f" — {h.note}" if h.note else "") + ".")
        lines = [f"{pet} has meant {len(hist)} things, oldest first:"]
        for i, h in enumerate(hist, 1):
            lines.append(f"  {i}. {h.hash[:12]}… by {h.signer}"
                         + (f" — {h.note}" if h.note else ""))
        return ok("\n".join(lines), value=hist)

    def _authority(self, m) -> Answer:
        found, err = self._find(m.group("name"))
        if err:
            return err
        pet = self._petname(found.name)
        if isinstance(found, Organism):
            if not found.caps:
                return ok(f"{pet} reaches nothing yet — she is generic, "
                          f"waiting to be told what she may reach.")
            lines = [f"{pet} may reach:"]
            for cap, rights in found.caps:
                lines.append(f"  {cap} — {self._rights_words(rights)} "
                             f"({self._domain(rights)})")
            return ok("\n".join(lines), value=found.caps)
        caps = self._capabilities_of(found.hash)
        if caps is None:
            return ok(f"{pet} carries no readable authority — its source was "
                      f"not kept. Ask who else is {pet} to find a fuller "
                      f"sibling.")
        if not caps:
            return ok(f"{pet} reaches nothing — it declares no authority.")
        lines = [f"{pet} may reach:"]
        for pet_name, rights, dom in caps:
            lines.append(f"  {pet_name} — {self._rights_words(rights)} ({dom})")
        return ok("\n".join(lines), value=caps)

    def _siblings(self, m) -> Answer:
        found, err = self._find(m.group("name"))
        if err:
            return err
        pet = self._petname(found.name)
        if isinstance(found, Organism) and not found.last_hash:
            return ok(f"{pet} has no siblings yet — she is not sealed, so she "
                      f"has no species to share.")
        h = found.last_hash if isinstance(found, Organism) else found.hash
        home = self.store.trace_home(h)
        if not home:
            return ok(f"{pet} stands alone — no other form of it is stored.")
        return ok(
            f"{pet} shares its species with {len(home)} other form(s): "
            + ", ".join(x[:12] + "…" for x in home)
            + ". They are the same organism carrying different amounts of "
              "themselves.",
            value=home)

    def _who_am_i(self, m) -> Answer:
        return ok(f"You speak as {self.identity.name}. "
                  f"Acts are performed under this authority.")

    def _who_are_you(self, m) -> Answer:
        """The interpreter's self. It is an organism too — the resident
        abstraction that tends the others, of the same biology, not above it."""
        known = len(self.store.names())
        raising = len(self._living)
        can_seal = "I can seal organisms into genes" if self.compiler \
            else "I cannot seal yet — no compiler is connected"
        return ok(
            f"I am the Church Machine's command interpreter — the resident "
            f"abstraction you speak to. I live as {self.identity.name}. I read "
            f"what you say, resolve the authority it names, check it, and act. "
            f"I can bring organisms into being, let them reach for authority, "
            f"breed them from parents, and remember their lineage. I hold "
            f"{known} name(s) in memory"
            + (f" and am raising {raising} not yet sealed" if raising else "")
            + f". {can_seal}. I am an organism like the ones I tend — I hold "
            f"the authority to mint and bind, and no more.")

    def _what_can_you_do(self, m) -> Answer:
        """A full, grouped, plain account of the vocabulary — so a person who
        is lost is shown everything the machine can do, not a fragment."""
        return ok(
            "Here is what you can say.\n"
            "\n"
            "  To bring an organism into being:\n"
            "    create <name>                       — a generic organism,\n"
            "                                          ready to reach anywhere\n"
            "    create <name> like <parent>         — inherit one parent's\n"
            "                                          authority\n"
            "    create <name> like <a> and <b>      — breed from several,\n"
            "                                          composing their authority\n"
            "\n"
            "  To shape her:\n"
            "    <name> reaches <cap> to read and write   — reach for data\n"
            "    <name> reaches <cap>                     — reach for an\n"
            "                                              abstraction to call\n"
            "    reach for <cap> ...                      — the one you are\n"
            "                                              raising now\n"
            "    seal <name>                              — make her a gene\n"
            "                                              (needs a compiler)\n"
            "\n"
            "  To ask about what I hold:\n"
            "    what do you know            — the names I hold\n"
            "    what is <name>              — her identity, species, state\n"
            "    what can <name> reach       — her authority, plainly\n"
            "    where did <name> come from  — her lineage\n"
            "    who else is <name>          — her siblings, by species\n"
            "\n"
            "  About me:\n"
            "    who am I / who are you / what can you do\n"
            "\n"
            "I never guess. If I do not understand, I say so; if a name is "
            "ambiguous, I ask which you mean.")

    # -- acts that express new genes -----------------------------------------

    def _create(self, m) -> Answer:
        """Found a new organism. With no parents, the generic amoeba —
        undifferentiated, ready to reach in any direction. With parents, a
        recombination: the new organism inherits the union of its parents'
        authority, then differentiates by what it is told beyond its
        inheritance. This is the general law; one parent is its degenerate
        case, several is sexual reproduction."""
        full = self._as_dotname(m.group("name"))
        pet = self._petname(full)

        if self.store.resolve(full) is not None:
            return no(f"{pet} already exists in the machine's memory. "
                      f"Ask what is {pet}, or raise a new generation.")
        if full in self._living:
            return no(f"{pet} is already alive and being raised. "
                      f"Tell her what she may reach, or seal {pet}.")

        parents_phrase = m.group("parents")
        if not parents_phrase:
            # generic amoeba — born from nothing, undifferentiated
            self._living[full] = Organism(name=full, caps=[], body=[])
            self._focus = full
            return ok(f"{pet} now exists — a generic organism, holding no "
                      f"authority yet, ready to reach in any direction. "
                      f"Tell her what she may reach.")

        # recombination — inherit from one or more parents, sealed or living
        parent_names = [p.strip() for p in
                        re.split(r"\s+and\s+", parents_phrase) if p.strip()]
        resolved, unknown = [], []
        for pn in parent_names:
            org_or_binding = self._find_parent(pn)
            if org_or_binding is None:
                unknown.append(pn)
            else:
                resolved.append(org_or_binding)
        if unknown:
            return no(f"I cannot make {pet} — I do not know "
                      f"{self._and_list(unknown)}. "
                      f"A child can only inherit from organisms I know.")

        merged, conflicts = self._recombine(resolved)
        if conflicts:
            # the one law: do not guess how to merge conflicting authority
            lines = [f"I cannot make {pet} yet — her parents disagree on "
                     f"what she may reach, and I will not guess:"]
            for cap, variants in conflicts.items():
                lines.append(f"  {cap}: " + "; ".join(
                    f"{src} grants {self._rights_words(r)}"
                    for src, r in variants))
            lines.append("Say how she should reach each, and I will make her.")
            # remember the pending recombination so the person can resolve it
            self._pending_birth = {
                "name": full, "merged": merged, "conflicts": conflicts,
                "parents": [self._petname(b.name) for b in resolved]}
            return no("\n".join(lines))

        caps = [(cap, rights) for cap, (rights, _src) in merged.items()]
        org = Organism(name=full, caps=caps, body=[])
        self._living[full] = org
        parents_said = self._and_list([self._parent_pet(p) for p in resolved])
        reach = (", ".join(c[0] for c in caps) if caps else "nothing yet")
        sealed = self._express(org)
        if sealed.ok:
            return ok(f"{pet} is born of {parents_said}, inheriting their "
                      f"authority: she may reach {reach}. {sealed.said}")
        return ok(f"{pet} is conceived of {parents_said}, inheriting their "
                  f"authority: she may reach {reach}. She is alive but not "
                  f"yet sealed — {self._why_unsealed()}")

    def _find_parent(self, name: str):
        """A parent may be a sealed gene (in the store) or a living organism
        (being raised, not yet sealed). Either can pass on authority. Returns
        an Organism, a Binding, or None. A living organism is preferred when
        both exist, because it is the most recent shape."""
        full = self._as_dotname(name)
        if full in self._living:
            return self._living[full]
        b, _ = self._find(name)
        return b

    def _parent_caps(self, parent):
        """Capabilities of a parent, whether living or sealed."""
        if isinstance(parent, Organism):
            return [(pet, rights, self._domain(rights))
                    for pet, rights in parent.caps]
        caps = self._capabilities_of(parent.hash) or []
        return caps

    def _parent_pet(self, parent) -> str:
        return self._petname(parent.name)

    @staticmethod
    def _domain(rights):
        CHURCH = {"E", "S", "L"}
        TURING = {"R", "W", "X"}
        if any(r in CHURCH for r in rights):
            return "Church"
        if any(r in TURING for r in rights):
            return "Turing"
        return "?"

    def _recombine(self, parents):
        """Compose parents' capabilities into one inheritance. Returns
        (merged, conflicts). Parents may be living or sealed. Same capability
        with different rights across parents is a conflict — never merged
        silently."""
        merged, conflicts = {}, {}
        for parent in parents:
            src = self._parent_pet(parent)
            for pet, rights, _dom in self._parent_caps(parent):
                if pet not in merged:
                    merged[pet] = (rights, src)
                elif set(merged[pet][0]) != set(rights):
                    conflicts.setdefault(pet, [
                        (merged[pet][1], merged[pet][0])])
                    conflicts[pet].append((src, rights))
        for cap in conflicts:
            merged.pop(cap, None)
        return merged, conflicts

    @staticmethod
    def _and_list(items):
        items = list(items)
        if len(items) == 1:
            return items[0]
        if len(items) == 2:
            return f"{items[0]} and {items[1]}"
        return ", ".join(items[:-1]) + f", and {items[-1]}"

    def _reach(self, m) -> Answer:
        """Extend a pseudopod. The organism engulfs an authority; the reached
        organism is the next generation. Named ('Mother reaches X') or focused
        ('reach for X' — the one being raised)."""
        if m.group("focused"):
            if not self._focus:
                return no("Reach for whom? Say create <name> first, or name "
                          "the organism: '<name> reaches <cap>'.")
            full = self._focus
        else:
            full = self._as_dotname(m.group("name"))
        return self._do_reach(full, m.group("cap"), m.group("rights"))

    def _do_reach(self, full, cap_phrase, rights_phrase) -> Answer:
        pet = self._petname(full)
        org = self._living.get(full)
        if org is None:
            b = self.store.resolve(full)
            if b is None:
                return no(f"I do not know {pet}, and she is not being raised. "
                          f"Say create {pet} first.")
            org = self._revive(b)
            self._living[full] = org
        self._focus = full
        cap = self._as_cap(cap_phrase)
        rights = self._read_rights(rights_phrase)
        if any(c[0] == cap for c in org.caps):
            return no(f"{pet} already reaches {cap}.")

        # Silence about rights is not vagueness — it is a signature. To reach
        # for something without naming a data-right (read/write/run) is to name
        # an ABSTRACTION you will enter and call, not data you will touch. So
        # rights-less reach infers E (enter), the Church-domain entry right. An
        # E-abstraction is not complete alone: to enter is to call a method, so
        # the machine notes it needs methods and invites them.
        inferred_e = not rights
        if inferred_e:
            rights = ["E"]
        org.caps.append((cap, rights))

        if inferred_e:
            rights_said = ("enter — an abstraction you may call")
            tail = f" What methods does {cap} offer?"
        else:
            rights_said = self._rights_words(rights)
            tail = ""

        sealed = self._express(org)
        seal_note = sealed.said if sealed.ok else \
            f"(living, not yet sealed — {self._why_unsealed()})"
        return ok(f"{pet} may now reach {cap} — {rights_said}. "
                  f"{seal_note}{tail}")

    def _as_cap(self, phrase: str) -> str:
        """A spoken capability becomes a capability name. Multi-word phrases
        like 'digital memory' become a single CamelCase token 'DigitalMemory',
        so a person can speak naturally and the machine has a clean name to
        seal. One word passes through with its case kept."""
        words = phrase.strip().split()
        if len(words) == 1:
            return words[0]
        return "".join(w.capitalize() for w in words)

    def _seal(self, m) -> Answer:
        full = self._as_dotname(m.group("name"))
        pet = self._petname(full)
        org = self._living.get(full)
        if org is None:
            return no(f"{pet} is not being raised — nothing to seal. "
                      f"Say create {pet} first.")
        if self.compiler is None:
            return no(f"I cannot seal {pet} — {self._why_unsealed()} "
                      f"She remains alive and shaped; connect a compiler and "
                      f"say seal {pet} again.")
        return self._express(org, announce_seal=True)

    def _why_unsealed(self) -> str:
        return ("no compiler is connected. Start me with a church-machine "
                "checkout (--repo <path>) and I can seal organisms into genes; "
                "until then I can conceive and shape them, but not make them "
                "real.")

    # -- the generational engine ---------------------------------------------

    def _express(self, org, announce_seal=False) -> Answer:
        """Express the organism's current shape as a new whole gene: compile
        through the real compiler, seal, bind, advance the lineage. Every call
        is a faithful replication into the next generation, never an edit. The
        parent survives as ancestor in the append-only phylogeny."""
        if self.compiler is None:
            return no("I cannot seal a generation — no compiler is connected.")
        source = org.source()
        note = f"generation {org.generation + 1}" + (
            " — sealed" if announce_seal else "")
        try:
            r = self.compiler.compile_bind(
                source, org.name, self.store, self.identity,
                note=note, language="assembly", source_mode="full")
        except Exception as e:
            return no(f"Could not express this generation: {e}")
        if not r.ok:
            return no(f"This generation will not form: {r.error}")
        if r.rejected:
            return no(f"This generation was refused: {r.rejected}")
        org.generation += 1
        org.last_hash = r.hash
        geno = (getattr(r, "genotype", None) or "—")[:12]
        return ok(f"(generation {org.generation} sealed — "
                  f"identity {r.hash[:12]}…, species {geno}…)",
                  value={"hash": r.hash, "generation": org.generation})

    def _revive(self, binding):
        """Reconstruct a living organism from its last sealed gene so a new
        generation can be raised from it. The sealed gene is the parent."""
        caps_full = self._capabilities_of(binding.hash) or []
        caps = [(pet, rights) for (pet, rights, _dom) in caps_full]
        body, src = [], None
        try:
            words = self._words(binding.hash)
            src = self._unpack_source(words, parse_header(words))
        except Exception:
            pass
        if src and not src.startswith("\x00"):
            in_caps = False
            for line in src.splitlines():
                s = line.strip()
                if s.lower().startswith("capabilities"):
                    in_caps = "}" not in s
                    continue
                if in_caps:
                    in_caps = "}" not in s
                    continue
                if s and not s.startswith(";"):
                    body.append(line)
        return Organism(name=binding.name, caps=caps, body=body,
                        last_hash=binding.hash)

    # -- helpers -------------------------------------------------------------

    def _verb(self, pattern: str, action):
        self._vocab.append((re.compile(pattern, re.IGNORECASE), action))

    def _as_dotname(self, spoken: str) -> str:
        """A spoken name becomes a full dot-name. A pet-name is placed in the
        speaker's own namespace: 'Mother' → 'cloomc.lab.<pet>'. A name already
        dotted is taken as-is. This is where the pet-name gets its address —
        the amoeba is born somewhere, even though you called her by name."""
        if "." in spoken:
            return spoken
        # derive a home namespace from the speaking identity
        base = self.identity.name
        parts = base.split(".")
        home = ".".join(parts[:2]) if len(parts) >= 2 else base
        return f"{home}.{spoken.lower()}"

    def _read_rights(self, phrase: str | None) -> list[str]:
        """Turn 'read and write' / 'reading' / 'enter' into ['R','W'] / ['E'].
        Words, not letters, and both plain and -ing forms, because a person
        speaks rights however is natural."""
        if not phrase:
            return []
        words = {
            "read": "R", "reading": "R", "reads": "R",
            "write": "W", "writing": "W", "writes": "W",
            "run": "X", "running": "X", "runs": "X",
            "execute": "X", "executing": "X",
            "enter": "E", "entering": "E", "enters": "E",
            "save": "S", "saving": "S", "saves": "S",
            "load": "L", "loading": "L", "loads": "L",
        }
        out = []
        for w in phrase.lower().replace(",", " ").split():
            if w in words and words[w] not in out:
                out.append(words[w])
        return out

    def _known_verbs(self) -> str:
        return ("I can bring organisms into being (create <name>, or "
                "create <name> like <parent> and <parent>), let them reach "
                "for authority (<name> reaches <cap> to <rights>), and seal "
                "them (seal <name>); and I can tell you what I know, what a "
                "name is, what it reaches, where it came from, and who else "
                "shares its kind.")

    def _words(self, hash_hex: str) -> list[int]:
        import struct
        raw = self.store.get(hash_hex)
        return list(struct.unpack(f">{len(raw)//4}I", raw))

    def _capabilities_of(self, hash_hex: str):
        """The pet-name/rights authority of a Lump, from its embedded source's
        capabilities block. Returns [(pet, [rights], domain), ...], [] if the
        block is empty, or None if no source is carried. Mirrors lumpdump's
        authority view — the ultimate definition of authority."""
        words = self._words(hash_hex)
        h = parse_header(words)
        src = self._unpack_source(words, h)
        if not src or src.startswith("\x00"):
            return None
        return self._parse_caps(src)

    @staticmethod
    def _rights_words(rights) -> str:
        names = {"R": "read", "W": "write", "X": "run",
                 "E": "enter", "S": "save", "L": "load"}
        if not rights:
            return "nothing"
        return " and ".join(names.get(r, r) for r in rights)

    # source unpack + caps parse — same logic as store/lumpdump, kept local so
    # the interpreter has no import cycle and reads a Lump on its own terms.
    @staticmethod
    def _unpack_source(words, h):
        # V1.3 self-defining freespace: 0xAB content frame at word cw+1
        # (see CM_LUMP_SPECIFICATION.md §Freespace Content and Self-Definition).
        import struct
        fs_start = 1 + h["cw"]
        fs_end = h["size_words"] - h["cc"]
        if fs_start >= fs_end:
            return None
        hdr = words[fs_start] & 0xFFFFFFFF
        if (hdr >> 24) & 0xFF != 0xAB:
            return None                       # legacy — all-zero freespace
        flags = (hdr >> 16) & 0xFF
        if not (flags & 0x01):
            return None                       # Tier 0 — API only, no source
        api_len = hdr & 0xFFFF
        pos = fs_start + 1 + (api_len + 3) // 4
        if pos >= fs_end:
            return None
        src_len = words[pos] & 0xFFFFFFFF
        src_nw = (src_len + 3) // 4
        pos += 1
        if src_len == 0 or pos + src_nw > fs_end:
            return None
        raw = struct.pack(f">{src_nw}I", *words[pos:pos + src_nw])[:src_len]
        try:
            return raw.decode("utf-8")
        except UnicodeDecodeError:
            return None

    @staticmethod
    def _parse_caps(source):
        TURING, CHURCH = {"R", "W", "X"}, {"E", "S", "L"}
        caps, in_block = [], False
        for raw in source.splitlines():
            line = raw.split(";", 1)[0].split("//", 1)[0].strip()
            if not line:
                continue
            if not in_block:
                if line.lower().startswith("capabilities") and "{" in line:
                    in_block = True
                    line = line[line.index("{") + 1:]
                    if "}" in line:
                        line = line[:line.index("}")]; in_block = False
                    if not line.strip():
                        continue
                else:
                    continue
            if in_block and "}" in line:
                line = line[:line.index("}")]; in_block = False
                if not line.strip():
                    continue
            for item in line.split(","):
                toks = item.strip().split()
                if not toks or not toks[0][0].isalpha():
                    continue
                pet, rights = toks[0], []
                for t in toks[1:]:
                    for c in t.upper():
                        if (c in TURING or c in CHURCH) and c not in rights:
                            rights.append(c)
                dom = ("Church" if any(r in CHURCH for r in rights)
                       else "Turing" if any(r in TURING for r in rights)
                       else "?")
                caps.append((pet, rights, dom))
        return caps


# ── a plain REPL, for talking to the machine's memory by hand ────────────────

def repl(store_root=None, repo=None):
    """Speak to the machine's memory, line by line. Ctrl-D to stop.

    With --repo pointing at a church-machine checkout, the machine can seal new
    generations (create, reach, seal). Without it, the machine can read and
    shape organisms but not make them genes."""
    from pathlib import Path
    root = store_root or (Path.home() / ".cloomc" / "store")
    store = LumpStore(root)
    ident = Identity.generate("cloomc.lab.ide")
    compiler = None
    if repo:
        try:
            from node_compiler import NodeCompiler
            compiler = NodeCompiler(repo)
        except Exception as e:
            print(f"(no compiler: {e} — reading only)")
    machine = Interpreter(store, ident, compiler=compiler)
    print("Church Machine — speak. (Ctrl-D to stop.)")
    print(f"  {machine._who_am_i(None)}")
    if compiler is None:
        print("  (no compiler connected — I can read and shape, not seal)")
    while True:
        try:
            line = input("› ")
        except (EOFError, KeyboardInterrupt):
            print("\n…")
            return
        answer = machine.say(line)
        if answer.said:
            print(answer.said)


if __name__ == "__main__":
    import sys
    args = sys.argv[1:]
    repo = None
    if "--repo" in args:
        i = args.index("--repo")
        repo = args[i + 1]
        args = args[:i] + args[i + 2:]
    repl(args[0] if args else None, repo=repo)
