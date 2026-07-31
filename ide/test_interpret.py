"""Tests for the command interpreter — the machine talking to its memory."""
import tempfile


from store import LumpStore, Identity, embed_source
from interpret import Interpreter



def make_lump(n=6, cw=19, cc=2, clist=(0, 0)):
    size = 1 << n
    w = [0] * size
    w[0] = (0x1F << 27) | (((n-6) & 0xF) << 23) | ((cw & 0x1FFF) << 10) | cc
    for i in range(1, 1 + cw):
        w[i] = 0xAF080000 + i
    for k, v in enumerate(clist):
        w[size - cc + k] = v
    return w


SRC = ("capabilities {\n LED0 RW\n SelfTest E\n}\n"
       "LOAD CR3, LED0\nIADD DR1, DR0, #1\n")


# 'machine' is injected by the runner as (Interpreter, store, ide).


def _seed(store, ide, name="cloomc.lab.led.mother", mode="full", note="x"):
    lump, _ = embed_source(make_lump(), SRC, mode=mode)
    h, _ = store.put(lump, ide)
    store.bind(name, h, ide, note=note)
    return h


def test_empty_machine_knows_nothing(machine):
    m, _, _ = machine
    a = m.say("what do you know?")
    assert a.ok and "nothing" in a.said.lower()


def test_lists_names_after_binding(machine):
    m, store, ide = machine
    _seed(store, ide)
    a = m.say("what do you know?")
    assert a.ok and "mother" in a.said


def test_what_is_reports_identity_species_and_authority_state(machine):
    m, store, ide = machine
    _seed(store, ide)
    a = m.say("what is cloomc.lab.led.mother?")
    assert a.ok
    assert "species" in a.said
    assert "not yet connected" in a.said        # 2 null c-list slots


def test_authority_is_spoken_as_language(machine):
    m, store, ide = machine
    _seed(store, ide)
    a = m.say("what can cloomc.lab.led.mother reach?")
    assert a.ok
    assert "LED0" in a.said and "read and write" in a.said
    assert "SelfTest" in a.said and "enter" in a.said


def test_none_carries_no_readable_authority(machine):
    m, store, ide = machine
    _seed(store, ide, name="cloomc.lab.led.lean", mode="none")
    a = m.say("what can cloomc.lab.led.lean reach?")
    assert a.ok
    assert "not kept" in a.said or "no readable authority" in a.said


def test_siblings_traced_by_genotype(machine):
    m, store, ide = machine
    _seed(store, ide, name="cloomc.lab.led.full", mode="full")
    _seed(store, ide, name="cloomc.lab.led.bare", mode="none")
    a = m.say("who else is cloomc.lab.led.full?")
    assert a.ok and "same organism" in a.said


def test_history_is_provenance(machine):
    m, store, ide = machine
    _seed(store, ide, note="first light")
    a = m.say("where did cloomc.lab.led.mother come from?")
    assert a.ok and "first light" in a.said


def test_unknown_name_is_said_plainly_not_guessed(machine):
    m, _, _ = machine
    a = m.say("what is cloomc.lab.led.ghost?")
    assert not a.ok
    assert "create" in a.said            # unknown → offers to create, never guesses


def test_the_machine_never_guesses(machine):
    m, _, _ = machine
    a = m.say("polish my shoes")
    assert not a.ok
    assert "do not understand" in a.said
    assert "what can you do" in a.said           # points to help, never guesses


def test_blank_and_comment_say_nothing(machine):
    m, _, _ = machine
    assert m.say("").said == ""
    assert m.say("; a comment").said == ""


def test_who_am_i(machine):
    m, _, _ = machine
    a = m.say("who am i?")
    assert a.ok and "cloomc.lab.ide" in a.said


def test_petname_resolves_without_the_full_address(machine):
    m, store, ide = machine
    _seed(store, ide, name="cloomc.lab.led.mother")
    a = m.say("what is mother?")
    assert a.ok and "mother is a code" in a.said


def test_petname_authority_by_short_name(machine):
    m, store, ide = machine
    _seed(store, ide, name="cloomc.lab.led.mother")
    a = m.say("what can mother reach?")
    assert a.ok and "LED0" in a.said


