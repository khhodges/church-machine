"""
tests/server/test_versions_view_fields.py

Guards the fields the Builder ▸ Versions tab relies on:

  - GET /hardware/wukong/status exposes ide_version, expected_build_version,
    and min_tu_version so the client can compare the sentinel-reported
    build/TU versions against the repo's expectations.
  - _wukong_build_version() / _wukong_min_tu_version() actually parse the
    constants out of hardware/wukong_top.py.
"""

import os
import re
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import server.app as _app_module
from server.app import app


def _read_const(pattern):
    top = os.path.join(ROOT, 'hardware', 'wukong_top.py')
    with open(top) as f:
        for line in f:
            m = re.match(pattern, line)
            if m:
                return int(m.group(1), 0)
    return None


def test_helpers_parse_wukong_top():
    expected_bv = _read_const(r"\s*WUKONG_BUILD_VERSION\s*=\s*(\d+)")
    expected_tu = _read_const(r"\s*_TU_VERSION_CALL_3PKT\s*=\s*(0[xX][0-9a-fA-F]+|\d+)")
    assert expected_bv is not None, "WUKONG_BUILD_VERSION missing from wukong_top.py"
    assert expected_tu is not None, "_TU_VERSION_CALL_3PKT missing from wukong_top.py"
    assert _app_module._wukong_build_version() == expected_bv
    assert _app_module._wukong_min_tu_version() == expected_tu


def test_status_exposes_version_fields():
    client = app.test_client()
    resp = client.get('/hardware/wukong/status')
    assert resp.status_code == 200
    data = resp.get_json()
    assert 'ide_version' in data and data['ide_version']
    assert 'expected_build_version' in data
    assert 'min_tu_version' in data
    assert data['expected_build_version'] == _app_module._wukong_build_version()
    assert data['min_tu_version'] == _app_module._wukong_min_tu_version()
    # Both should be ints when the source file is present (it is, in-repo).
    assert isinstance(data['expected_build_version'], int)
    assert isinstance(data['min_tu_version'], int)


def test_status_remains_readonly_with_new_fields():
    """Adding the new fields must not have made the endpoint stateful."""
    client = app.test_client()
    d1 = client.get('/hardware/wukong/status').get_json()
    d2 = client.get('/hardware/wukong/status').get_json()
    assert d1['expected_build_version'] == d2['expected_build_version']
    assert d1['min_tu_version'] == d2['min_tu_version']


def test_connect_view_clarifies_jtag_and_usb_uart_connections():
    index_path = os.path.join(ROOT, 'simulator', 'index.html')
    with open(index_path, encoding='utf-8') as handle:
        index = handle.read()
    assert 'id="ti60ConnectionMapTitle"' in index
    assert 'JTAG — programming' in index
    assert 'USB-UART — trace &amp; commands' in index
    assert 'often <code>COM3</code>' in index
    assert 'choose the <strong>3rd entry</strong>' in index
    assert 'class="ti60-active-port-label">Trace port' in index


def test_connect_view_has_configuration_tab_and_reference_images():
    index_path = os.path.join(ROOT, 'simulator', 'index.html')
    with open(index_path, encoding='utf-8') as handle:
        index = handle.read()
    assert 'id="ti60ConnectTab-configuration"' in index
    assert 'id="ti60ConfigurationView"' in index
    assert 'Attached reference images' in index
    assert 'image_1787412016939.png' in index
    assert 'image_1787397327180.png' in index


def test_attached_asset_route_serves_reference_images_only():
    client = app.test_client()
    response = client.get('/attached_assets/image_1787412016939.png')
    assert response.status_code == 200
    assert response.mimetype == 'image/png'
    assert client.get('/attached_assets/image_1787412016939.txt').status_code == 404
