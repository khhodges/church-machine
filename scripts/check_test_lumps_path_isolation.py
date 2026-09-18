#!/usr/bin/env python3
"""Reject tests that write through a hard-coded live server/lumps path.

Read-only catalog consumers are allowed.  Write-capable tests must resolve the
catalog through CHURCH_TEST_LUMPS_DIR or use a temporary directory.
"""
from __future__ import annotations

import argparse
import ast
import re
import shlex
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCAN_DIRS = ("tests/server", "tests/lump", "simulator")
SOURCE_PATTERNS = ("*.py", "*.js", "*.mjs", "*.cjs", "*.sh")
ENV_NAME = "CHURCH_TEST_LUMPS_DIR"

PY_MUTATORS = {
    "write_text", "write_bytes", "touch", "unlink", "mkdir", "rmdir",
    "rename", "replace", "open", "remove", "unlink", "rmdir", "removedirs",
    "mkdir", "makedirs", "rename", "replace", "copy", "copy2", "copyfile",
    "copytree", "move",
}
JS_MUTATORS = re.compile(
    r"\b(?:writeFileSync|appendFileSync|truncateSync|unlinkSync|rmSync|"
    r"rmdirSync|mkdirSync|renameSync|copyFileSync|writeFile|appendFile|"
    r"truncate|unlink|rm|rmdir|mkdir|rename|copyFile)\s*\("
)
SH_MUTATOR = re.compile(r"^\s*(?:rm|rmdir|mkdir|touch|truncate)\b")
SH_COPY_MOVE = re.compile(r"^\s*(?:cp|mv)\b")
DIRECT_JS_PATH = re.compile(
    r"(?:server\s*[/\\]\s*lumps|server[/\\]lumps|"
    r"['\"]server['\"]\s*,\s*['\"]lumps['\"])",
    re.IGNORECASE,
)


def _is_direct_python_path(node: ast.AST) -> bool:
    """Whether an expression constructs or contains the live catalog path."""
    safe_roots = {"tmp_path", "tmpdir", "tmp_path_factory"}
    if any(isinstance(child, ast.Name) and child.id in safe_roots for child in ast.walk(node)):
        return False
    if any(
        isinstance(child, ast.Constant) and child.value == ENV_NAME
        for child in ast.walk(node)
    ):
        return False
    pieces: list[str] = []
    for child in ast.walk(node):
        if isinstance(child, ast.Constant) and isinstance(child.value, str):
            pieces.extend(
                part for part in child.value.replace("\\", "/").split("/") if part
            )
    lowered = {part.lower() for part in pieces}
    return {"server", "lumps"}.issubset(lowered)


def _python_findings(path: Path, source: str) -> list[int]:
    try:
        tree = ast.parse(source, filename=str(path))
    except SyntaxError:
        return []

    findings: list[int] = []
    scopes = [tree] + [
        node for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda))
    ]
    for scope in scopes:
        nodes: list[ast.AST] = []
        stack = list(ast.iter_child_nodes(scope))
        while stack:
            node = stack.pop()
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
                continue
            nodes.append(node)
            stack.extend(ast.iter_child_nodes(node))

        direct_names: set[str] = set()
        for node in nodes:
            if isinstance(node, (ast.Assign, ast.AnnAssign)):
                value = node.value
                if value is not None and _is_direct_python_path(value):
                    targets = node.targets if isinstance(node, ast.Assign) else [node.target]
                    direct_names.update(
                        target.id for target in targets if isinstance(target, ast.Name)
                    )

        for node in nodes:
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            mutator = (
                func.attr if isinstance(func, ast.Attribute)
                else func.id if isinstance(func, ast.Name)
                else ""
            )
            if mutator not in PY_MUTATORS:
                continue
            module_call = (
                isinstance(func, ast.Attribute)
                and isinstance(func.value, ast.Name)
                and func.value.id in {"os", "shutil"}
            )
            if isinstance(func, ast.Attribute) and not module_call:
                relevant = [func.value]
                if mutator in {"rename", "replace"}:
                    relevant.extend(node.args[:1])
            elif mutator in {"copy", "copy2", "copyfile", "copytree"}:
                # Reading a live catalog artifact into a temp fixture is allowed;
                # only the destination can mutate the live catalog.
                relevant = node.args[1:2]
            else:
                relevant = (
                    node.args[:2]
                    if mutator in {"rename", "replace", "move"}
                    else node.args[:1]
                )
            tainted = any(
                _is_direct_python_path(arg)
                or any(
                    isinstance(n, ast.Name) and n.id in direct_names
                    for n in ast.walk(arg)
                )
                for arg in relevant
            )
            if not tainted:
                continue
            # open(path, "r") is read-only; open(path, "w"/"a"/"x"/"+") mutates.
            if mutator == "open":
                mode = "r"
                if len(node.args) > 1 and isinstance(node.args[1], ast.Constant):
                    mode = str(node.args[1].value)
                for kw in node.keywords:
                    if kw.arg == "mode" and isinstance(kw.value, ast.Constant):
                        mode = str(kw.value.value)
                if not any(flag in mode for flag in "wax+"):
                    continue
            findings.append(node.lineno)
    return sorted(set(findings))


