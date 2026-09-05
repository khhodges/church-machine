#!/usr/bin/env python3
"""Reject operational dependencies on legacy per-LUMP JSON files."""

from __future__ import annotations

import argparse
import ast
import json
import re
import sys
from pathlib import Path


SIDECAR_REFERENCE = re.compile(
    r"(?:load|read|write|fetch|open|create|generate|patch|delete|get)"
    r"[A-Za-z0-9_ -]*sidecar"
    r"|sidecar[A-Za-z0-9_]*(?:Path|File)"
    r"|\bsidecar[A-Za-z0-9_]*(?:\[|\.)",
    re.IGNORECASE,
)
RETIRED_ENDPOINT = re.compile(
    r"/(?:api/)?lump[^\"']*/(?:meta|wip-source)\b", re.IGNORECASE)
SIDECAR_FIELD = re.compile(
    r"(?:[\"']sidecar_file[\"']\s*:|\bsidecar_file\s*=|[.]sidecar_file\b)"
)
PER_LUMP_JSON = re.compile(
    r"(?:[$][{](?:token|artifact\w*|key8)[}]|[{](?:token|artifact\w*|key8)[}])"
    r"[.]json",
    re.IGNORECASE,
)
SOURCE_SUFFIXES = {".py", ".js", ".mjs", ".cjs", ".sh"}
ALLOWED_FILES = {
    "scripts/check_no_operational_lump_sidecars.py",
    "scripts/audit_legacy_lump_sidecars.py",
    "tests/lump/test_legacy_sidecar_tools.py",
}
MANIFEST_ALLOWED_FIELDS = frozenset({
    # Binary lookup/index.
    "token", "filename",
    # Revision and archive history used by the current server transition code.
    "abstraction", "version", "lump_version", "compiled_at", "archived", "forked",
    "variant_group",
})
MANIFEST_FORBIDDEN_FIELDS = frozenset({
    "sidecar_file",
    # Placement/deployment belongs to Namespace state and boot configuration.
    "ns_slot", "nsSlot", "slot", "location", "load_address", "load_policy",
    "resident", "boot_resident", "deployment", "runtime_binding",
    # Intrinsic facts come only from the exact binary.
    "cw", "cc", "typ", "lump_type", "lump_size", "binary_hash", "source",
    "api", "api_definition", "methods", "capabilities", "capability_abi",
    "capability_types", "profile", "language", "content_type", "data_offset",
    "data_word_names", "dw", "self_data_r", "self_gt",
    # Approval, security, and display decisions are hash-bound approvals.
    "author", "authorized", "legacy_authorized", "identity_hash", "grants",
    "dot_name", "issue_n",
    "permissions", "domain", "domain_perms", "capability_type", "status",
    "description", "petname", "pet_name", "pet_names", "display_name",
    "documentation", "annotations", "media_tags", "release_notes",
    "history_note", "genesis_authority", "genesis_certificate_verification",
})
APPROVAL_INTRINSIC_FIELDS = frozenset({
    "cw", "cc", "typ", "lump_size", "allocation", "allocation_words",
    "binary", "source", "sourceStorageTier", "api", "api_definition",
    "clist_entries", "methods", "capabilities", "profile", "language",
    "content_type",
})


def _code_lines(lines: list[str], suffix: str) -> list[str]:
    """Remove line/block comments while preserving executable text."""
    result = []
    in_block = False
    for original in lines:
        line = original
        if suffix in {".js", ".mjs", ".cjs"}:
            output = ""
            cursor = 0
            while cursor < len(line):
                if in_block:
                    end = line.find("*/", cursor)
                    if end < 0:
                        cursor = len(line)
                    else:
                        in_block = False
                        cursor = end + 2
                else:
                    start = line.find("/*", cursor)
                    slash = line.find("//", cursor)
                    if slash >= 0 and (start < 0 or slash < start):
                        output += line[cursor:slash]
                        cursor = len(line)
                    elif start >= 0:
                        output += line[cursor:start]
                        in_block = True
                        cursor = start + 2
                    else:
                        output += line[cursor:]
                        cursor = len(line)
            result.append(output)
        else:
            result.append("" if line.lstrip().startswith("#") else line)
    return result


