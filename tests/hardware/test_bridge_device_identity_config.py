"""Config-only checks. Never start the bridge or open a serial device."""
import ast
from pathlib import Path

source = Path("hardware/wukong_bridge.py").read_text()
tree = ast.parse(source)
helpers = [
    node for node in tree.body
    if isinstance(node, ast.FunctionDef)
    and node.name in {"configured_device_uid", "device_identity_notice"}
]
namespace = {}
exec(compile(ast.Module(body=helpers, type_ignores=[]), "<identity helpers>", "exec"), namespace)


def test_identity_is_explicit_and_trimmed():
    validate = namespace["configured_device_uid"]
    assert validate(None) == ""
    assert validate("  verified-board-a  ") == "verified-board-a"
    assert validate("x" * 128) == "x" * 128
    for value in ("x" * 129, "a\nb", "a\x00b", "a\x7fb"):
        try:
            validate(value)
        except ValueError:
            pass
        else:
            raise AssertionError("Invalid identity accepted")


def test_missing_identity_has_actionable_non_secret_notice():
    notice = namespace["device_identity_notice"]("")
    assert "HARDWARE CONTROLS BLOCKED" in notice
    assert "--device-uid" in notice
    assert "WUKONG_DEVICE_UID" in notice
    assert "Monitoring may continue" in notice
    assert "Do not use COM3" in notice
    assert "REPORT_TOKEN" not in notice


def test_main_validates_before_opening_port():
    main = source[source.index("def main():"):]
    assert main.index("configured_device_uid(args.device_uid)") < main.index("serial.Serial(")
    assert "print(device_identity_notice(device_uid), flush=True)" in main