def _js_findings(source: str) -> list[int]:
    def matching(text: str, start: int, opening: str, closing: str) -> int:
        depth = 0
        quote = ""
        escaped = False
        for index in range(start, len(text)):
            char = text[index]
            if quote:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == quote:
                    quote = ""
                continue
            if char in "'\"`":
                quote = char
            elif char == opening:
                depth += 1
            elif char == closing:
                depth -= 1
                if depth == 0:
                    return index
        return len(text) - 1

    # Brace ranges approximate JavaScript lexical scopes. They are sufficient
    # to prevent a local alias in one helper from tainting a same-named local in
    # another while still allowing aliases declared in an outer scope.
    ranges: list[tuple[int, int]] = [(0, len(source))]
    stack: list[int] = []
    quote = ""
    escaped = False
    for index, char in enumerate(source):
        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = ""
            continue
        if char in "'\"`":
            quote = char
        elif char == "{":
            stack.append(index)
        elif char == "}" and stack:
            ranges.append((stack.pop(), index + 1))

    def scope_at(position: int) -> tuple[int, int]:
        return min(
            (item for item in ranges if item[0] <= position < item[1]),
            key=lambda item: item[1] - item[0],
        )

    direct_names: list[tuple[str, tuple[int, int]]] = []
    for match in re.finditer(
        r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]+);",
        source,
    ):
        if DIRECT_JS_PATH.search(match.group(2)) and ENV_NAME not in match.group(2):
            direct_names.append((match.group(1), scope_at(match.start())))

    findings: list[int] = []
    for match in JS_MUTATORS.finditer(source):
        end = matching(source, match.end() - 1, "(", ")")
        tail = source[match.end():end]
        call_scope = scope_at(match.start())
        if DIRECT_JS_PATH.search(tail) or any(
            alias_scope[0] <= call_scope[0]
            and call_scope[1] <= alias_scope[1]
            and re.search(rf"\b{re.escape(name)}\b", tail)
            for name, alias_scope in direct_names
        ):
            findings.append(source.count("\n", 0, match.start()) + 1)
    return sorted(set(findings))


def _shell_findings(source: str) -> list[int]:
    direct_names: set[str] = set()
    findings: list[int] = []

    def has_live_path(text: str) -> bool:
        return bool(DIRECT_JS_PATH.search(text)) or any(
            re.search(rf"\$\{{?{re.escape(name)}\b", text) for name in direct_names
        )

    for number, line in enumerate(source.splitlines(), 1):
        assignment = re.match(r"\s*([A-Za-z_]\w*)=(.*)", line)
        if assignment and DIRECT_JS_PATH.search(assignment.group(2)):
            if ENV_NAME not in assignment.group(2):
                direct_names.add(assignment.group(1))
            continue
        if not has_live_path(line):
            continue
        if SH_MUTATOR.search(line) or re.search(r"(?:>>?|<>)\s*\S+", line):
            findings.append(number)
        elif SH_COPY_MOVE.search(line):
            try:
                words = shlex.split(line, comments=True)
            except ValueError:
                words = line.split()
            operands = [word for word in words[1:] if not word.startswith("-")]
            if words and words[0].endswith("mv") and any(
                has_live_path(word) for word in operands
            ):
                findings.append(number)
            elif len(operands) >= 2 and has_live_path(operands[-1]):
                findings.append(number)
    return findings


def scan_file(path: Path) -> list[int]:
    source = path.read_text(encoding="utf-8")
    if path.suffix == ".py":
        return _python_findings(path, source)
    if path.suffix == ".sh":
        return _shell_findings(source)
    return _js_findings(source)


def scan(root: Path = ROOT) -> list[tuple[Path, list[int]]]:
    files: set[Path] = set()
    for dirname in SCAN_DIRS:
        base = root / dirname
        if not base.exists():
            continue
        for pattern in SOURCE_PATTERNS:
            files.update(base.rglob(pattern))
    return [(p, lines) for p in sorted(files) if (lines := scan_file(p))]


def cmd_check(root: Path = ROOT) -> int:
    findings = scan(root)
    if not findings:
        print("[lumps-path-guard] PASS: no test writes bypass private LUMP storage.")
        return 0
    print("LUMPS PATH ISOLATION FAILURE", file=sys.stderr)
    for path, lines in findings:
        rel = path.relative_to(root)
        print(f"  {rel}:{','.join(map(str, lines))}", file=sys.stderr)
    print(
        "\nThese tests can mutate the live server/lumps directory. Resolve the "
        "catalog through CHURCH_TEST_LUMPS_DIR, or write to a temporary "
        "directory instead. Read-only catalog access remains allowed.",
        file=sys.stderr,
    )
    return 1


