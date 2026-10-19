"""One origin policy for IDE design operations, without live data access."""
import ast
import os
from pathlib import Path
import re

import pytest
from flask import Flask, request


SOURCE = Path("server/app.py").read_text()
TREE = ast.parse(SOURCE)
FUNCTIONS = {node.name: node for node in TREE.body if isinstance(node, ast.FunctionDef)}


@pytest.fixture
def guard(monkeypatch):
    monkeypatch.setenv("REPLIT_DEV_DOMAIN", "preview.example")
    monkeypatch.setenv("REPLIT_DOMAINS", "")
    names = ("_ide_origin_is_same_site", "_is_ide_design_request")
    env = dict(os=os, re=re, request=request)
    exec(compile(ast.Module(body=[FUNCTIONS[n] for n in names], type_ignores=[]), "isolated", "exec"), env)
    app = Flask(__name__)

    def check(headers=None, json_body=True):
        supplied = {"X-Requested-With": "NamespaceDesign", **(headers or {})}
        options = {"json": {}} if json_body else {"data": "not-json"}
        with app.test_request_context("/", base_url="http://internal:5000", method="POST",
                                      headers=supplied, **options):
            return env["_is_ide_design_request"]()
    return check


def test_proxy_host_and_port_do_not_reject_same_origin_browser(guard):
    assert guard({"Origin": "https://preview.example:5000", "Sec-Fetch-Site": "same-origin"})
    assert guard({"Origin": "https://preview.example", "Sec-Fetch-Site": "same-origin"})


@pytest.mark.parametrize("headers", [
    {"Origin": "https://attacker.example", "Sec-Fetch-Site": "cross-site"},
    {"Origin": "https://preview.example", "Sec-Fetch-Site": "cross-site"},
    {"Origin": "https://attacker.example"},
    {"Origin": "null"},
    {"Sec-Fetch-Mode": "cors", "User-Agent": "Mozilla/5.0"},
    {"Origin": "https://preview.example", "X-Requested-With": ""},
])
def test_reject_untrusted_or_incomplete_requests(guard, headers):
    assert not guard(headers)


def test_json_and_origin_requirements_remain(guard):
    assert not guard({"Origin": "https://preview.example"}, json_body=False)
    assert guard({"Origin": "https://preview.example"})
    assert guard({"Origin": "http://internal:5000"})
    assert guard()  # Preserve the existing explicit non-browser CLI contract.


@pytest.mark.parametrize("name", [
    "get_ide_hierarchy", "namespace_design_v1", "simulation_design_transition",
])
def test_all_design_routes_use_only_the_shared_gate(name):
    node = FUNCTIONS[name]
    calls = [n.func.id for n in ast.walk(node)
             if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)]
    assert calls.count("_is_ide_design_request") == 1
    route = ast.get_source_segment(SOURCE, node)
    assert "urlparse" not in route
    assert 'headers.get("Origin")' not in route
    assert 'headers.get("X-Requested-With")' not in route