def _bitstream_provenance_lines(lines: list[str], suffix: str) -> set[int]:
    """Allow metadata operations only inside demonstrably .bit-specific code."""
    if suffix != ".py":
        return set()
    functions = []
    current = None
    for number, line in enumerate(lines, 1):
        match = re.match(r"^(\s*)def\s+([A-Za-z0-9_]+)\s*\(", line)
        indent = len(line) - len(line.lstrip())
        if match:
            if current:
                current["end"] = number - 1
                functions.append(current)
            current = {
                "start": number, "end": len(lines),
                "indent": len(match.group(1)), "name": match.group(2),
            }
        elif current and line.strip() and indent <= current["indent"]:
            current["end"] = number - 1
            functions.append(current)
            current = None
    if current:
        functions.append(current)

    allowed = set()
    for function in functions:
        body = "\n".join(lines[function["start"] - 1:function["end"]])
        explicit_meta = ".meta.json" in body and re.search(
            r"(?:[.]bit|BIT_NAME|BITSTREAM_NAME|bit_path)", body)
        named_bit_operation = re.search(
            r"(?:bitstream|wukong_bit)", function["name"], re.IGNORECASE)
        calls_bit_meta = re.search(
            r"(?:_read_bitstream_meta|_write_bitstream_sidecar|"
            r"_bitstream_sidecar_path)", body)
        bit_path_evidence = re.search(r"(?:bit_path|BIT_NAME|BITSTREAM_NAME|[.]bit)", body)
        if explicit_meta or (calls_bit_meta and (named_bit_operation or bit_path_evidence)):
            allowed.update(range(function["start"], function["end"] + 1))
    return allowed


def _is_retired_route(function: ast.FunctionDef | ast.AsyncFunctionDef) -> bool:
    """Return true only for a route whose entire handler is an immediate 410."""
    route = False
    for decorator in function.decorator_list:
        if not isinstance(decorator, ast.Call) or not decorator.args:
            continue
        endpoint = decorator.args[0]
        if (isinstance(decorator.func, ast.Attribute)
                and decorator.func.attr == "route"
                and isinstance(endpoint, ast.Constant)
                and isinstance(endpoint.value, str)
                and RETIRED_ENDPOINT.search(endpoint.value)):
            route = True
    if not route:
        return False

    body = function.body
    if (body and isinstance(body[0], ast.Expr)
            and isinstance(body[0].value, ast.Constant)
            and isinstance(body[0].value.value, str)):
        body = body[1:]
    if len(body) != 1 or not isinstance(body[0], ast.Return):
        return False
    value = body[0].value
    return (
        isinstance(value, ast.Tuple)
        and len(value.elts) >= 2
        and isinstance(value.elts[1], ast.Constant)
        and value.elts[1].value == 410
    )


def _asserts_retired_response(node: ast.Assert, name: str) -> bool:
    """Recognize ``assert response.status_code == 410`` for an exact name."""
    for candidate in ast.walk(node.test):
        if not isinstance(candidate, ast.Compare):
            continue
        operands = [candidate.left, *candidate.comparators]
        has_status = any(
            isinstance(item, ast.Attribute)
            and item.attr == "status_code"
            and isinstance(item.value, ast.Name)
            and item.value.id == name
            for item in operands
        )
        has_gone = any(
            isinstance(item, ast.Constant) and item.value in {404, 410}
            for item in operands
        )
        if has_status and has_gone:
            return True
    return False


def _negative_assertion(node: ast.Assert) -> bool:
    """Recognize assertions whose result requires absence or retirement."""
    for candidate in ast.walk(node.test):
        if isinstance(candidate, ast.UnaryOp) and isinstance(candidate.op, ast.Not):
            return True
        if isinstance(candidate, ast.Compare):
            if any(isinstance(op, (ast.NotIn, ast.IsNot)) for op in candidate.ops):
                return True
            values = [candidate.left, *candidate.comparators]
            if any(
                isinstance(value, ast.Constant)
                and value.value in {False, None, 404, 410}
                for value in values
            ):
                return True
            if any(isinstance(value, (ast.List, ast.Dict, ast.Set))
                   and not value.elts if not isinstance(value, ast.Dict)
                   else isinstance(value, ast.Dict) and not value.keys
                   for value in values):
                return True
    return False


