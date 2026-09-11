import pytest

from server import app as app_module


def test_symbolic_namespace_row_accepts_only_code_free_metadata():
    app_module._validate_symbolic_namespace_entries([{
        "name": "Future.Service",
        "slot": 14,
        "symbolic": True,
        "implementationMissing": True,
        "resident": False,
    }])


@pytest.mark.parametrize("field,value", [
    ("token", "abc12345"),
    ("filename", "Future.Service.1.abc12345.lump"),
    ("binaryHash", "a" * 64),
    ("binary_hash", "a" * 64),
    ("identityHash", "b" * 64),
    ("identity_hash", "b" * 64),
    ("cacheToken", 123),
    ("cache_token", 123),
    ("resident", True),
    ("boot_resident", True),
])
def test_symbolic_namespace_row_rejects_binary_metadata(field, value):
    row = {
        "name": "Future.Service",
        "slot": 14,
        "symbolic": True,
        "implementationMissing": True,
        field: value,
    }
    with pytest.raises(ValueError, match="cannot carry binary or resident metadata"):
        app_module._validate_symbolic_namespace_entries([row])


def test_symbolic_namespace_row_requires_missing_implementation_marker():
    with pytest.raises(ValueError, match="implementationMissing"):
        app_module._validate_symbolic_namespace_entries([{
            "name": "Future.Service",
            "slot": 14,
            "symbolic": True,
        }])