def test_listing_shows_petnames_not_addresses(machine):
    m, store, ide = machine
    _seed(store, ide, name="cloomc.lab.led.mother")
    a = m.say("what do you know?")
    assert "mother" in a.said
    assert "cloomc.lab.led.mother" not in a.said     # address hidden when unambiguous


def test_ambiguous_petname_is_asked_not_guessed(machine):
    m, store, ide = machine
    _seed(store, ide, name="cloomc.lab.led.mother")
    _seed(store, ide, name="cloomc.lab.audio.mother", note="second")
    a = m.say("what is mother?")
    assert not a.ok
    assert "could mean" in a.said and "Which do you mean" in a.said


def test_full_name_still_works_to_disambiguate(machine):
    m, store, ide = machine
    _seed(store, ide, name="cloomc.lab.led.mother")
    _seed(store, ide, name="cloomc.lab.audio.mother")
    a = m.say("what is cloomc.lab.led.mother?")
    assert a.ok and "mother is a code" in a.said


# ── the amoeba: create, reach, the generational lineage ──────────────────────

class _SealingCompiler:
    """Stand-in for the Node worker: assembles a caps block into a real sealed
    Lump and binds it, so the generational engine can be tested offline."""
    def compile_bind(self, source, name, store, identity,
                     note="", language="assembly", source_mode="full"):
        from node_compiler import CompileResult
        from store import embed_source
        n = 6
        w = [0] * (1 << n)
        w[0] = (0x1F << 27) | ((2 & 0x1FFF) << 10) | (2 & 0xFF)
        w[1], w[2] = 0xAF080001, 0xAF080002
        words, snote = embed_source(w, source, mode=source_mode)
        h, header = store.put(words, identity)
        store.bind(name, h, identity, note=note)
        r = CompileResult(ok=True, language="assembly", words=words)
        r.hash = h; r.header = header
        r.genotype = header.get("genotype")
        r.pending = store.pending(h); r.source_note = snote
        return r


def _amoeba():
    import tempfile
    from store import LumpStore, Identity
    d = tempfile.mkdtemp()
    store = LumpStore(d)
    ide = Identity.generate("cloomc.lab.ide")
    return Interpreter(store, ide, compiler=_SealingCompiler()), store, ide


def test_unknown_name_offers_to_create():
    m, _, _ = _amoeba()
    a = m.say("what is mother?")
    assert not a.ok and "create mother" in a.said


def test_create_founds_the_generic_amoeba():
    m, _, _ = _amoeba()
    a = m.say("create mother")
    assert a.ok and "generic" in a.said and "ready to reach" in a.said


def test_create_twice_is_refused():
    m, _, _ = _amoeba()
    m.say("create mother")
    a = m.say("create mother")
    assert not a.ok and "already alive" in a.said


def test_reaching_seals_a_generation():
    m, _, _ = _amoeba()
    m.say("create mother")
    a = m.say("mother may reach LED0 to read and write")
    assert a.ok
    assert "may now reach LED0" in a.said
    assert "generation 1 sealed" in a.said


def test_each_reach_is_a_new_generation():
    m, store, _ = _amoeba()
    m.say("create mother")
    m.say("mother may reach LED0 to read and write")
    m.say("mother may reach SelfTest to enter")
    hist = store.history("cloomc.lab.mother")
    assert len(hist) == 2                      # two generations, a lineage
    assert "generation 1" in hist[0].note
    assert "generation 2" in hist[1].note


def test_the_lineage_is_spoken_as_provenance():
    m, _, _ = _amoeba()
    m.say("create mother")
    m.say("mother may reach LED0 to read and write")
    m.say("mother may reach SelfTest to enter")
    a = m.say("where did mother come from?")
    assert a.ok and "2 things" in a.said


def test_reaching_the_same_authority_twice_is_refused():
    m, _, _ = _amoeba()
    m.say("create mother")
    m.say("mother may reach LED0 to read and write")
    a = m.say("mother may reach LED0 to read and write")
    assert not a.ok and "already reaches" in a.said


def test_authority_spoken_after_reaching():
    m, _, _ = _amoeba()
    m.say("create mother")
    m.say("mother may reach LED0 to read and write")
    a = m.say("what can mother reach?")
    assert a.ok and "LED0" in a.said and "read and write" in a.said


