---
name: Amaranth shape() memoization + full convert() O(n²) fix
description: Amaranth 0.5.8 convert() is O(n²) on large designs due to 5 uncached recursive traversals; all fixed by monkey-patches in gen_rtlil.py — total time 4.5s.
---

## The problem

Amaranth 0.5.8's `convert()` has multiple recursive AST traversal passes with
no caching. On the Wukong design (26-way decoder, deeply nested arithmetic),
each pass is O(n²) or worse.  Unpatched runtime: 10+ hours.  Patched: 4.5s.

## The five bottlenecks (in order found by py-spy)

| # | Hot function | Location | Fix |
|---|---|---|---|
| 1 | `Operator.shape()` / `SwitchValue.shape()` | `hdl/_ast.py` | instance `_shape_cache` attribute |
| 2 | `_check_rhs()` | `hdl/_dsl.py` | `set` of visited `id()`s |
| 3 | `DomainCollector.on_value` | `hdl/_xfrm.py` | `_visited_ids` set per instance |
| 4 | `ValueTransformer.on_value` | `hdl/_xfrm.py` | `__vt_cache` dict per instance |
| 5 | `Design._collect_used_signals_value` | `hdl/_ir.py` | `__cusv_seen` set per instance keyed `(id(frag), id(val))` |

## All patches live in `hardware/gen_rtlil.py`

Inside `generate_rtlil_wukong()`, before the `convert(top, ports=ports)` call.
Also: `gc.disable()` before `convert()` keeps ids stable and avoids GC pauses.

**Why id() is safe:** `gc.disable()` prevents object reuse, so `id()` is unique
for the lifetime of the process.

**Why caching is correct for each:**
- shape(): shapes are immutable once constructed
- _check_rhs(): validation only; errors would have already fired on first visit
- DomainCollector: set.add() is idempotent — revisits add nothing
- ValueTransformer: result for a given input node is deterministic per instance
- Design._collect_used_signals_value: _use_signal is set.add — idempotent

## Deployment to droplet

```bash
scp hardware/gen_rtlil.py root@165.227.190.84:/root/cm_gen/hardware/gen_rtlil.py
ssh root@165.227.190.84 'pkill -f hardware.gen_rtlil; tmux kill-session -t regen_v11 2>/dev/null; sleep 2; > /root/cm_gen/gen_rtlil.log; tmux new-session -d -s regen_v11; tmux send-keys -t regen_v11 "cd /root/cm_gen && /root/cm_venv/bin/python3 -m hardware.gen_rtlil build > gen_rtlil.log 2>&1; echo EXIT:\$? >> gen_rtlil.log" Enter'
```

Use `/root/cm_venv/bin/python3` (CPython 3.13 with amaranth 0.5.8).
System Python3 on the droplet does NOT have amaranth.
PyPy venv at `/root/pypy_venv` also works but py-spy cannot profile it.

## Profiling with py-spy

```bash
PID=$(pgrep -f "hardware.gen_rtlil")
py-spy record --pid $PID --duration 60 --output /tmp/pyspy.svg --format speedscope
# then analyse with the python3 -c json parser snippet to get top frame counts
```

## If future Amaranth upgrades regress convert() speed

Re-run py-spy, find the new hot function, add another id()-keyed cache in
`generate_rtlil_wukong()` before the `convert()` call.  The pattern is always:
uncached recursive tree traversal → add an instance-level visited set/dict.