def _python_allowances(lines: list[str], suffix: str) -> set[int]:
    """Find narrowly proven retired routes and negative test assertions."""
    if suffix != ".py":
        return set()
    try:
        tree = ast.parse("\n".join(lines))
    except SyntaxError:
        return set()

    allowed: set[int] = set()
    parents: dict[ast.AST, ast.AST] = {}
    for parent in ast.walk(tree):
        for child in ast.iter_child_nodes(parent):
            parents[child] = parent

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if _is_retired_route(node):
                for decorator in node.decorator_list:
                    if (isinstance(decorator, ast.Call) and decorator.args
                            and isinstance(decorator.args[0], ast.Constant)
                            and isinstance(decorator.args[0].value, str)
                            and RETIRED_ENDPOINT.search(decorator.args[0].value)):
                        allowed.update(range(
                            decorator.lineno,
                            getattr(decorator, "end_lineno", decorator.lineno) + 1,
                        ))

            assertions = [
                child for child in ast.walk(node)
                if isinstance(child, ast.Assert)
            ]
            for child in ast.walk(node):
                if not isinstance(child, ast.Call):
                    continue
                if not any(
                    isinstance(arg, ast.Constant)
                    and isinstance(arg.value, str)
                    and RETIRED_ENDPOINT.search(arg.value)
                    for arg in child.args
                ):
                    continue
                parent = parents.get(child)
                if isinstance(parent, ast.Attribute):
                    parent = parents.get(parent)
                if isinstance(parent, ast.Compare):
                    parent = parents.get(parent)
                if isinstance(parent, ast.Assert) and _negative_assertion(parent):
                    allowed.update(range(child.lineno, child.end_lineno + 1))
                    continue
                assignment = parents.get(child)
                while assignment is not None and not isinstance(
                        assignment, (ast.Assign, ast.AnnAssign, ast.NamedExpr,
                                     ast.FunctionDef, ast.AsyncFunctionDef)):
                    assignment = parents.get(assignment)
                names: list[str] = []
                if isinstance(assignment, ast.Assign):
                    names = [
                        target.id for target in assignment.targets
                        if isinstance(target, ast.Name)
                    ]
                elif isinstance(assignment, (ast.AnnAssign, ast.NamedExpr)):
                    if isinstance(assignment.target, ast.Name):
                        names = [assignment.target.id]
                if any(_asserts_retired_response(assertion, name)
                       for assertion in assertions for name in names):
                    allowed.update(range(child.lineno, child.end_lineno + 1))

        if isinstance(node, ast.Assert) and _negative_assertion(node):
            allowed.update(range(node.lineno, node.end_lineno + 1))
    return allowed


def _negative_text_only(code: str) -> bool:
    """Allow inert messages that explicitly describe retirement or absence."""
    if not re.search(
            r"\b(?:retired|removed|absent|unavailable|unsupported|no longer)\b",
            code, re.IGNORECASE):
        return False
    unquoted = re.sub(
        r"""(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)""",
        '""', code)
    return not re.search(
        r"\b(?:open|read|write|create|delete|unlink|fetch|patch|post|put|get)\s*\(",
        unquoted, re.IGNORECASE)


def _generic_negative_assertion(code: str) -> bool:
    """Recognize inert non-Python assertions without exempting endpoint calls."""
    if not re.search(r"\b(?:assert|expect|check)\b", code, re.IGNORECASE):
        return False
    if not re.search(
            r"(?:\bnot\b|[.]not[.]|\bfalse\b|\bundefined\b|\babsent\b|"
            r"\bretired\b|\b404\b|\b410\b)",
            code, re.IGNORECASE):
        return False
    unquoted = re.sub(
        r"""(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)""",
        '""', code)
    return not re.search(
        r"\b(?:fetch|patch|post|put|get|open|read|write|create|delete)\s*\(",
        unquoted, re.IGNORECASE)


def _forbidden_file_operation(code: str) -> bool:
    """Never forgive I/O involving a sidecar field or per-LUMP JSON path."""
    if not (PER_LUMP_JSON.search(code)
            or SIDECAR_FIELD.search(code)
            or re.search(r"\bsidecar", code, re.IGNORECASE)):
        return False
    return bool(re.search(
        r"\b(?:open|read|write|create|delete|unlink|remove|rename|replace|touch"
        r"|read_text|write_text|readFile|writeFile)\s*\(",
        code, re.IGNORECASE,
    ))


def _literal_string_collection(tree: ast.AST, name: str) -> set[str] | None:
    """Read a module-level literal set/frozenset without importing runtime."""
    for node in getattr(tree, "body", []):
        if not isinstance(node, (ast.Assign, ast.AnnAssign)):
            continue
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        if not any(isinstance(target, ast.Name) and target.id == name
                   for target in targets):
            continue
        value = node.value
        if (isinstance(value, ast.Call) and isinstance(value.func, ast.Name)
                and value.func.id == "frozenset" and len(value.args) == 1):
            value = value.args[0]
        if not isinstance(value, (ast.Set, ast.List, ast.Tuple)):
            return None
        if not all(isinstance(item, ast.Constant) and isinstance(item.value, str)
                   for item in value.elts):
            return None
        return {item.value for item in value.elts}
    return None