def test_no_compiler_shapes_but_does_not_seal():
    import tempfile
    from store import LumpStore, Identity
    m = Interpreter(LumpStore(tempfile.mkdtemp()),
                    Identity.generate("cloomc.lab.ide"), compiler=None)
    m.say("create mother")
    a = m.say("mother may reach LED0 to read and write")
    assert a.ok and "not yet sealed" in a.said     # shaped, not refused


# ── recombination: inheritance from one or more parents ──────────────────────

def _with_parents():
    """An amoeba interpreter with two disjoint parents raised."""
    m, store, ide = _amoeba()
    m.say("create registry")
    m.say("registry may reach Slots to read and write")
    m.say("create mint")
    m.say("mint may reach Seal to enter")
    return m, store, ide


def test_single_parent_inheritance():
    m, _, _ = _with_parents()
    a = m.say("create archivist like registry")
    assert a.ok
    assert "born of registry" in a.said and "Slots" in a.said


def test_recombination_unions_disjoint_parents():
    m, _, _ = _with_parents()
    a = m.say("create mother like registry and mint")
    assert a.ok
    assert "registry and mint" in a.said
    assert "Slots" in a.said and "Seal" in a.said


def test_recombined_child_reaches_both_inheritances():
    m, _, _ = _with_parents()
    m.say("create mother like registry and mint")
    a = m.say("what can mother reach?")
    assert a.ok and "Slots" in a.said and "Seal" in a.said


def test_conflicting_parents_are_asked_never_guessed():
    m, _, _ = _with_parents()
    m.say("create warden")
    m.say("warden may reach Slots to read")          # Slots R, vs registry's RW
    a = m.say("create hybrid like registry and warden")
    assert not a.ok
    assert "disagree" in a.said and "will not guess" in a.said
    assert "read and write" in a.said and "Slots" in a.said


def test_inheriting_from_unknown_parent_is_refused():
    m, _, _ = _with_parents()
    a = m.say("create ghost like nobody")
    assert not a.ok and "do not know nobody" in a.said


def test_recombination_is_general_one_parent_is_its_special_case():
    # the same verb serves one parent and many — no second meaning
    m, _, _ = _with_parents()
    one = m.say("create childA like registry")
    two = m.say("create childB like registry and mint")
    assert one.ok and two.ok


# ── conception without a compiler; the interpreter's self ────────────────────

def _no_compiler():
    import tempfile
    from store import LumpStore, Identity
    return Interpreter(LumpStore(tempfile.mkdtemp()),
                       Identity.generate("cloomc.lab.ide"), compiler=None)


def test_conception_needs_no_compiler():
    m = _no_compiler()
    a = m.say("create mother")
    assert a.ok and "generic organism" in a.said


def test_reaching_without_compiler_shapes_but_does_not_seal():
    m = _no_compiler()
    m.say("create mother")
    a = m.say("mother may reach LED0 to read and write")
    assert a.ok                                  # she is shaped, not refused
    assert "not yet sealed" in a.said
    assert "LED0" in a.said


def test_recombination_conceives_without_compiler():
    m = _no_compiler()
    m.say("create ada")
    m.say("ada may reach Notes to read and write")
    m.say("create flag")
    m.say("flag may reach Signal to read")
    a = m.say("create mother like ada and flag")
    assert a.ok                                  # conceived, not refused
    assert "conceived of ada and flag" in a.said
    assert "Notes" in a.said and "Signal" in a.said


def test_seal_without_compiler_explains_plainly():
    m = _no_compiler()
    m.say("create mother")
    a = m.say("seal mother")
    assert not a.ok and "no compiler" in a.said.lower()
    assert "remains alive" in a.said


def test_who_are_you_answers_as_an_organism(machine):
    m, _, _ = machine
    a = m.say("who are you?")
    assert a.ok
    assert "command interpreter" in a.said
    assert "mint and bind" in a.said and "no more" in a.said


def test_who_are_you_variants(machine):
    m, _, _ = machine
    assert m.say("what are you?").ok
    assert m.say("who are you").ok               # no question mark


# ── the machine sees living organisms; natural & terse reach ─────────────────

