---
name: Amaranth shape() memoization
description: Amaranth 0.5.8 Operator/SwitchValue.shape() has no cache — causes O(n²) convert() on large designs; fix and how to apply it.
---

## The problem

Amaranth 0.5.8's `convert()` (amaranth.back.rtlil) spends 100% of its CPU in
`Operator.shape()` (hdl/_ast.py:1673) and `SwitchValue.shape()` (hdl/_ast.py:1950).
Neither method caches its result. Every call re-traverses the full expression
subtree of operands. With 26+ decoder opcodes each containing nested arithmetic
operators, `convert()` on the Wukong design took 2+ hours on a 4-vCPU server.

Confirmed by py-spy flamegraph: 2998 samples, 100% in `shape/_unify`.

## The fix (monkey-patch in gen_rtlil.py)

Add this block **before** the `convert(top, ports=ports)` call.
Shapes are immutable once constructed — caching is always correct.

```python
from amaranth.hdl._ast import Operator   as _AmaranthOperator
from amaranth.hdl._ast import SwitchValue as _AmaranthSwitchValue

_orig_op_shape = _AmaranthOperator.shape
def _cached_op_shape(self):
    try:
        return self._shape_cache
    except AttributeError:
        self._shape_cache = _orig_op_shape(self)
        return self._shape_cache
_AmaranthOperator.shape = _cached_op_shape

_orig_sv_shape = _AmaranthSwitchValue.shape
def _cached_sv_shape(self):
    try:
        return self._shape_cache
    except AttributeError:
        self._shape_cache = _orig_sv_shape(self)
        return self._shape_cache
_AmaranthSwitchValue.shape = _cached_sv_shape
```

**Why:** `Switch` (Statement) has no `shape()`. It is `SwitchValue` (a Value
subclass, hdl/_ast.py:1918) that does. Importing `Switch` and calling `.shape`
raises `AttributeError`.

## Also apply

- `gc.disable()` before `convert()` (GC pauses during heavy object allocation)
- Use CPython 3.13 venv at `/root/cm_venv` (has amaranth 0.5.8); system Python3
  on the droplet does NOT have amaranth; PyPy venv at `/root/pypy_venv` works
  but py-spy cannot profile it.

## How to apply

The patch is already in `hardware/gen_rtlil.py` in the repo (inside
`generate_rtlil_wukong()`). When deploying to the droplet:
```
scp hardware/gen_rtlil.py root@165.227.190.84:/root/cm_gen/hardware/gen_rtlil.py
```
Then run:
```
tmux new-session -d -s regen_v11
tmux send-keys -t regen_v11 \
  'cd /root/cm_gen && /root/cm_venv/bin/python3 -m hardware.gen_rtlil build > gen_rtlil.log 2>&1' Enter
```