def _check_approval_contract(root: Path) -> list[str]:
    """Ensure the approval allowlist cannot admit binary-intrinsic facts."""
    path = root / "server" / "lump_approvals.py"
    if not path.exists():
        return []
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, SyntaxError) as exc:
        return [f"server/lump_approvals.py: cannot inspect approval contract: {exc}"]
    record_fields = _literal_string_collection(tree, "RECORD_FIELDS")
    if record_fields is None:
        return [
            "server/lump_approvals.py: RECORD_FIELDS must be a static literal "
            "allowlist inspectable by the repository guard"
        ]
    forbidden = sorted(record_fields & APPROVAL_INTRINSIC_FIELDS)
    if forbidden:
        return [
            "server/lump_approvals.py: approval RECORD_FIELDS admits intrinsic "
            f"fields: {forbidden}"
        ]
    return []


def check(root: Path) -> list[str]:
    errors: list[str] = []
    manifest_path = root / "server" / "lumps" / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return [f"{manifest_path}: cannot inspect manifest: {exc}"]
    entries = manifest if isinstance(manifest, list) else (
        list(manifest.values()) if isinstance(manifest, dict) else [])
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            errors.append(
                f"server/lumps/manifest.json entry {index}: entry must be an object"
            )
            continue
        token = entry.get("token", "?")
        forbidden = sorted(set(entry) & MANIFEST_FORBIDDEN_FIELDS)
        unknown = sorted(set(entry) - MANIFEST_ALLOWED_FIELDS)
        if forbidden:
            errors.append(
                f"server/lumps/manifest.json entry {index} ({token}): "
                f"forbidden non-locator/history fields: {forbidden}"
            )
        unexpected = sorted(set(unknown) - set(forbidden))
        if unexpected:
            errors.append(
                f"server/lumps/manifest.json entry {index} ({token}): "
                f"unknown fields outside locator/history allowlist: {unexpected}"
            )

    errors.extend(_check_approval_contract(root))

    candidates = [
        path for path in root.rglob("*")
        if path.is_file()
        and path.suffix in SOURCE_SUFFIXES
        and not any(part.startswith(".") or part in {"node_modules", "attached_assets"}
                    for part in path.relative_to(root).parts)
    ]
    for path in sorted(candidates):
        rel = path.relative_to(root).as_posix()
        if rel in ALLOWED_FILES:
            continue
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except UnicodeDecodeError:
            continue
        code_lines = _code_lines(lines, path.suffix)
        bitstream_lines = _bitstream_provenance_lines(lines, path.suffix)
        python_allowances = _python_allowances(lines, path.suffix)
        for line_no, (line, code) in enumerate(zip(lines, code_lines), 1):
            if not code.strip():
                continue
            # Hardware build provenance uses <bitstream>.meta.json and is not
            # per-LUMP metadata.
            if ".meta.json" in code and re.search(
                    r"(?:bit_path|BITSTREAM_NAME|[.]bit)", code):
                continue
            if line_no in bitstream_lines:
                continue
            forbidden_reference = bool(
                SIDECAR_FIELD.search(code) or _forbidden_file_operation(code))
            if ((line_no in python_allowances
                 or _generic_negative_assertion(code)
                 or _negative_text_only(code))
                    and not forbidden_reference):
                continue
            anti_assertion = bool(re.search(
                r"(?:assert|expect|check).*(?:not|false|undefined|retired).*sidecar",
                code, re.IGNORECASE))
            field_reference = SIDECAR_FIELD.search(code) and not anti_assertion
            unquoted = re.sub(
                r"""(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)""",
                '""', code)
            if (field_reference or SIDECAR_REFERENCE.search(unquoted)
                    or PER_LUMP_JSON.search(code) or RETIRED_ENDPOINT.search(code)):
                errors.append(f"{rel}:{line_no}: operational sidecar reference")
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args(argv)
    errors = check(args.root.resolve())
    if errors:
        print("Operational LUMP sidecar guard failed:", file=sys.stderr)
        for error in errors:
            print(f"  {error}", file=sys.stderr)
        return 1
    print("Operational LUMP sidecar guard passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())