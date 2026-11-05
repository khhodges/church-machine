from hardware.wukong_bridge import ChurchTracePolicy, TRACE_EV_RESULT


def packet(**fields):
    return dict(ev_type=TRACE_EV_RESULT, payload_gt=0, fault_valid=False,
                bp_hit=False, **fields)


def test_default_suppresses_turing_but_keeps_church_and_faults():
    policy = ChurchTracePolicy()
    assert not policy.keep(packet())
    assert policy.keep({**packet(), "ev_type": 6})
    assert policy.keep({**packet(), "fault_valid": True})
    assert not policy.detail


def test_actual_breakpoint_opens_detail_until_run():
    policy = ChurchTracePolicy()
    policy.command("b")  # arming must not enable detail ahead of arrival
    assert not policy.keep(packet())
    assert policy.keep({**packet(), "bp_hit": True})
    assert policy.keep(packet())
    policy.command("r", ok=False)
    assert policy.keep(packet())
    policy.command("r")
    assert not policy.keep(packet())


def test_step_is_visible_and_replacement_resets_detail():
    policy = ChurchTracePolicy()
    policy.command("s")
    assert policy.keep(packet())
    policy.command("u")
    assert not policy.keep(packet())
    assert policy.keep(packet(), church_only=False)


def test_mapped_church_result_is_not_mistaken_for_turing(monkeypatch):
    import hardware.wukong_bridge as bridge
    monkeypatch.setattr(bridge, "_uploaded_trace_rows", {
        "4096": {"map_instr_word": 0x0F800000},
        "4100": {"map_instr_word": 0xAF080000},
    })
    policy = ChurchTracePolicy()
    assert policy.keep({**packet(), "nia": 4096})
    assert not policy.keep({**packet(), "nia": 4100})