def test_questions_see_living_organisms():
    """A conceived organism is answerable the moment she exists, not only once
    sealed — the blindness bug that made create-then-ask deny knowing her."""
    m = _no_compiler()
    m.say("create mint")
    a = m.say("what can mint reach")
    assert a.ok                                  # she is KNOWN, not denied
    assert "nothing yet" in a.said or "reach" in a.said


def test_what_is_reports_living_organism():
    m = _no_compiler()
    m.say("create mint")
    a = m.say("what is mint")
    assert a.ok and "living organism" in a.said


def test_terse_reach_applies_to_focus():
    m = _no_compiler()
    m.say("create mint")
    a = m.say("reach for digital memory to read")
    assert a.ok
    assert "DigitalMemory" in a.said and "read" in a.said


def test_rightsless_reach_infers_enter_abstraction():
    """Silence about rights is a signature, not vagueness: it names an
    abstraction to enter and call, so E is inferred and methods are invited."""
    m = _no_compiler()
    m.say("create mint")
    a = m.say("reach for digital memory")
    assert a.ok
    assert "enter" in a.said
    assert "method" in a.said.lower()            # invites the methods E implies


def test_rightsless_reach_is_church_domain():
    m = _no_compiler()
    m.say("create mint")
    m.say("reach for digital memory")
    a = m.say("what can mint reach")
    assert "DigitalMemory" in a.said and "Church" in a.said


def test_explicit_data_rights_stay_turing():
    m = _no_compiler()
    m.say("create mint")
    m.say("reach for LED0 to read and write")
    a = m.say("what can mint reach")
    assert "LED0" in a.said and "Turing" in a.said


def test_terse_reach_without_focus_asks():
    m = _no_compiler()
    a = m.say("reach for something")
    assert not a.ok and "Reach for whom" in a.said


def test_natural_reach_phrasing_captures_rights():
    m = _no_compiler()
    m.say("create mint")
    a = m.say("mint reaches Registry for reading and writing")
    assert a.ok and "read and write" in a.said


def test_multiword_capability_becomes_one_name():
    m = _no_compiler()
    m.say("create mint")
    m.say("reach for digital memory to read")
    a = m.say("what can mint reach")
    assert "DigitalMemory" in a.said


def test_listing_shows_living_organisms():
    m = _no_compiler()
    m.say("create mint")
    a = m.say("what do you know")
    assert "mint" in a.said and "raising" in a.said.lower()


def test_what_can_you_do_lists_the_acts(machine):
    m, _, _ = machine
    a = m.say("what can you do?")
    assert a.ok
    assert "create" in a.said and "reach" in a.said and "seal" in a.said
    assert "what do you know" in a.said


def test_help_is_an_alias(machine):
    m, _, _ = machine
    assert m.say("help").ok


def test_fallback_mentions_the_acts_not_only_questions(machine):
    m, _, _ = machine
    a = m.say("frobnicate the widget")
    assert not a.ok
    assert "create" in a.said                    # the creative half is shown


# ── the grammar: verbs recognised by meaning, not one fixed string ───────────

def test_help_accepts_many_phrasings(machine):
    m, _, _ = machine
    for phrase in ["help", "help me", "please help", "what can you do",
                   "what can i do", "how do you work"]:
        assert m.say(phrase).ok, phrase


def test_self_question_accepts_many_phrasings(machine):
    m, _, _ = machine
    for phrase in ["who are you", "what are you", "are you a lump",
                   "are you an organism", "are you alive"]:
        a = m.say(phrase)
        assert a.ok and "interpreter" in a.said, phrase


def test_about_questions_take_full_dotnames(machine):
    m, store, ide = machine
    _seed(store, ide, note="first light")
    assert "first light" in m.say(
        "where did cloomc.lab.led.mother come from?").said
    assert "LED0" in m.say(
        "what can cloomc.lab.led.mother reach?").said


def test_reach_verb_recognised_across_phrasings():
    m = _no_compiler()
    m.say("create mint")
    assert m.say("mint reaches Memory to read").ok
    assert m.say("mint may reach Store to write").ok
    assert m.say("reach for Cache to read").ok    # focused


def test_still_never_guesses_after_grammar(machine):
    m, _, _ = machine
    a = m.say("frobnicate the widget")
    assert not a.ok and "do not understand" in a.said