def cmd_selftest() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        py_dir = root / "tests/server"
        js_dir = root / "simulator"
        py_dir.mkdir(parents=True)
        js_dir.mkdir(parents=True)
        (py_dir / "test_read_only.py").write_text(
            "from pathlib import Path\n"
            "p = Path('server') / 'lumps'\n"
            "data = (p / 'manifest.json').read_text()\n",
            encoding="utf-8",
        )
        (py_dir / "test_bad_writer.py").write_text(
            "from pathlib import Path\n"
            "p = Path('server') / 'lumps'\n"
            "(p / 'bad.lump').write_bytes(b'bad')\n",
            encoding="utf-8",
        )
        (py_dir / "test_private_writer.py").write_text(
            "import os\nfrom pathlib import Path\n"
            "p = Path(os.environ['CHURCH_TEST_LUMPS_DIR'])\n"
            "(p / 'ok.lump').write_bytes(b'ok')\n",
            encoding="utf-8",
        )
        (py_dir / "test_fake_exemption.py").write_text(
            "import os\nfrom pathlib import Path\n"
            f"os.environ.get('{ENV_NAME}')\n"
            "p = Path('server') / 'lumps'\n"
            "(p / 'bad.lump').write_bytes(b'bad')\n",
            encoding="utf-8",
        )
        (py_dir / "test_module_api_bypasses.py").write_text(
            "import os, shutil\nfrom pathlib import Path\n"
            "live = Path('server') / 'lumps'\n"
            "os.remove(live / 'old.lump')\n"
            "shutil.copy('/tmp/new.lump', live / 'new.lump')\n"
            "shutil.move('/tmp/moved.lump', live / 'moved.lump')\n"
            "Path('/tmp/replaced.lump').replace(live / 'replaced.lump')\n",
            encoding="utf-8",
        )
        (py_dir / "test_python_scopes.py").write_text(
            "from pathlib import Path\n"
            "def bad():\n"
            "    root = Path('server') / 'lumps'\n"
            "    (root / 'bad').write_text('bad')\n"
            "def good(tmp_path):\n"
            "    root = tmp_path / 'server' / 'lumps'\n"
            "    (root / 'ok').write_text('ok')\n",
            encoding="utf-8",
        )
        (js_dir / "test_bad_writer.js").write_text(
            "const fs=require('fs'), path=require('path');\n"
            "const lumps=path.join(__dirname,'..','server','lumps');\n"
            "fs.writeFileSync(path.join(lumps,'bad.lump'),'bad');\n",
            encoding="utf-8",
        )
        (js_dir / "test_nested_destination.js").write_text(
            "const fs=require('fs'), path=require('path');\n"
            "fs.copyFileSync(path.join('/tmp','source.lump'), "
            "path.join('server','lumps','bad.lump'));\n",
            encoding="utf-8",
        )
        (js_dir / "test_scoped_aliases.js").write_text(
            "const fs=require('fs'), path=require('path');\n"
            "function bad(){ const root=path.join('server','lumps'); "
            "fs.writeFileSync(path.join(root,'bad'),'bad'); }\n"
            "function good(){ const root='/tmp/lumps'; "
            "fs.writeFileSync(path.join(root,'ok'),'ok'); }\n",
            encoding="utf-8",
        )
        (js_dir / "test_bad_writer.sh").write_text(
            "#!/usr/bin/env bash\n"
            "LUMPS=server/lumps\n"
            "cp \"$LUMPS/source.lump\" /tmp/read-only-copy.lump\n"
            "rm -f \"$LUMPS/bad.lump\"\n",
            encoding="utf-8",
        )
        findings = scan(root)
        names = {path.name for path, _ in findings}
        assert names == {
            "test_bad_writer.py", "test_bad_writer.js", "test_bad_writer.sh",
            "test_fake_exemption.py", "test_module_api_bypasses.py",
            "test_nested_destination.js", "test_python_scopes.py",
            "test_scoped_aliases.js",
        }, findings
        by_name = {path.name: lines for path, lines in findings}
        assert by_name["test_module_api_bypasses.py"] == [4, 5, 6, 7]
        assert by_name["test_python_scopes.py"] == [4]
        assert by_name["test_scoped_aliases.js"] == [2]
        assert by_name["test_bad_writer.sh"] == [4]
    print(
        "[lumps-path-guard] self-test PASSED "
        "(write bypasses rejected; reads/private writes allowed)."
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    return cmd_selftest() if args.selftest else cmd_check()


if __name__ == "__main__":
    raise SystemExit(main())