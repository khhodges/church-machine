"""Offline test runner — stands in for pytest where it isn't installed.

Supports the subset the suites use: fixtures by parameter name, and
`pytest.raises(exc, match=...)`. Run with `python3 run_tests.py`.
"""

import inspect
import re
import sys
import tempfile
import traceback
from contextlib import ExitStack, contextmanager


class _Raises:
    def __init__(self, exc, match=None):
        self.exc, self.match = exc, match

    def __enter__(self):
        return self

    def __exit__(self, et, ev, tb):
        if et is None:
            raise AssertionError(f"expected {self.exc.__name__}, nothing raised")
        if not issubclass(et, self.exc):
            return False
        if self.match and not re.search(self.match, str(ev)):
            raise AssertionError(f"{ev!r} does not match /{self.match}/")
        return True


class _Pytest:
    @staticmethod
    def raises(exc, match=None):
        return _Raises(exc, match)

    @staticmethod
    def fixture(fn):
        return fn


sys.modules["pytest"] = _Pytest

from store import Identity, LumpStore  # noqa: E402 — needs the stub first

MODULES = ["test_store", "test_compile_client", "test_interpret"]


@contextmanager
def fixture(name):
    if name == "store":
        with tempfile.TemporaryDirectory() as d:
            yield LumpStore(d)
    elif name == "ide":
        yield Identity.generate("cloomc.lab.ide")
    elif name == "machine":
        from interpret import Interpreter
        with tempfile.TemporaryDirectory() as d:
            store = LumpStore(d)
            ide = Identity.generate("cloomc.lab.ide")
            yield (Interpreter(store, ide), store, ide)
    else:
        raise KeyError(f"no fixture '{name}'")


def run(module_name):
    mod = __import__(module_name)
    passed, failed = 0, []
    print(f"\n{module_name}")
    for name, fn in vars(mod).items():
        if not (name.startswith("test_") and callable(fn)):
            continue
        params = list(inspect.signature(fn).parameters)
        try:
            with ExitStack() as stack:
                fn(*[stack.enter_context(fixture(p)) for p in params])
            passed += 1
            print(f"  ok   {name}")
        except Exception:
            failed.append(name)
            print(f"  FAIL {name}")
            traceback.print_exc()
    return passed, failed


def main():
    total, all_failed = 0, []
    for m in MODULES:
        p, f = run(m)
        total += p
        all_failed += f

    print(f"\n{'-' * 50}")
    print(f"{total} passed, {len(all_failed)} failed")
    for f in all_failed:
        print(f"  FAILED: {f}")
    return 1 if all_failed else 0


if __name__ == "__main__":
    sys.exit(main())
